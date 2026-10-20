import "server-only";
import { rulesWriteup } from "./advice";
import { writeReport } from "./ai";
import { analyze } from "./analyze";
import { isShort } from "./baseline";
import { aiSettings, authSettings, type AuthSettings } from "./config";
import { PermissionLost, accessToken } from "./google";
import { openSecret } from "./session";
import {
  addSnapshot,
  claimDue,
  dueVideos,
  getChannel,
  getVideo,
  markChannel,
  milestonesFor,
  postpone,
  readBaseline,
  readReport,
  readStudio,
  saveBaseline,
  saveCheck,
  saveMilestone,
  setVideoState,
  snapshotsFor,
  type ChannelRow,
} from "./store";
import { MILESTONES, type Baseline, type Milestone, type Report, type Verdict, type Writeup } from "./types";
import { YouTubeError, buildBaseline, myChannel, videoAnalytics, videosInfo } from "./youtube";

/**
 * Watching the videos: one check of one video, and the scheduler's run
 * through every video that is due.
 *
 * Each check reads the live counts, refreshes YouTube Analytics every few
 * hours, compares with the channel's usual, writes the report, saves a
 * milestone copy at day 1, day 3, week 1 and day 28, and sets the next check.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BASELINE_MAX_AGE = 7 * 24 * HOUR;
/** YouTube Analytics changes slowly, so it is read at most this often (except at milestones). */
const DEEP_EVERY = 6 * HOUR;
/** OpenAI writes a fresh explanation at least this often while the verdict holds… */
const AI_EVERY = 24 * HOUR;
/** …or this often when someone presses "Check now". */
const AI_ON_REQUEST = 6 * HOUR;
/** Opening a report checks again when the last check is older than this. */
export const REFRESH_ON_VIEW = 15 * MINUTE;
/** "Check now" works at most this often per video. */
export const CHECK_NOW_GAP = 5 * MINUTE;
const LAST_HOURS = MILESTONES[MILESTONES.length - 1].hours;

/** When to check next: hourly for two days, every 6 hours to a week, then daily, never skipping a milestone. */
export function nextCheckAt(publishedAt: number, now: number): number | null {
  const age = (now - publishedAt) / HOUR;
  if (age >= LAST_HOURS) return null;
  const step = age < 48 ? 1 : age < 168 ? 6 : 24;
  const next = now + step * HOUR;
  const milestone = MILESTONES.find((item) => item.hours > age);
  return milestone ? Math.min(next, publishedAt + milestone.hours * HOUR + 5 * MINUTE) : next;
}

/** The latest milestone the video has passed, unless its report is already saved. Missed earlier ones are skipped. */
export function dueMilestone(ageHours: number, saved: ReadonlySet<Milestone>): Milestone | null {
  const passed = MILESTONES.filter((item) => item.hours <= ageHours);
  const latest = passed[passed.length - 1];
  return latest && !saved.has(latest.id) ? latest.id : null;
}

export type CheckResult =
  | { ok: true; checkedAt: number; verdict: Verdict }
  | { ok: false; problem: "waiting" | "reconnect" | "gone" | "quota" | "failed" | "busy"; message: string };

const MESSAGES = {
  waiting: "This channel is not connected yet. Sign in with the Google account that owns it to start tracking.",
  reconnect: "Google's permission for this channel has run out. Sign in again with the account that owns it.",
  gone: "YouTube no longer shows this video to its channel. It may have been deleted.",
  quota: "YouTube's daily limit for this app has been reached. The app will try again later.",
  failed: "YouTube could not be reached just now. The app will try again soon.",
  busy: "This video is being checked right now.",
} as const;
const fail = (problem: keyof typeof MESSAGES): CheckResult => ({ ok: false, problem, message: MESSAGES[problem] });

/** Shared by the checks in one run, so each channel's permission is refreshed once. */
export type CheckContext = { settings: AuthSettings; tokens: Map<string, Promise<string>> };
export const newContext = (): CheckContext => ({ settings: authSettings(), tokens: new Map() });

async function channelToken(context: CheckContext, channel: ChannelRow): Promise<string> {
  let pending = context.tokens.get(channel.id);
  if (!pending) {
    pending = (async () => {
      const refresh = await openSecret(context.settings, channel.token);
      if (!refresh) throw new PermissionLost();
      return accessToken(context.settings, refresh);
    })();
    context.tokens.set(channel.id, pending);
    pending.catch(() => context.tokens.delete(channel.id));
  }
  return pending;
}

const inFlight = new Set<string>();

/** Checks one video now. Never throws: problems come back as a reason, and the next check is moved later. */
export async function checkVideo(id: string, options: { manual?: boolean; context?: CheckContext } = {}): Promise<CheckResult> {
  if (inFlight.has(id)) return fail("busy");
  inFlight.add(id);
  try {
    return await runCheck(id, options.manual ?? false, options.context ?? newContext());
  } catch (err) {
    console.error(`[check] ${id}: ${err instanceof Error ? err.name : "error"}`);
    await postpone(id, Date.now() + 30 * MINUTE).catch(() => undefined);
    return fail("failed");
  } finally {
    inFlight.delete(id);
  }
}

async function onYouTubeError(err: unknown, id: string, channelId: string): Promise<CheckResult> {
  const now = Date.now();
  if (err instanceof PermissionLost || (err instanceof YouTubeError && err.problem === "reconnect")) {
    await markChannel(channelId, "reconnect");
    await postpone(id, now + 6 * HOUR);
    return fail("reconnect");
  }
  if (err instanceof YouTubeError && err.problem === "quota") {
    await postpone(id, now + HOUR);
    return fail("quota");
  }
  await postpone(id, now + 30 * MINUTE);
  return fail("failed");
}

