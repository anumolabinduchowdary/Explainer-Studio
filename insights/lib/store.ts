import "server-only";
import { db } from "./db";
import type { Baseline, Milestone, Report, Snapshot, StudioFacts, Verdict } from "./types";

/** Reading and writing the app's tables. Every query is parameterised. */

export type ChannelRow = {
  id: string;
  title: string;
  thumbnail: string;
  token: string | null;
  status: "ok" | "reconnect";
  baseline: string | null;
  baseline_at: number | null;
  connected_at: number | null;
};

export type VideoState = "waiting" | "tracking" | "finished" | "gone";

export type VideoRow = {
  id: string;
  channel_id: string;
  uploaded_by: string | null;
  studio: string | null;
  added_at: number;
  title: string;
  thumbnail: string;
  published_at: number | null;
  state: VideoState;
  verdict: Verdict | null;
  ratio: number | null;
  views: number | null;
  next_check_at: number | null;
  last_check_at: number | null;
  ai_at: number | null;
  report: string | null;
};

function parse<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const readReport = (row: Pick<VideoRow, "report">) => parse<Report>(row.report);
export const readStudio = (row: Pick<VideoRow, "studio">) => parse<StudioFacts>(row.studio);
export const readBaseline = (row: Pick<ChannelRow, "baseline">) => parse<Baseline>(row.baseline);

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export async function getChannel(id: string): Promise<ChannelRow | null> {
  const rows = await (await db()).query<ChannelRow>("SELECT * FROM channels WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** Saves a newly connected channel (or a reconnection) and lets this person see it. */
export async function connectChannel(
  channel: { id: string; title: string; thumbnail: string; token: string },
  email: string,
  now: number,
): Promise<void> {
  const database = await db();
  await database.query(
    `INSERT INTO channels (id, title, thumbnail, token, status, connected_at) VALUES ($1, $2, $3, $4, 'ok', $5)
     ON CONFLICT (id) DO UPDATE SET title = $2, thumbnail = $3, token = $4, status = 'ok', connected_at = $5`,
    [channel.id, channel.title, channel.thumbnail, channel.token, now],
  );
  await database.query("INSERT INTO channel_access (email, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [email, channel.id]);
  // Videos Studio sent before the channel was connected, or that paused when permission ran out, start now.
  await database.query(
    "UPDATE videos SET state = 'tracking', next_check_at = $2 WHERE channel_id = $1 AND state IN ('waiting', 'tracking')",
    [channel.id, now],
  );
}

/** Marks a channel as working, or as needing to be connected again. */
export async function markChannel(id: string, status: ChannelRow["status"]): Promise<void> {
  await (await db()).query("UPDATE channels SET status = $2 WHERE id = $1", [id, status]);
}

export async function saveBaseline(id: string, baseline: Baseline): Promise<void> {
  await (await db()).query("UPDATE channels SET baseline = $2, baseline_at = $3 WHERE id = $1", [id, JSON.stringify(baseline), baseline.builtAt]);
}

/** Forgets the channel and everything about it. */
export async function deleteChannel(id: string): Promise<void> {
  const database = await db();
  await database.query("DELETE FROM snapshots WHERE video_id IN (SELECT id FROM videos WHERE channel_id = $1)", [id]);
  await database.query("DELETE FROM reports WHERE video_id IN (SELECT id FROM videos WHERE channel_id = $1)", [id]);
  await database.query("DELETE FROM videos WHERE channel_id = $1", [id]);
  await database.query("DELETE FROM channel_access WHERE channel_id = $1", [id]);
  await database.query("DELETE FROM channels WHERE id = $1", [id]);
}

export async function channelsFor(email: string): Promise<ChannelRow[]> {
  return (await db()).query<ChannelRow>(
    "SELECT c.* FROM channels c JOIN channel_access a ON a.channel_id = c.id WHERE a.email = $1 ORDER BY c.title",
    [email],
  );
}

export async function canSee(email: string, channelId: string): Promise<boolean> {
  const rows = await (await db()).query("SELECT 1 FROM channel_access WHERE email = $1 AND channel_id = $2", [email, channelId]);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Videos                                                              */
/* ------------------------------------------------------------------ */

/**
 * A video Studio just uploaded. It is checked straight away when its channel
 * is connected, and waits otherwise. Sending the same video again only
 * refreshes what Studio said about it.
 */
export async function trackVideo(
  video: { id: string; channelId: string; uploadedBy: string | null; studio: StudioFacts },
  now: number,
): Promise<{ tracking: boolean; sameChannel: boolean }> {
  const database = await db();
  const channel = await getChannel(video.channelId);
  const ready = Boolean(channel?.token && channel.status === "ok");
  const existing = (await database.query<VideoRow>("SELECT channel_id, state FROM videos WHERE id = $1", [video.id]))[0];
  if (existing && existing.channel_id !== video.channelId) return { tracking: false, sameChannel: false };
  if (existing) {
    await database.query("UPDATE videos SET studio = $2, uploaded_by = COALESCE($3, uploaded_by) WHERE id = $1", [
      video.id,
      JSON.stringify(video.studio),
      video.uploadedBy,
    ]);
    return { tracking: existing.state === "tracking" || existing.state === "finished", sameChannel: true };
  }
  await database.query(
    `INSERT INTO videos (id, channel_id, uploaded_by, studio, added_at, title, state, next_check_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      video.id,
      video.channelId,
      video.uploadedBy,
      JSON.stringify(video.studio),
      now,
      video.studio.title,
      ready ? "tracking" : "waiting",
      // YouTube needs a few minutes to process a new upload.
      ready ? now + 10 * 60_000 : null,
    ],
  );
  return { tracking: ready, sameChannel: true };
}

export async function getVideo(id: string): Promise<VideoRow | null> {
  const rows = await (await db()).query<VideoRow>("SELECT * FROM videos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** Every video in the channels this person can see, newest first. */
export async function videosFor(email: string): Promise<VideoRow[]> {
  return (await db()).query<VideoRow>(
    `SELECT v.* FROM videos v JOIN channel_access a ON a.channel_id = v.channel_id
     WHERE a.email = $1 ORDER BY COALESCE(v.published_at, v.added_at) DESC LIMIT 200`,
    [email],
  );
}

/** Videos whose next check is due, oldest first. */
export async function dueVideos(now: number, limit: number): Promise<string[]> {
  const rows = await (await db()).query<{ id: string }>(
    "SELECT id FROM videos WHERE state = 'tracking' AND next_check_at <= $1 ORDER BY next_check_at LIMIT $2",
    [now, limit],
  );
  return rows.map((row) => row.id);
}

/**
 * Claims a due video for one check, so two runs at the same time never check
 * it twice. The claim ends by itself after `leaseMs` if the check dies.
 */
export async function claimDue(id: string, now: number, leaseMs: number): Promise<boolean> {
  const rows = await (await db()).query(
    "UPDATE videos SET next_check_at = $3 WHERE id = $1 AND state = 'tracking' AND next_check_at <= $2 RETURNING id",
    [id, now, now + leaseMs],
  );
  return rows.length > 0;
}

export async function saveCheck(
  id: string,
  fields: {
    title: string;
    thumbnail: string;
    publishedAt: number;
    state: VideoState;
    verdict: Verdict;
    ratio: number | null;
    views: number;
    nextCheckAt: number | null;
    lastCheckAt: number;
    aiAt: number | null;
    report: Report;
  },
): Promise<void> {
  await (await db()).query(
    `UPDATE videos SET title = $2, thumbnail = $3, published_at = $4, state = $5, verdict = $6, ratio = $7, views = $8,
     next_check_at = $9, last_check_at = $10, ai_at = $11, report = $12 WHERE id = $1`,
    [
      id,
      fields.title,
      fields.thumbnail,
      fields.publishedAt,
      fields.state,
      fields.verdict,
      fields.ratio,
      fields.views,
      fields.nextCheckAt,
      fields.lastCheckAt,
      fields.aiAt,
      JSON.stringify(fields.report),
    ],
  );
}

export async function setVideoState(id: string, state: VideoState, nextCheckAt: number | null): Promise<void> {
  await (await db()).query("UPDATE videos SET state = $2, next_check_at = $3 WHERE id = $1", [id, state, nextCheckAt]);
}

export async function postpone(id: string, at: number): Promise<void> {
  await (await db()).query("UPDATE videos SET next_check_at = $2 WHERE id = $1 AND state = 'tracking'", [id, at]);
}

/* ------------------------------------------------------------------ */
/* Snapshots and milestone reports                                     */
/* ------------------------------------------------------------------ */

export async function addSnapshot(videoId: string, snapshot: Snapshot): Promise<void> {
  await (await db()).query(
    "INSERT INTO snapshots (video_id, at, views, likes, comments) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    [videoId, snapshot.at, snapshot.views, snapshot.likes, snapshot.comments],
  );
}

export async function snapshotsFor(videoId: string): Promise<Snapshot[]> {
  return (await db()).query<Snapshot>("SELECT at, views, likes, comments FROM snapshots WHERE video_id = $1 ORDER BY at", [videoId]);
}

export async function saveMilestone(videoId: string, milestone: Milestone, report: Report): Promise<void> {
  await (await db()).query(
    `INSERT INTO reports (video_id, milestone, created_at, report) VALUES ($1, $2, $3, $4)
     ON CONFLICT (video_id, milestone) DO NOTHING`,
    [videoId, milestone, report.createdAt, JSON.stringify(report)],
  );
}

export async function milestonesFor(videoId: string): Promise<Array<{ milestone: Milestone; created_at: number; report: Report }>> {
  const rows = await (await db()).query<{ milestone: Milestone; created_at: number; report: string }>(
    "SELECT milestone, created_at, report FROM reports WHERE video_id = $1 ORDER BY created_at",
    [videoId],
  );
  return rows.flatMap((row) => {
    const report = parse<Report>(row.report);
    return report ? [{ milestone: row.milestone, created_at: row.created_at, report }] : [];
  });
}
