import "server-only";
import { SETTLE_MS, curveFromDaily, isShort, retentionAtSecond } from "./baseline";
import { addDays, pacificDate } from "./pacific";
import type { Baseline, BaselineVideo, Totals, VideoAnalytics, VideoInfo } from "./types";

/**
 * Reading from YouTube with the channel owner's permission.
 *
 * Addresses, parameters and names are from the YouTube Data API and YouTube
 * Analytics API references:
 * https://developers.google.com/youtube/v3/docs/videos/list
 * https://developers.google.com/youtube/analytics/reference/reports/query
 * https://developers.google.com/youtube/analytics/metrics
 * https://developers.google.com/youtube/analytics/dimensions
 */

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 20_000;

export type YouTubeProblem = "reconnect" | "quota" | "failed";

export class YouTubeError extends Error {
  readonly problem: YouTubeProblem;
  constructor(problem: YouTubeProblem, detail = "") {
    super(`YouTube: ${problem}${detail ? ` (${detail})` : ""}`);
    this.name = "YouTubeError";
    this.problem = problem;
  }
}

async function getJson(url: string, token: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeError("failed", "network");
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { errors?: Array<{ reason?: string }>; status?: string };
  } | null;
  if (response.ok) return body;
  // YouTube's own message is not kept: it can repeat parts of the request.
  const reasons = (body?.error?.errors ?? []).map((item) => item.reason ?? "");
  if (response.status === 401) throw new YouTubeError("reconnect", "401");
  if (reasons.some((reason) => /quota|rateLimit|dailyLimit/i.test(reason)) || response.status === 429) {
    throw new YouTubeError("quota", String(response.status));
  }
  if (response.status === 403 && reasons.some((reason) => /insufficientPermissions|forbidden/i.test(reason))) {
    throw new YouTubeError("reconnect", "403");
  }
  throw new YouTubeError("failed", `${response.status} ${reasons.join(",")}`.trim());
}

