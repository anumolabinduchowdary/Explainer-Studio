import { describe, expect, it } from "vitest";
import { RULES, analyze, findDrops, findRewatch, sceneAt, verdictFor } from "@/lib/analyze";
import { rulesWriteup } from "@/lib/advice";
import { sampleReport } from "@/lib/samples";
import type { Baseline, BaselineVideo, VideoAnalytics, VideoFacts, VideoInfo } from "@/lib/types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 20, 12);

describe("the verdict", () => {
  it("follows the thresholds", () => {
    expect(verdictFor(5, 10_000, 48)).toBe("viral");
    expect(verdictFor(RULES.viralRatio, RULES.viralMinViews, 48)).toBe("viral");
    expect(verdictFor(2, 10_000, 48)).toBe("above");
    expect(verdictFor(1, 1000, 48)).toBe("usual");
    expect(verdictFor(0.5, 100, 48)).toBe("below");
  });

  it("does not call a tiny channel's 9 views against a usual 3 'viral'", () => {
    expect(verdictFor(3, 9, 48)).toBe("above");
  });

  it("waits six hours, and says when there is nothing to compare with", () => {
    expect(verdictFor(10, 10_000, 2)).toBe("early");
    expect(verdictFor(null, 10_000, 48)).toBe("unknown");
  });
});

/** A 100-point retention curve falling evenly from `start` to `end`, with optional steps. */
function curve(start: number, end: number, steps: Array<{ at: number; change: number }> = []) {
  return Array.from({ length: 100 }, (_, i) => {
    const ratio = (i + 1) / 100;
    let watch = start - (start - end) * ratio;
    for (const step of steps) if (ratio >= step.at) watch += step.change;
    return { ratio, watch };
  });
}

describe("moments people left", () => {
  const scenes = [
    { startSec: 0, text: "Opening" },
    { startSec: 10, text: "The long middle part" },
    { startSec: 40, text: "The ending" },
  ];

  it("finds a sudden drop and names the scene playing then", () => {
    const drops = findDrops(curve(0.8, 0.4, [{ at: 0.3, change: -0.15 }]), 60, scenes);
    expect(drops).toHaveLength(1);
    expect(drops[0].atSec).toBeGreaterThan(16);
    expect(drops[0].atSec).toBeLessThan(20);
    expect(drops[0].scene).toEqual({ index: 2, text: "The long middle part" });
  });

  it("ignores a steady decline, the first seconds and the last 5%", () => {
    expect(findDrops(curve(0.8, 0.4), 60, scenes)).toEqual([]);
    expect(findDrops(curve(0.8, 0.4, [{ at: 0.02, change: -0.2 }]), 60, scenes)).toEqual([]);
    expect(findDrops(curve(0.8, 0.4, [{ at: 0.98, change: -0.2 }]), 60, scenes)).toEqual([]);
  });

  it("does not count the fall after a replayed moment as a drop, but notices the replay", () => {
    const bump = curve(0.8, 0.5).map((point) => ({
      ...point,
      watch: point.watch + 0.08 * Math.exp(-(((point.ratio - 0.5) / 0.02) ** 2)),
    }));
    expect(findDrops(bump, 60, scenes)).toEqual([]);
    const replay = findRewatch(bump, 60);
    expect(replay?.atSec).toBeCloseTo(30, -1);
  });

  it("knows which scene is playing", () => {
    expect(sceneAt(scenes, 0)).toEqual({ index: 1, text: "Opening" });
    expect(sceneAt(scenes, 45)).toEqual({ index: 3, text: "The ending" });
    expect(sceneAt([], 5)).toBeNull();
  });
});

function facts(overrides: Partial<VideoInfo> = {}, analytics: VideoAnalytics | null = null, baseline: Baseline | null = null): VideoFacts {
  return {
    now: NOW,
    video: {
      id: "abc123def45",
      channelId: "UCabcdefghijklmnop",
      title: "A video",
      description: "",
      tags: [],
      publishedAt: NOW - 48 * HOUR,
      durationSec: 40,
      privacy: "public",
      madeForKids: false,
      thumbnail: "",
      views: 1000,
      likes: 40,
      comments: 2,
      live: false,
      ...overrides,
    },
    snapshots: [],
    analytics,
    baseline,
    studio: null,
  };
}

