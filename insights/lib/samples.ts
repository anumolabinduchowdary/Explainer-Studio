import { rulesWriteup } from "./advice";
import { analyze } from "./analyze";
import { isShort } from "./baseline";
import type { Baseline, BaselineVideo, Report, Snapshot, StudioFacts, VideoAnalytics, VideoInfo } from "./types";

/**
 * Two made-up videos on a made-up channel, run through the real analysis, so
 * the report can be seen before Google is set up. Every page that shows them
 * says they are samples.
 */

const HOUR = 3_600_000;
export const SAMPLE_KINDS = ["viral", "slow"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** A small repeatable random-number generator, so the samples look the same every time. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** A retention curve at 1%…100% of a video: the share still watching. */
function retentionCurve(
  durationSec: number,
  hookAt3: number,
  end: number,
  events: Array<{ at: number; change: number; bump?: boolean }> = [],
): number[] {
  const r3 = Math.min(0.3, 3 / durationSec);
  return Array.from({ length: 100 }, (_, i) => {
    const r = (i + 1) / 100;
    let watch = r <= r3 ? 1 - (1 - hookAt3) * (r / r3) : hookAt3 - (hookAt3 - end) * ((r - r3) / (1 - r3)) ** 0.8;
    for (const event of events) {
      if (event.bump) watch += event.change * Math.exp(-(((r - event.at) / 0.02) ** 2));
      else watch += event.change / (1 + Math.exp(-(r - event.at) / 0.008));
    }
    return Math.max(0, Math.round(watch * 1000) / 1000);
  });
}

function sampleBaseline(now: number, publishedAt: number): Baseline {
  const random = seeded(7);
  const videos: BaselineVideo[] = Array.from({ length: 14 }, (_, i) => {
    const published = publishedAt - (i + 1) * 4.2 * 24 * HOUR;
    const total = 1800 + random() * 4200;
    const pace = 20 + random() * 20;
    const durationSec = 35 + Math.round(random() * 35);
    const age = Math.min(28 * 24, (now - 3 * 24 * HOUR - published) / HOUR);
    const curve: Array<[number, number]> = [[0, 0]];
    for (let h = 12; h <= age; h += 24) curve.push([h, Math.round(total * (1 - Math.exp(-h / pace)))]);
    const views = Math.round(total * (1 - Math.exp(-age / pace)));
    const retention = i < 10 ? retentionCurve(durationSec, 0.64 + random() * 0.08, 0.42 + random() * 0.08) : null;
    return {
      id: `sample-earlier-${i + 1}`,
      title: `Earlier Short ${i + 1}`,
      publishedAt: published,
      durationSec,
      short: true,
      curve,
      views,
      avgViewPercent: 66 + random() * 10,
      likes: Math.round(views * (0.035 + random() * 0.01)),
      comments: Math.round(views * (0.0016 + random() * 0.0008)),
      shares: Math.round(views * (0.0028 + random() * 0.0008)),
      subscribersGained: Math.round(views * (0.0015 + random() * 0.0006)),
      hook: retention ? retention[Math.round((3 / durationSec) * 100) - 1] : null,
      retention,
    };
  });
  return {
    builtAt: now,
    videos,
    traffic: {
      SHORTS: 0.4,
      SUBSCRIBER: 0.14,
      RELATED_VIDEO: 0.06,
      YT_SEARCH: 0.08,
      NO_LINK_OTHER: 0.12,
      EXT_URL: 0.05,
      YT_CHANNEL: 0.07,
      NOTIFICATION: 0.06,
      PLAYLIST: 0.02,
    },
    subscribedShare: 0.38,
  };
}

type Sample = {
  hours: number;
  info: Omit<VideoInfo, "publishedAt" | "views" | "likes" | "comments">;
  views: number;
  likes: number;
  comments: number;
  /** Views at a share of the video's age so far (0–1). */
  growth: (share: number) => number;
  studio: StudioFacts;
  analytics: Omit<VideoAnalytics, "fetchedAt" | "daily">;
};

const SAMPLES: Record<SampleKind, Sample> = {
  viral: {
    hours: 70,
    views: 18_400,
    likes: 1_270,
    comments: 96,
    growth: (share) => share ** 1.9,
    info: {
      id: "sample-viral",
      channelId: "UCsamplechannel0000000000",
      title: "3 early signs of speech delay every parent should know",
      description: "",
      tags: [],
      durationSec: 45,
      privacy: "public",
      madeForKids: false,
      thumbnail: "",
      live: false,
    },
    studio: {
      kind: "story",
      title: "3 early signs of speech delay every parent should know",
      language: "English",
      health: true,
      aiVoices: true,
      durationSec: 45,
      shape: "9:16",
      scenes: [
        { startSec: 0, text: "Riya's mother notices Riya points instead of talking" },
        { startSec: 8, text: "At the park, other toddlers are saying words" },
        { startSec: 16, text: "The doctor explains three early signs to watch for" },
        { startSec: 27, text: "Sign 3: not putting two words together by age 2" },
        { startSec: 36, text: "Name everything you do together, every day" },
      ],
    },
    analytics: {
      totals: {
        views: 15_600,
        minutesWatched: 10_760,
        avgViewDurationSec: 41,
        avgViewPercent: 92,
        likes: 1_080,
        comments: 81,
        shares: 142,
        subscribersGained: 69,
        subscribersLost: 3,
      },
      retention: retentionCurve(45, 0.86, 0.66, [{ at: 0.63, change: 0.06, bump: true }]).map((watch, i) => ({
        ratio: (i + 1) / 100,
        watch,
        relative: 0.76,
      })),
      traffic: [
        { source: "SHORTS", views: 11_080 },
        { source: "RELATED_VIDEO", views: 1_250 },
        { source: "SUBSCRIBER", views: 940 },
        { source: "YT_SEARCH", views: 780 },
        { source: "NO_LINK_OTHER", views: 760 },
        { source: "EXT_URL", views: 330 },
        { source: "YT_CHANNEL", views: 310 },
        { source: "NOTIFICATION", views: 150 },
      ],
      searchTerms: [
        { term: "speech delay signs toddler", views: 310 },
        { term: "when should my baby talk", views: 190 },
        { term: "late talker", views: 120 },
      ],
      subscribed: { subscribed: 1_870, other: 13_730 },
      countries: [
        { code: "IN", views: 9_680 },
        { code: "US", views: 1_400 },
        { code: "GB", views: 780 },
        { code: "AE", views: 620 },
        { code: "CA", views: 470 },
        { code: "AU", views: 310 },
      ],
      devices: [
        { type: "MOBILE", views: 14_200 },
        { type: "DESKTOP", views: 620 },
        { type: "TV", views: 470 },
        { type: "TABLET", views: 310 },
      ],
      ages: [
        { group: "age18-24", percent: 12 },
        { group: "age25-34", percent: 41 },
        { group: "age35-44", percent: 33 },
        { group: "age45-54", percent: 9 },
        { group: "age55-64", percent: 3 },
        { group: "age65-", percent: 2 },
      ],
      genders: [
        { gender: "female", percent: 78 },
        { gender: "male", percent: 22 },
      ],
      sharing: [
        { service: "WHATS_APP", shares: 91 },
        { service: "COPY_PASTE", shares: 31 },
        { service: "INSTAGRAM", shares: 12 },
      ],
    },
  },
  slow: {
    hours: 96,
    views: 410,
    likes: 9,
    comments: 0,
    growth: (share) => 1 - (1 - share) ** 3,
    info: {
      id: "sample-slow",
      channelId: "UCsamplechannel0000000000",
      title: "How to make a visual schedule for your child",
      description: "",
      tags: [],
      durationSec: 75,
      privacy: "public",
      madeForKids: false,
      thumbnail: "",
      live: false,
    },
    studio: {
      kind: "explainer",
      title: "How to make a visual schedule for your child",
      language: "English",
      health: false,
      aiVoices: false,
      durationSec: 75,
      shape: "9:16",
      scenes: [
        { startSec: 0, text: "A visual schedule helps your child know what comes next" },
        { startSec: 9, text: "First, gather photos of daily activities" },
        { startSec: 24, text: "Print them and stick them in order" },
        { startSec: 38, text: "Go through the schedule together every morning" },
        { startSec: 52, text: "Praise your child when they check the schedule" },
        { startSec: 66, text: "Follow for more tips" },
      ],
    },
    analytics: {
      totals: {
        views: 362,
        minutesWatched: 208,
        avgViewDurationSec: 34,
        avgViewPercent: 46,
        likes: 8,
        comments: 0,
        shares: 0,
        subscribersGained: 0,
        subscribersLost: 1,
      },
      retention: retentionCurve(75, 0.52, 0.2, [
        { at: 0.24, change: -0.14 },
        { at: 0.53, change: -0.06 },
      ]).map((watch, i) => ({ ratio: (i + 1) / 100, watch, relative: 0.34 })),
      traffic: [
        { source: "SUBSCRIBER", views: 109 },
        { source: "NO_LINK_OTHER", views: 87 },
        { source: "NOTIFICATION", views: 58 },
        { source: "SHORTS", views: 36 },
        { source: "YT_CHANNEL", views: 40 },
        { source: "YT_SEARCH", views: 18 },
        { source: "EXT_URL", views: 14 },
      ],
      searchTerms: [{ term: "visual schedule autism", views: 11 }],
      subscribed: { subscribed: 235, other: 127 },
      countries: [
        { code: "IN", views: 251 },
        { code: "US", views: 37 },
        { code: "GB", views: 22 },
      ],
      devices: [
        { type: "MOBILE", views: 320 },
        { type: "DESKTOP", views: 29 },
        { type: "TABLET", views: 13 },
      ],
      ages: [
        { group: "age25-34", percent: 46 },
        { group: "age35-44", percent: 38 },
        { group: "age45-54", percent: 16 },
      ],
      genders: [
        { gender: "female", percent: 84 },
        { gender: "male", percent: 16 },
      ],
      sharing: [],
    },
  },
};

/** A sample report, as if checked just now. */
export function sampleReport(kind: SampleKind, now: number): Report {
  const sample = SAMPLES[kind];
  const publishedAt = now - sample.hours * HOUR;
  const snapshots: Snapshot[] = [];
  for (let h = 1; h <= sample.hours; h += 1) {
    const share = sample.growth(h / sample.hours);
    snapshots.push({
      at: publishedAt + h * HOUR,
      views: Math.round(sample.views * share),
      likes: Math.round(sample.likes * share),
      comments: Math.round(sample.comments * share),
    });
  }
  const video: VideoInfo = { ...sample.info, publishedAt, views: sample.views, likes: sample.likes, comments: sample.comments };
  const analytics: VideoAnalytics = { ...sample.analytics, fetchedAt: now, daily: [] };
  const baseline = sampleBaseline(now, publishedAt);
  const short = isShort(video.durationSec, sample.studio.shape);
  const analysis = analyze({ now, video, snapshots, analytics, baseline, studio: sample.studio });
  return {
    version: 1,
    createdAt: now,
    milestone: null,
    video: {
      id: video.id,
      title: video.title,
      thumbnail: "",
      publishedAt,
      durationSec: video.durationSec,
      privacy: video.privacy,
      short,
    },
    studio: sample.studio,
    analysis,
    writeup: rulesWriteup(analysis, { short, studio: sample.studio, now }),
    analytics,
  };
}