/** The parts of YouTube's answers this app reads. */
type Thumbs = Record<string, { url?: string } | undefined>;
type ApiChannel = {
  id?: string;
  snippet?: { title?: string; thumbnails?: Thumbs };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
type ApiVideo = {
  id?: string;
  snippet?: {
    channelId?: string;
    title?: string;
    description?: string;
    tags?: unknown[];
    publishedAt?: string;
    liveBroadcastContent?: string;
    thumbnails?: Thumbs;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string; madeForKids?: boolean };
};
type ApiPlaylistItem = { contentDetails?: { videoId?: string } };
type Items<T> = { items?: T[] } | null;

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** "PT1H2M3S" -> 3723. */
export function parseDuration(iso: string): number {
  const match = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return num(d) * 86400 + num(h) * 3600 + num(m) * 60 + num(s);
}

/* ------------------------------------------------------------------ */
/* Data API                                                            */
/* ------------------------------------------------------------------ */

export type Channel = { id: string; title: string; thumbnail: string; uploads: string };

/** The channel that gave permission. */
export async function myChannel(token: string, signal?: AbortSignal): Promise<Channel | null> {
  const url = `${DATA_API}/channels?${new URLSearchParams({ part: "snippet,contentDetails", mine: "true" })}`;
  const body = (await getJson(url, token, signal)) as Items<ApiChannel>;
  const item = body?.items?.[0];
  if (!item) return null;
  return {
    id: str(item.id),
    title: str(item.snippet?.title),
    thumbnail: str(item.snippet?.thumbnails?.default?.url),
    uploads: str(item.contentDetails?.relatedPlaylists?.uploads),
  };
}

function toVideoInfo(item: ApiVideo): VideoInfo {
  const thumbs: Thumbs = item.snippet?.thumbnails ?? {};
  return {
    id: str(item.id),
    channelId: str(item.snippet?.channelId),
    title: str(item.snippet?.title),
    description: str(item.snippet?.description),
    tags: (item.snippet?.tags ?? []).filter((tag): tag is string => typeof tag === "string"),
    publishedAt: Date.parse(str(item.snippet?.publishedAt)) || 0,
    durationSec: parseDuration(str(item.contentDetails?.duration)),
    privacy: str(item.status?.privacyStatus) || "public",
    madeForKids: item.status?.madeForKids === true,
    thumbnail: str(thumbs.medium?.url || thumbs.high?.url || thumbs.default?.url),
    views: num(item.statistics?.viewCount),
    likes: num(item.statistics?.likeCount),
    comments: num(item.statistics?.commentCount),
    live: str(item.snippet?.liveBroadcastContent) !== "none" && str(item.snippet?.liveBroadcastContent) !== "",
  };
}

/** Details and live counts for up to 50 videos at a time. Missing ids were deleted or are not visible. */
export async function videosInfo(token: string, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, VideoInfo>> {
  const found = new Map<string, VideoInfo>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `${DATA_API}/videos?${new URLSearchParams({
      part: "snippet,contentDetails,statistics,status",
      id: batch.join(","),
      maxResults: "50",
    })}`;
    const body = (await getJson(url, token, signal)) as Items<ApiVideo>;
    for (const item of body?.items ?? []) {
      const info = toVideoInfo(item);
      if (info.id) found.set(info.id, info);
    }
  }
  return found;
}

/** The channel's latest uploads, newest first. */
export async function recentUploads(token: string, playlistId: string, max = 50, signal?: AbortSignal): Promise<string[]> {
  if (!playlistId) return [];
  const url = `${DATA_API}/playlistItems?${new URLSearchParams({
    part: "contentDetails",
    playlistId,
    maxResults: String(Math.min(50, max)),
  })}`;
  const body = (await getJson(url, token, signal)) as Items<ApiPlaylistItem>;
  return (body?.items ?? []).map((item) => str(item.contentDetails?.videoId)).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Analytics API                                                       */
/* ------------------------------------------------------------------ */

type Table = Array<Record<string, number | string>>;

/** One Analytics report, as a list of rows keyed by column name. */
export async function analyticsQuery(
  token: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Table> {
  const url = `${ANALYTICS_API}?${new URLSearchParams({ ids: "channel==MINE", ...params })}`;
  const body = (await getJson(url, token, signal)) as {
    columnHeaders?: Array<{ name?: string }>;
    rows?: Array<Array<number | string>>;
  } | null;
  const names = (body?.columnHeaders ?? []).map((header) => str(header.name));
  return (body?.rows ?? []).map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
}

/** The full span of a video's life so far, in YouTube's Pacific dates. */
function lifeSpan(publishedAt: number, now: number) {
  return { startDate: pacificDate(publishedAt), endDate: pacificDate(now) };
}

/** Runs a report, but a report YouTube refuses only leaves its section empty. */
async function optional(run: () => Promise<Table>): Promise<Table | null> {
  try {
    return await run();
  } catch (err) {
    // Lost permission or quota stop the whole check; anything else just skips this part.
    if (err instanceof YouTubeError && err.problem !== "failed") throw err;
    return null;
  }
}

const TOTAL_METRICS =
  "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost";

function toTotals(row: Record<string, number | string> | undefined): Totals | null {
  if (!row || num(row.views) <= 0) return null;
  return {
    views: num(row.views),
    minutesWatched: num(row.estimatedMinutesWatched),
    avgViewDurationSec: num(row.averageViewDuration),
    avgViewPercent: num(row.averageViewPercentage),
    likes: num(row.likes),
    comments: num(row.comments),
    shares: num(row.shares),
    subscribersGained: num(row.subscribersGained),
    subscribersLost: num(row.subscribersLost),
  };
}

/** Everything YouTube Analytics has about one video so far. */
export async function videoAnalytics(token: string, video: VideoInfo, now: number, signal?: AbortSignal): Promise<VideoAnalytics> {
  const span = lifeSpan(video.publishedAt, now);
  const filter = `video==${video.id}`;
  const q = (params: Record<string, string>) => optional(() => analyticsQuery(token, { ...span, filters: filter, ...params }, signal));

  const [totals, daily, retention, traffic, search, subscribed, countries, devices, demographics, sharing] = await Promise.all([
    q({ metrics: TOTAL_METRICS }),
    q({ metrics: "views", dimensions: "day", sort: "day" }),
    q({ metrics: "audienceWatchRatio,relativeRetentionPerformance", dimensions: "elapsedVideoTimeRatio" }),
    q({ metrics: "views", dimensions: "insightTrafficSourceType", sort: "-views" }),
    q({
      metrics: "views",
      dimensions: "insightTrafficSourceDetail",
      filters: `${filter};insightTrafficSourceType==YT_SEARCH`,
      sort: "-views",
      maxResults: "10",
    }),
    q({ metrics: "views", dimensions: "subscribedStatus" }),
    q({ metrics: "views", dimensions: "country", sort: "-views", maxResults: "8" }),
    q({ metrics: "views", dimensions: "deviceType", sort: "-views" }),
    q({ metrics: "viewerPercentage", dimensions: "ageGroup,gender" }),
    q({ metrics: "shares", dimensions: "sharingService", sort: "-shares", maxResults: "6" }),
  ]);

  const ageTotals = new Map<string, number>();
  const genderTotals = new Map<string, number>();
  for (const row of demographics ?? []) {
    const percent = num(row.viewerPercentage);
    ageTotals.set(str(row.ageGroup), (ageTotals.get(str(row.ageGroup)) ?? 0) + percent);
    genderTotals.set(str(row.gender), (genderTotals.get(str(row.gender)) ?? 0) + percent);
  }
  const subscribedRows = subscribed ?? [];
  const subscribedViews = num(subscribedRows.find((row) => row.subscribedStatus === "SUBSCRIBED")?.views);
  const otherViews = num(subscribedRows.find((row) => row.subscribedStatus === "UNSUBSCRIBED")?.views);

  return {
    fetchedAt: now,
    totals: toTotals(totals?.[0]),
    daily: (daily ?? []).map((row) => ({ date: str(row.day), views: num(row.views) })),
    retention: (retention ?? [])
      .map((row) => ({
        ratio: num(row.elapsedVideoTimeRatio),
        watch: num(row.audienceWatchRatio),
        relative: row.relativeRetentionPerformance === undefined ? null : num(row.relativeRetentionPerformance),
      }))
      .sort((a, b) => a.ratio - b.ratio),
    traffic: (traffic ?? []).map((row) => ({ source: str(row.insightTrafficSourceType), views: num(row.views) })),
    searchTerms: (search ?? []).map((row) => ({ term: str(row.insightTrafficSourceDetail), views: num(row.views) })),
    subscribed: subscribedViews + otherViews > 0 ? { subscribed: subscribedViews, other: otherViews } : null,
    countries: (countries ?? []).map((row) => ({ code: str(row.country), views: num(row.views) })),
    devices: (devices ?? []).map((row) => ({ type: str(row.deviceType), views: num(row.views) })),
    ages: [...ageTotals].map(([group, percent]) => ({ group, percent })).sort((a, b) => a.group.localeCompare(b.group)),
    genders: [...genderTotals].map(([gender, percent]) => ({ gender, percent })),
    sharing: (sharing ?? []).map((row) => ({ service: str(row.sharingService), shares: num(row.shares) })),
  };
}

/* ------------------------------------------------------------------ */
/* The channel's usual                                                 */
/* ------------------------------------------------------------------ */

const BASELINE_SIZE = 30;
const RETENTION_SAMPLES = 10;

/** Runs tasks a few at a time, so a big channel does not hit YouTube with 30 requests at once. */
async function limited<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

/**
 * How the channel's earlier videos did: each one's views hour by hour for its
 * first four weeks, its watch and engagement numbers, and, for the latest
 * few, how long people kept watching. Built about once a week.
 */
export async function buildBaseline(
  token: string,
  channel: Channel,
  exclude: ReadonlySet<string>,
  now: number,
  signal?: AbortSignal,
): Promise<Baseline> {
  const ids = (await recentUploads(token, channel.uploads, 50, signal)).filter((id) => !exclude.has(id));
  const infos = await videosInfo(token, ids, signal);
  const earlier = [...infos.values()]
    .filter((video) => video.privacy === "public" && !video.live && video.publishedAt > 0 && now - video.publishedAt > 2 * DAY_MS)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, BASELINE_SIZE);

  const completeUntil = now - SETTLE_MS;
  const today = pacificDate(now);

  const curves = await limited(earlier, 5, async (video) => {
    const start = pacificDate(video.publishedAt);
    const end = [addDays(start, 29), today].sort()[0];
    const rows = await optional(() =>
      analyticsQuery(token, { startDate: start, endDate: end, metrics: "views", dimensions: "day", filters: `video==${video.id}`, sort: "day" }, signal),
    );
    const daily = (rows ?? []).map((row) => ({ date: str(row.day), views: num(row.views) }));
    return curveFromDaily(video.publishedAt, daily, completeUntil);
  });

  const totalsRows =
    earlier.length === 0
      ? []
      : ((await optional(() =>
          analyticsQuery(
            token,
            {
              startDate: pacificDate(Math.min(...earlier.map((video) => video.publishedAt))),
              endDate: today,
              metrics: "views,averageViewPercentage,likes,comments,shares,subscribersGained",
              dimensions: "video",
              filters: `video==${earlier.map((video) => video.id).join(",")}`,
              sort: "-views",
              maxResults: String(earlier.length),
            },
            signal,
          ),
        )) ?? []);
  const totalsById = new Map(totalsRows.map((row) => [str(row.video), row]));

  // Retention for the latest few of each kind, so Shorts are compared with Shorts.
  const forRetention = new Set<string>();
  for (const short of [true, false]) {
    earlier
      .filter((video) => isShort(video.durationSec) === short)
      .slice(0, RETENTION_SAMPLES)
      .forEach((video) => forRetention.add(video.id));
  }
  const retentionById = new Map<string, number[]>();
  await limited([...forRetention], 5, async (id) => {
    const video = infos.get(id)!;
    const rows = await optional(() =>
      analyticsQuery(
        token,
        {
          startDate: pacificDate(video.publishedAt),
          endDate: today,
          metrics: "audienceWatchRatio",
          dimensions: "elapsedVideoTimeRatio",
          filters: `video==${id}`,
        },
        signal,
      ),
    );
    const points = (rows ?? [])
      .map((row) => [num(row.elapsedVideoTimeRatio), num(row.audienceWatchRatio)] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, watch]) => watch);
    if (points.length >= 20) retentionById.set(id, points);
  });

  const channelSpan = { startDate: pacificDate(now - 90 * DAY_MS), endDate: today };
  const [trafficRows, subscribedRows] = await Promise.all([
    optional(() => analyticsQuery(token, { ...channelSpan, metrics: "views", dimensions: "insightTrafficSourceType" }, signal)),
    optional(() => analyticsQuery(token, { ...channelSpan, metrics: "views", dimensions: "subscribedStatus" }, signal)),
  ]);
  const trafficTotal = (trafficRows ?? []).reduce((sum, row) => sum + num(row.views), 0);
  const traffic: Record<string, number> = {};
  for (const row of trafficRows ?? []) {
    if (trafficTotal > 0) traffic[str(row.insightTrafficSourceType)] = num(row.views) / trafficTotal;
  }
  const subscribedViews = num((subscribedRows ?? []).find((row) => row.subscribedStatus === "SUBSCRIBED")?.views);
  const allViews = (subscribedRows ?? []).reduce((sum, row) => sum + num(row.views), 0);

  const videos: BaselineVideo[] = earlier.map((video, i) => {
    const totals = totalsById.get(video.id);
    const retention = retentionById.get(video.id) ?? null;
    return {
      id: video.id,
      title: video.title.slice(0, 120),
      publishedAt: video.publishedAt,
      durationSec: video.durationSec,
      short: isShort(video.durationSec),
      curve: curves[i],
      views: totals ? num(totals.views) : video.views,
      avgViewPercent: totals ? num(totals.averageViewPercentage) : null,
      likes: totals ? num(totals.likes) : video.likes,
      comments: totals ? num(totals.comments) : video.comments,
      shares: totals ? num(totals.shares) : 0,
      subscribersGained: totals ? num(totals.subscribersGained) : 0,
      hook: retention ? retentionAtSecond(retention, video.durationSec, 3) : null,
      retention,
    };
  });

  return { builtAt: now, videos, traffic, subscribedShare: allViews > 0 ? subscribedViews / allViews : null };
}