function earlier(total: number, i: number): BaselineVideo {
  return {
    id: `v${i}`,
    title: `Earlier ${i}`,
    publishedAt: NOW - (10 + i) * 24 * HOUR,
    durationSec: 40,
    short: true,
    curve: [
      [0, 0],
      [24, total / 2],
      [72, total],
    ],
    views: total,
    avgViewPercent: 70,
    likes: total * 0.04,
    comments: total * 0.002,
    shares: total * 0.003,
    subscribersGained: total * 0.002,
    hook: 0.7,
    retention: null,
  };
}

describe("the analysis", () => {
  const baseline: Baseline = {
    builtAt: NOW,
    videos: [900, 1000, 1100, 1200, 1300].map(earlier),
    traffic: { SHORTS: 0.4, SUBSCRIBER: 0.2, YT_SEARCH: 0.1, NO_LINK_OTHER: 0.3 },
    subscribedShare: 0.4,
  };

  it("compares with the usual at the same age", () => {
    // At 48 hours the usual is halfway between 550 and 1100 views: 825.
    const result = analyze(facts({ views: 4000 }, null, baseline));
    expect(result.usual?.median).toBeCloseTo(825, 0);
    expect(result.ratio).toBeCloseTo(4000 / 825, 3);
    expect(result.verdict).toBe("viral");
  });

  it("says when there is no usual yet", () => {
    const result = analyze(facts({ views: 4000 }));
    expect(result.verdict).toBe("unknown");
    expect(result.signals.find((signal) => signal.id === "reach")?.status).toBe("unknown");
  });

  it("puts a private video's privacy first", () => {
    const result = analyze(facts({ privacy: "unlisted", views: 50 }, null, baseline));
    const writeup = rulesWriteup(result, { short: true, studio: null, now: NOW });
    expect(writeup.reasons[0].text).toMatch(/unlisted/);
    expect(writeup.actions[0]).toMatch(/public/);
  });

  it("explains a slow video by its weak first seconds and few recommendations", () => {
    const analytics: VideoAnalytics = {
      fetchedAt: NOW,
      totals: { views: 300, minutesWatched: 50, avgViewDurationSec: 15, avgViewPercent: 40, likes: 5, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0 },
      daily: [],
      retention: curve(0.5, 0.2).map((point) => ({ ...point, relative: 0.3 })),
      traffic: [
        { source: "SUBSCRIBER", views: 30 },
        { source: "NO_LINK_OTHER", views: 200 },
        { source: "SHORTS", views: 20 },
        { source: "YT_CHANNEL", views: 50 },
      ],
      searchTerms: [],
      subscribed: { subscribed: 200, other: 100 },
      countries: [],
      devices: [],
      ages: [],
      genders: [],
      sharing: [],
    };
    const withHooks = { ...baseline, videos: baseline.videos.map((video) => ({ ...video, hook: 0.75 })) };
    const result = analyze(facts({ views: 300, likes: 5 }, analytics, withHooks));
    expect(result.verdict).toBe("below");
    const byId = Object.fromEntries(result.signals.map((signal) => [signal.id, signal.status]));
    expect(byId.hook).toBe("bad");
    expect(byId.retention).toBe("bad");
    expect(byId.recommended).toBe("bad");
    expect(byId.newViewers).toBe("bad");
    expect(byId.outside).toBe("neutral");
  });

  it("gives the sample videos the verdicts they were made for", () => {
    expect(sampleReport("viral", NOW).analysis.verdict).toBe("viral");
    const slow = sampleReport("slow", NOW);
    expect(slow.analysis.verdict).toBe("below");
    expect(slow.analysis.charts.retention?.drops[0].scene?.index).toBe(2);
  });
});

describe("speeding up or slowing down", () => {
  it("is only judged from real readings, not a line between two far-apart ones", () => {
    const base = facts({ views: 9000, publishedAt: NOW - 50 * HOUR });
    const oneReading = analyze({ ...base, snapshots: [{ at: NOW, views: 9000, likes: 0, comments: 0 }] });
    expect(oneReading.momentum).toBeNull();
    const daily = analyze({
      ...base,
      snapshots: [
        { at: NOW - 48 * HOUR, views: 100, likes: 0, comments: 0 },
        { at: NOW - 24 * HOUR, views: 2000, likes: 0, comments: 0 },
        { at: NOW, views: 9000, likes: 0, comments: 0 },
      ],
    });
    expect(daily.momentum).toMatchObject({ last24: 7000, previous24: 1900, trend: "rising" });
  });
});
