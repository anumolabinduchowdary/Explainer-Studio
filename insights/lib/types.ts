import { z } from "zod";

/* ------------------------------------------------------------------ */
/* What Explainer Studio sends about each upload                       */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

export const StudioFactsSchema = z.object({
  kind: z.enum(["explainer", "story"]),
  title: text(200),
  language: text(60),
  health: z.boolean(),
  aiVoices: z.boolean(),
  durationSec: z.number().min(0).max(4 * 3600),
  /** The video's shape, e.g. "9:16". */
  shape: text(12),
  /** When each scene starts and a few words from it, to name the scene where viewers left. */
  scenes: z
    .array(z.object({ startSec: z.number().min(0).max(4 * 3600), text: text(120) }))
    .max(40)
    .default([]),
});
export type StudioFacts = z.infer<typeof StudioFactsSchema>;

export const TrackRequestSchema = z.object({
  videoId: z.string().regex(/^[\w-]{6,20}$/, "That is not a YouTube video id."),
  channelId: z.string().regex(/^UC[\w-]{10,40}$/, "That is not a YouTube channel id."),
  uploadedBy: z.string().trim().max(254).optional(),
  studio: StudioFactsSchema,
});
export type TrackRequest = z.infer<typeof TrackRequestSchema>;

/* ------------------------------------------------------------------ */
/* What YouTube tells us                                               */
/* ------------------------------------------------------------------ */

/** One video, from the YouTube Data API. Counts are live. */
export type VideoInfo = {
  id: string;
  channelId: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: number;
  durationSec: number;
  privacy: string;
  madeForKids: boolean;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  live: boolean;
};

export type Totals = {
  views: number;
  minutesWatched: number;
  avgViewDurationSec: number;
  /** Can be over 100 for Shorts that people watch more than once. */
  avgViewPercent: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
};

/** One video, from the YouTube Analytics API. These numbers arrive a day or more late. */
export type VideoAnalytics = {
  fetchedAt: number;
  totals: Totals | null;
  daily: Array<{ date: string; views: number }>;
  /** The audience-retention curve: at each point of the video (0.01–1), the share still watching. */
  retention: Array<{ ratio: number; watch: number; relative: number | null }>;
  traffic: Array<{ source: string; views: number }>;
  searchTerms: Array<{ term: string; views: number }>;
  subscribed: { subscribed: number; other: number } | null;
  countries: Array<{ code: string; views: number }>;
  devices: Array<{ type: string; views: number }>;
  ages: Array<{ group: string; percent: number }>;
  genders: Array<{ gender: string; percent: number }>;
  sharing: Array<{ service: string; shares: number }>;
};

/** One of the channel's earlier videos, as part of "your usual". */
export type BaselineVideo = {
  id: string;
  title: string;
  publishedAt: number;
  durationSec: number;
  short: boolean;
  /** [hours since publishing, views so far]. */
  curve: Array<[number, number]>;
  views: number;
  avgViewPercent: number | null;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  /** Share still watching 3 seconds in. */
  hook: number | null;
  /** The retention curve at 1%, 2% … 100% of the video. */
  retention: number[] | null;
};

export type Baseline = {
  builtAt: number;
  videos: BaselineVideo[];
  /** The channel's usual share of views from each traffic source (last 90 days). */
  traffic: Record<string, number>;
  /** The channel's usual share of views from subscribers (last 90 days). */
  subscribedShare: number | null;
};

export type Snapshot = { at: number; views: number; likes: number; comments: number };

/** Everything known about a video at one moment, ready to analyse. */
export type VideoFacts = {
  now: number;
  video: VideoInfo;
  snapshots: Snapshot[];
  analytics: VideoAnalytics | null;
  baseline: Baseline | null;
  studio: StudioFacts | null;
};

/* ------------------------------------------------------------------ */
/* The analysis and the report                                         */
/* ------------------------------------------------------------------ */

export type Verdict = "viral" | "above" | "usual" | "below" | "early" | "unknown";
export type Status = "good" | "bad" | "neutral" | "unknown";
export type Format = "short" | "long";

export type Signal = {
  id: string;
  status: Status;
  /** One plain sentence. */
  title: string;
  /** The numbers behind it. */
  detail: string;
  /** How much it matters, for ordering. */
  weight: number;
};

export type Kpi = {
  id: string;
  label: string;
  value: number | null;
  typical: number | null;
  format: "count" | "percent" | "perHundred" | "perThousand";
  /** Shown under the number, e.g. "YouTube's numbers arrive in 1–3 days". */
  note?: string;
};

export type Drop = {
  atSec: number;
  /** Share watching before and after the drop. */
  from: number;
  to: number;
  scene: { index: number; text: string } | null;
};

export type Charts = {
  /** [hours, views]. */
  views: Array<[number, number]>;
  /** [hours, median, lower quarter, upper quarter] of the usual video. */
  usual: Array<[number, number, number, number]>;
  retention: {
    durationSec: number;
    /** [share of the video, share still watching]. */
    actual: Array<[number, number]>;
    usual: Array<[number, number]> | null;
    drops: Drop[];
  } | null;
  traffic: Array<{ source: string; label: string; share: number; views: number; usualShare: number | null }>;
  searchTerms: Array<{ term: string; views: number }>;
  audience: {
    newViewerShare: number | null;
    usualNewViewerShare: number | null;
    countries: Array<{ name: string; share: number }>;
    devices: Array<{ name: string; share: number }>;
    ages: Array<{ name: string; share: number }>;
    genders: Array<{ name: string; share: number }>;
    sharing: Array<{ name: string; shares: number }>;
  } | null;
};

export type Analysis = {
  ageHours: number;
  verdict: Verdict;
  views: number;
  /** This video's views ÷ the usual views at the same age. */
  ratio: number | null;
  usual: { median: number; low: number; high: number; count: number; format: Format | "all" } | null;
  momentum: { last24: number; usualLast24: number | null; previous24: number | null; trend: "rising" | "steady" | "fading" } | null;
  kpis: Kpi[];
  signals: Signal[];
  charts: Charts;
  notes: string[];
};

export type Writeup = {
  summary: string;
  reasons: Array<{ status: Status; text: string; evidence: string }>;
  actions: string[];
  source: "ai" | "rules";
  writtenAt: number;
};

export const MILESTONES = [
  { id: "day1", label: "Day 1", hours: 24 },
  { id: "day3", label: "Day 3", hours: 72 },
  { id: "week1", label: "Week 1", hours: 168 },
  { id: "day28", label: "Day 28 (final)", hours: 672 },
] as const;
export type Milestone = (typeof MILESTONES)[number]["id"];

export type Report = {
  version: 1;
  createdAt: number;
  milestone: Milestone | null;
  video: {
    id: string;
    title: string;
    thumbnail: string;
    publishedAt: number;
    durationSec: number;
    privacy: string;
    short: boolean;
  };
  studio: StudioFacts | null;
  analysis: Analysis;
  writeup: Writeup;
  /** The raw YouTube Analytics numbers, kept so the next quick check can reuse them. */
  analytics: VideoAnalytics | null;
};