async function runCheck(id: string, manual: boolean, context: CheckContext): Promise<CheckResult> {
  const row = await getVideo(id);
  if (!row || row.state === "gone") return fail("gone");
  const channel = await getChannel(row.channel_id);
  if (!channel?.token) return fail("waiting");
  if (channel.status === "reconnect") return fail("reconnect");

  let token: string;
  try {
    token = await channelToken(context, channel);
  } catch (err) {
    return onYouTubeError(err, id, channel.id);
  }

  const now = Date.now();
  let info;
  try {
    info = (await videosInfo(token, [id])).get(id);
  } catch (err) {
    return onYouTubeError(err, id, channel.id);
  }
  // Deleted, or (if Studio was misled) not this channel's video: stop watching it.
  if (!info || info.channelId !== row.channel_id) {
    await setVideoState(id, "gone", null);
    return fail("gone");
  }
  await addSnapshot(id, { at: now, views: info.views, likes: info.likes, comments: info.comments });

  const previous = readReport(row);
  const studio = readStudio(row);

  // The channel's usual, rebuilt about once a week.
  let baseline = readBaseline(channel);
  if (!baseline || now - (channel.baseline_at ?? 0) > BASELINE_MAX_AGE) {
    try {
      const me = await myChannel(token);
      if (me?.id === channel.id) {
        baseline = await buildBaseline(token, me, new Set([id]), now);
        await saveBaseline(channel.id, baseline);
      }
    } catch (err) {
      if (err instanceof YouTubeError && err.problem !== "failed") return onYouTubeError(err, id, channel.id);
      // Otherwise carry on with last week's usual, or none.
    }
  }
  // Only videos published before this one count as "usual".
  const earlier: Baseline | null = baseline
    ? { ...baseline, videos: baseline.videos.filter((video) => video.id !== id && video.publishedAt < info.publishedAt) }
    : null;

  const ageHours = (now - info.publishedAt) / HOUR;
  const saved = new Set((await milestonesFor(id)).map((item) => item.milestone));
  const milestone = dueMilestone(ageHours, saved);

  let analytics = previous?.analytics ?? null;
  const lastDeep = analytics?.fetchedAt ?? 0;
  if (!analytics || now - lastDeep >= DEEP_EVERY || milestone || (manual && now - lastDeep >= 30 * MINUTE)) {
    try {
      analytics = await videoAnalytics(token, info, now);
    } catch (err) {
      if (err instanceof YouTubeError && err.problem !== "failed") return onYouTubeError(err, id, channel.id);
    }
  }

  const short = isShort(info.durationSec || studio?.durationSec || 0, studio?.shape);
  const analysis = analyze({ now, video: info, snapshots: await snapshotsFor(id), analytics, baseline: earlier, studio });

  const before = previous?.writeup;
  const verdictChanged = previous?.analysis.verdict !== analysis.verdict;
  let writeup: Writeup;
  const aiDue =
    aiSettings() !== null &&
    analysis.verdict !== "early" &&
    (!before ||
      before.source !== "ai" ||
      milestone !== null ||
      verdictChanged ||
      now - before.writtenAt >= AI_EVERY ||
      (manual && now - before.writtenAt >= AI_ON_REQUEST));
  const extra = { title: info.title, short, studio, baseline: earlier, now };
  if (aiDue) writeup = await writeReport(analysis, extra);
  else if (before?.source === "ai" && !verdictChanged) writeup = before;
  else writeup = rulesWriteup(analysis, { short, studio, now });

  const report: Report = {
    version: 1,
    createdAt: now,
    milestone,
    video: {
      id,
      title: info.title,
      thumbnail: info.thumbnail,
      publishedAt: info.publishedAt,
      durationSec: info.durationSec,
      privacy: info.privacy,
      short,
    },
    studio,
    analysis,
    writeup,
    analytics,
  };
  if (milestone) await saveMilestone(id, milestone, report);

  const finished = ageHours >= LAST_HOURS;
  await saveCheck(id, {
    title: info.title,
    thumbnail: info.thumbnail,
    publishedAt: info.publishedAt,
    state: finished ? "finished" : "tracking",
    verdict: analysis.verdict,
    ratio: analysis.ratio,
    views: analysis.views,
    nextCheckAt: finished ? null : nextCheckAt(info.publishedAt, now),
    lastCheckAt: now,
    aiAt: writeup.source === "ai" ? writeup.writtenAt : row.ai_at,
    report,
  });
  return { ok: true, checkedAt: now, verdict: analysis.verdict };
}

/**
 * Checks every video that is due, oldest first, until the time budget runs
 * out. Whatever is left is picked up by the next run.
 */
export async function runDue(budgetMs: number): Promise<{ checked: number; problems: number; more: boolean }> {
  const started = Date.now();
  const context = newContext();
  let checked = 0;
  let problems = 0;
  const outOfTime = () => Date.now() - started >= budgetMs;
  while (!outOfTime()) {
    const ids = await dueVideos(Date.now(), 25);
    if (!ids.length) return { checked, problems, more: false };
    let claimed = 0;
    for (const id of ids) {
      if (outOfTime()) break;
      // The claim lasts 15 minutes: long enough for one check, short enough to retry if it dies.
      if (!(await claimDue(id, Date.now(), 15 * MINUTE))) continue;
      claimed++;
      const result = await checkVideo(id, { context });
      if (result.ok) checked++;
      else problems++;
    }
    if (!claimed) break;
  }
  return { checked, problems, more: (await dueVideos(Date.now(), 1)).length > 0 };
}
