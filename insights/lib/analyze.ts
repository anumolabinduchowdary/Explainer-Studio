import {
  CURVE_HOURS,
  SETTLE_MS,
  comparable,
  isShort,
  median,
  retentionAtSecond,
  usualAt,
  valueAt,
  videoCurve,
  type Usual,
} from "./baseline";
import { formatAge, formatClock, formatCount, formatDecimal, formatRatio, formatShare } from "./format";
import {
  OUTSIDE_SOURCES,
  RECOMMENDED_SOURCES,
  ageLabel,
  countryName,
  deviceLabel,
  genderLabel,
  sharingLabel,
  trafficLabel,
  trafficPhrase,
} from "./labels";
import type { Analysis, BaselineVideo, Charts, Drop, Kpi, Signal, StudioFacts, Verdict, VideoFacts } from "./types";

/**
 * Decides whether a video is going viral for its channel, and why.
 *
 * Everything here is a pure function of the facts, so the same numbers always
 * give the same report, and every rule can be tested. The thresholds are all
 * in RULES.
 */

export const RULES = {
  /** "Going viral": at least this many times the usual views at the same age… */
  viralRatio: 3,
  /** …and at least this many views, so 9 views against a usual 3 is not "viral". */
  viralMinViews: 500,
  aboveRatio: 1.5,
  belowRatio: 0.67,
  /** Younger than this, it is too early to judge. */
  earlyHours: 6,
  /** Share-point differences that count as clearly better or worse (5 points = 0.05). */
  hookMargin: 0.05,
  shareMargin: 0.1,
  /** Engagement rates this much above or below usual count as different. */
  goodRate: 1.25,
  badRate: 0.75,
  /** Fewer views than this, and per-view rates are too noisy to judge. */
  minViewsForRates: 100,
  /** A drop in the retention curve this big over a few points marks a moment people left. */
  dropMin: 0.04,
  /** A rise this big means people went back to watch a moment again. */
  rewatchMin: 0.03,
} as const;

const HOUR_MS = 3_600_000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const perHundred = (count: number, views: number) => (views > 0 ? (count / views) * 100 : null);
const perThousand = (count: number, views: number) => (views > 0 ? (count / views) * 1000 : null);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function compareRate(value: number | null, usual: number | null): "good" | "bad" | "neutral" | null {
  if (value === null || usual === null) return null;
  if (usual <= 0) return value > 0 ? "good" : "neutral";
  if (value >= usual * RULES.goodRate) return "good";
  if (value <= usual * RULES.badRate) return "bad";
  return "neutral";
}

function compareShare(value: number | null, usual: number | null, margin: number): "good" | "bad" | "neutral" | null {
  if (value === null || usual === null) return null;
  if (value >= usual + margin) return "good";
  if (value <= usual - margin) return "bad";
  return "neutral";
}

export function verdictFor(ratio: number | null, views: number, ageHours: number): Verdict {
  if (ageHours < RULES.earlyHours) return "early";
  if (ratio === null) return "unknown";
  if (ratio >= RULES.viralRatio && views >= RULES.viralMinViews) return "viral";
  if (ratio >= RULES.aboveRatio) return "above";
  if (ratio < RULES.belowRatio) return "below";
  return "usual";
}

/** The scene playing at a moment, numbered from 1. */
export function sceneAt(scenes: StudioFacts["scenes"] | undefined, second: number): Drop["scene"] {
  if (!scenes?.length) return null;
  let found = -1;
  scenes.forEach((scene, i) => {
    if (scene.startSec <= second + 0.25) found = i;
  });
  return found >= 0 ? { index: found + 1, text: scenes[found].text } : null;
}

/**
 * The moments where clearly more people left than elsewhere in the video,
 * biggest first. The first seconds (the hook, judged on its own) and the last
 * 5% (people always leave at the end) are not counted.
 */
export function findDrops(
  retention: ReadonlyArray<{ ratio: number; watch: number }>,
  durationSec: number,
  scenes?: StudioFacts["scenes"],
): Drop[] {
  if (retention.length < 20 || durationSec <= 0) return [];
  const points = [...retention].sort((a, b) => a.ratio - b.ratio);
  const losses: Array<{ i: number; loss: number }> = [];
  for (let i = 1; i + 2 < points.length; i++) {
    const start = points[i - 1];
    const end = points[i + 2];
    if (start.ratio * durationSec < 3.5 || end.ratio > 0.95) continue;
    // Measured from the lowest level just before it, so the fall after a replayed moment (a rise) is not a "drop".
    const before = Math.min(...points.slice(Math.max(0, i - 8), i).map((point) => point.watch));
    losses.push({ i, loss: before - end.watch });
  }
  if (!losses.length) return [];
  const usualLoss = median(losses.map((item) => Math.max(0, item.loss))) ?? 0;
  const threshold = Math.max(RULES.dropMin, usualLoss * 3);
  const drops: Drop[] = [];
  const taken: number[] = [];
  for (const { i, loss } of [...losses].sort((a, b) => b.loss - a.loss)) {
    if (loss < threshold || drops.length >= 2) break;
    const middle = (points[i - 1].ratio + points[i + 2].ratio) / 2;
    if (taken.some((ratio) => Math.abs(ratio - middle) < 0.1)) continue;
    taken.push(middle);
    const atSec = middle * durationSec;
    drops.push({ atSec, from: points[i - 1].watch, to: points[i + 2].watch, scene: sceneAt(scenes, atSec) });
  }
  return drops;
}

/** The clearest moment people went back to watch again, if any. */
export function findRewatch(
  retention: ReadonlyArray<{ ratio: number; watch: number }>,
  durationSec: number,
): { atSec: number; rise: number } | null {
  let best: { atSec: number; rise: number } | null = null;
  const points = [...retention].sort((a, b) => a.ratio - b.ratio);
  for (let i = 1; i + 2 < points.length; i++) {
    const start = points[i - 1];
    const peak = points[i + 2];
    if (start.ratio * durationSec < 3.5 || peak.ratio > 0.95) continue;
    const rise = peak.watch - start.watch;
    if (rise >= RULES.rewatchMin && (!best || rise > best.rise)) best = { atSec: peak.ratio * durationSec, rise };
  }
  return best;
}

const sceneWords = (scene: Drop["scene"]) => (scene ? `, during scene ${scene.index}${scene.text ? `: “${scene.text}”` : ""}` : "");

/* ------------------------------------------------------------------ */
/* The analysis                                                        */
/* ------------------------------------------------------------------ */

export function analyze(facts: VideoFacts): Analysis {
  const { now, video, analytics, baseline, studio } = facts;
  const ageHours = Math.max(0, (now - video.publishedAt) / HOUR_MS);
  const short = isShort(video.durationSec || studio?.durationSec || 0, studio?.shape);
  const kind = short ? "Short" : "video";
  const kinds = short ? "Shorts" : "videos";
  const totals = analytics?.totals ?? null;
  const lastSnapshot = [...facts.snapshots].sort((a, b) => b.at - a.at)[0];
  const views = Math.max(video.views, lastSnapshot?.views ?? 0, totals?.views ?? 0);
  const likes = Math.max(video.likes, lastSnapshot?.likes ?? 0);
  const comments = Math.max(video.comments, lastSnapshot?.comments ?? 0);

  // This video's growth, and the channel's usual at each age.
  const actual = videoCurve(video.publishedAt, facts.snapshots, analytics?.daily ?? [], now - SETTLE_MS);
  if (!actual.length || actual[actual.length - 1][0] < ageHours) actual.push([ageHours, views]);
  const pool = baseline ? comparable(baseline.videos, short) : null;
  const curves = pool?.videos.map((item) => item.curve) ?? [];
  const at = Math.min(ageHours, CURVE_HOURS);
  const usualNow: Usual | null = curves.length ? usualAt(curves, at) : null;
  const viewsAt = (hours: number) => valueAt(actual, hours) ?? views;
  const comparedViews = ageHours > CURVE_HOURS ? viewsAt(CURVE_HOURS) : views;
  const ratio = usualNow ? comparedViews / Math.max(1, usualNow.median) : null;
  const verdict = verdictFor(ratio, views, ageHours);
  const similar: BaselineVideo[] = pool?.videos ?? [];

  const signals: Signal[] = [];
  const add = (signal: Signal) => signals.push(signal);

  /* --- Settings that stop a video spreading --- */
  if (video.privacy !== "public") {
    add({
      id: "privacy",
      status: "bad",
      title: `The video is ${video.privacy}, so YouTube won't recommend it to anyone.`,
      detail: "Only public videos can appear in the Shorts feed, on the home page, in suggestions or in search.",
      weight: 100,
    });
  }
  if (video.madeForKids) {
    add({
      id: "kids",
      status: "neutral",
      title: "It is marked “made for kids”.",
      detail: "Comments and some features are switched off for these videos, so viewers have fewer ways to react and share.",
      weight: 20,
    });
  }

  /* --- Views compared with the usual --- */
  const reachTitles: Record<Verdict, string> = {
    viral: "It's getting far more views than your usual videos.",
    above: "It's getting more views than your usual videos.",
    usual: "It's getting about as many views as your usual videos.",
    below: "It's getting fewer views than your usual videos.",
    early: "It's too early to compare: give it a few hours.",
    unknown: "Your channel doesn't have enough earlier videos to compare with yet.",
  };
  add({
    id: "reach",
    status: verdict === "viral" || verdict === "above" ? "good" : verdict === "below" ? "bad" : verdict === "usual" ? "neutral" : "unknown",
    title: reachTitles[verdict],
    detail: usualNow
      ? `${formatCount(views)} views after ${formatAge(ageHours)}. Your usual ${kind} had ${formatCount(usualNow.median)} at this age (most were between ${formatCount(usualNow.low)} and ${formatCount(usualNow.high)}), so this one has ${formatRatio(ratio ?? 0)} the usual.`
      : `${formatCount(views)} views after ${formatAge(ageHours)}.`,
    weight: 90,
  });

  /* --- Speeding up or slowing down --- */
  let momentum: Analysis["momentum"] = null;
  // Only judged from real readings near 24 (and 48) hours ago, not from a straight line drawn between two far-apart ones.
  const measuredNear = (hours: number) => hours <= 0 || actual.some(([h]) => Math.abs(h - hours) <= 6);
  if (ageHours >= 30 && measuredNear(ageHours - 24)) {
    const last24 = Math.max(0, views - viewsAt(ageHours - 24));
    const previous24 = ageHours >= 48 && measuredNear(ageHours - 48) ? Math.max(0, viewsAt(ageHours - 24) - viewsAt(ageHours - 48)) : null;
    const usualThen = curves.length ? usualAt(curves, Math.min(ageHours, CURVE_HOURS) - 24) : null;
    const usualLast24 = usualNow && usualThen ? Math.max(0, usualNow.median - usualThen.median) : null;
    let trend: "rising" | "steady" | "fading" = "steady";
    if (usualLast24 !== null && ratio !== null && ageHours <= CURVE_HOURS) {
      const recentRatio = last24 / Math.max(1, usualLast24);
      if (recentRatio >= Math.max(1, ratio) * 1.3 && last24 >= 10) trend = "rising";
      else if (recentRatio <= ratio * 0.7) trend = "fading";
    } else if (previous24 !== null) {
      if (last24 >= previous24 * 1.2 && last24 >= 10) trend = "rising";
      else if (last24 <= previous24 * 0.5) trend = "fading";
    }
    momentum = { last24, usualLast24, previous24, trend };
    if (trend !== "steady") {
      add({
        id: "momentum",
        status: trend === "rising" ? "good" : "bad",
        title: trend === "rising" ? "Views are speeding up." : "Views are slowing down faster than usual.",
        detail:
          `${formatCount(last24)} views in the last 24 hours` +
          (previous24 !== null ? `, against ${formatCount(previous24)} the day before` : "") +
          (usualLast24 !== null ? `. Your usual ${kind} gets ${formatCount(usualLast24)} on this day of its life.` : "."),
        weight: 60,
      });
    }
  }

  /* --- The first seconds --- */
  const retention = analytics?.retention ?? [];
  const duration = video.durationSec || studio?.durationSec || 0;
  const watchPoints = retention.map((point) => point.watch);
  const hook = retention.length >= 20 ? retentionAtSecond(watchPoints, duration, 3) : null;
  const usualHook = median(similar.map((item) => item.hook ?? NaN));
  const early = retention.filter((point) => point.ratio <= 0.1 && point.relative !== null).map((point) => point.relative as number);
  const earlyRelative = early.length ? sum(early) / early.length : null;
  if (hook !== null) {
    const status = compareShare(hook, usualHook, RULES.hookMargin) ?? (earlyRelative === null ? null : earlyRelative >= 0.6 ? "good" : earlyRelative <= 0.4 ? "bad" : "neutral");
    if (status && status !== "neutral") {
      add({
        id: "hook",
        status,
        title: status === "good" ? "Most viewers stay past the first 3 seconds." : "Many viewers leave in the first 3 seconds.",
        detail:
          `${formatShare(Math.min(1, hook))} were still watching at 0:03` +
          (usualHook !== null
            ? `; your usual ${kind} keeps ${formatShare(Math.min(1, usualHook))}.`
            : `, which YouTube rates ${status === "good" ? "better" : "worse"} than most videos of this length.`),
        weight: 80,
      });
    }
  }

  /* --- How much of it people watched --- */
  const avgPercent = totals?.avgViewPercent ?? null;
  const usualPercent = median(similar.map((item) => item.avgViewPercent ?? NaN));
  const relativeAll = retention.filter((point) => point.relative !== null).map((point) => point.relative as number);
  const relative = relativeAll.length ? sum(relativeAll) / relativeAll.length : null;
  if (avgPercent !== null) {
    let status: Signal["status"] | null = null;
    if (usualPercent !== null) {
      const margin = Math.max(5, usualPercent * 0.1);
      status = avgPercent >= usualPercent + margin ? "good" : avgPercent <= usualPercent - margin ? "bad" : "neutral";
    } else if (relative !== null) {
      status = relative >= 0.6 ? "good" : relative <= 0.4 ? "bad" : "neutral";
    }
    if (status && status !== "neutral") {
      add({
        id: "retention",
        status,
        title: status === "good" ? "People watch more of it than usual." : "People stop watching sooner than usual.",
        detail:
          `On average people watched ${formatDecimal(avgPercent)}% of it` +
          (usualPercent !== null ? `; your usual ${kind} gets ${formatDecimal(usualPercent)}%.` : ".") +
          (relative !== null
            ? ` YouTube rates how long people stayed as ${relative >= 0.55 ? "better than" : relative <= 0.45 ? "worse than" : "about the same as"} most videos of this length.`
            : ""),
        weight: 75,
      });
    }
  }

  /* --- The moments people left, or watched again --- */
  const drops = findDrops(retention, duration, studio?.scenes);
  drops.forEach((drop, i) => {
    add({
      id: `drop${i + 1}`,
      status: "bad",
      title: `${i === 0 ? "Many" : "More"} viewers left at ${formatClock(drop.atSec)}${sceneWords(drop.scene)}.`,
      detail: `The share still watching fell from ${formatShare(Math.min(1, drop.from))} to ${formatShare(Math.min(1, drop.to))} around this moment, much faster than in the rest of the video.`,
      weight: i === 0 ? 70 : 50,
    });
  });
  const rewatch = findRewatch(retention, duration);
  if (rewatch) {
    add({
      id: "rewatch",
      status: "good",
      title: `People went back to watch ${formatClock(rewatch.atSec)} again${sceneWords(sceneAt(studio?.scenes, rewatch.atSec))}.`,
      detail: "The number of people watching rose at this moment, which happens when viewers rewind or replay a part they liked.",
      weight: 40,
    });
  }

  /* --- Where the views came from --- */
  const trafficTotal = sum((analytics?.traffic ?? []).map((row) => row.views));
  const shareOf = (sources: ReadonlySet<string>) =>
    trafficTotal > 0 ? sum((analytics?.traffic ?? []).filter((row) => sources.has(row.source)).map((row) => row.views)) / trafficTotal : null;
  const usualShareOf = (sources: ReadonlySet<string>) =>
    baseline && Object.keys(baseline.traffic).length
      ? sum(Object.entries(baseline.traffic).filter(([source]) => sources.has(source)).map(([, share]) => share))
      : null;
  const recommended = shareOf(RECOMMENDED_SOURCES);
  const usualRecommended = usualShareOf(RECOMMENDED_SOURCES);
  const topRecommended = (analytics?.traffic ?? []).filter((row) => RECOMMENDED_SOURCES.has(row.source)).sort((a, b) => b.views - a.views)[0];
  if (recommended !== null && trafficTotal >= 20) {
    let status = compareShare(recommended, usualRecommended, RULES.shareMargin);
    if (status === null || status === "neutral") {
      if (recommended >= 0.5 && (verdict === "viral" || verdict === "above")) status = "good";
      else if (recommended < 0.2 && ageHours >= 48) status = "bad";
    }
    if (status && status !== "neutral") {
      add({
        id: "recommended",
        status,
        title: status === "good" ? "YouTube is showing it to lots of people." : "YouTube is showing it to fewer people than usual.",
        detail:
          `${formatShare(recommended)} of views came from YouTube showing it to people` +
          (topRecommended ? `, most of them from ${trafficPhrase(topRecommended.source)}` : "") +
          (usualRecommended !== null ? `; across your channel it is usually ${formatShare(usualRecommended)}.` : "."),
        weight: 85,
      });
    }
  }
  const outside = shareOf(OUTSIDE_SOURCES);
  const topSharing = [...(analytics?.sharing ?? [])].sort((a, b) => b.shares - a.shares)[0];
  if (outside !== null && outside >= 0.35 && trafficTotal >= 20) {
    add({
      id: "outside",
      status: verdict === "viral" || verdict === "above" ? "good" : "neutral",
      title: "Many views came from links shared outside YouTube.",
      detail:
        `${formatShare(outside)} of views came from links in apps, messages and websites` +
        (topSharing && topSharing.shares > 0 ? `. The share button was used most for ${sharingLabel(topSharing.service)}.` : "."),
      weight: 55,
    });
  }
  const searchViews = sum((analytics?.traffic ?? []).filter((row) => row.source === "YT_SEARCH").map((row) => row.views));
  const searchShare = trafficTotal > 0 ? searchViews / trafficTotal : null;
  const terms = (analytics?.searchTerms ?? []).filter((row) => row.term).slice(0, 3);
  if (searchShare !== null && searchShare >= 0.1) {
    add({
      id: "search",
      status: "good",
      title: "People find it by searching on YouTube.",
      detail: `${formatShare(searchShare)} of views came from YouTube search${terms.length ? `, for example “${terms.map((row) => row.term).join("”, “")}”` : ""}.`,
      weight: 45,
    });
  } else if (searchShare !== null && searchShare < 0.03 && ageHours >= 168 && trafficTotal >= 50) {
    add({
      id: "search",
      status: "neutral",
      title: "Almost nobody found it through search.",
      detail: `Only ${formatShare(searchShare)} of views came from YouTube search, so its title and description may not use the words people search for.`,
      weight: 30,
    });
  }

  /* --- Who watched --- */
  const subscribed = analytics?.subscribed ?? null;
  const newViewers = subscribed ? subscribed.other / Math.max(1, subscribed.subscribed + subscribed.other) : null;
  const usualNewViewers = baseline?.subscribedShare === null || baseline?.subscribedShare === undefined ? null : 1 - baseline.subscribedShare;
  const newStatus = compareShare(newViewers, usualNewViewers, RULES.shareMargin);
  if (newViewers !== null && newStatus && newStatus !== "neutral") {
    add({
      id: "newViewers",
      status: newStatus,
      title: newStatus === "good" ? "It's reaching people who don't follow you yet." : "It's mostly reaching people who already follow you.",
      detail: `${formatShare(newViewers)} of views were from people not subscribed to your channel; usually it is ${formatShare(usualNewViewers ?? 0)}.`,
      weight: 65,
    });
  }

  /* --- Likes, comments, shares, subscribers --- */
  const enoughViews = views >= RULES.minViewsForRates;
  const likeRate = perHundred(likes, views);
  const usualLikeRate = median(similar.map((item) => perHundred(item.likes, item.views) ?? NaN));
  const commentRate = perThousand(comments, views);
  const usualCommentRate = median(similar.map((item) => perThousand(item.comments, item.views) ?? NaN));
  const shareRate = totals ? perThousand(totals.shares, totals.views) : null;
  const usualShareRate = median(similar.map((item) => perThousand(item.shares, item.views) ?? NaN));
  const subRate = totals ? perThousand(totals.subscribersGained, totals.views) : null;
  const usualSubRate = median(similar.map((item) => perThousand(item.subscribersGained, item.views) ?? NaN));

  const rateSignal = (
    id: string,
    value: number | null,
    usual: number | null,
    words: { good: string; bad: string; unit: string; weight: number },
  ) => {
    const status = enoughViews ? compareRate(value, usual) : null;
    if (!status || status === "neutral" || value === null || usual === null) return;
    add({
      id,
      status,
      title: status === "good" ? words.good : words.bad,
      detail: `${formatDecimal(value)} ${words.unit}; your usual ${kind} gets ${formatDecimal(usual)}.`,
      weight: words.weight,
    });
  };
  rateSignal("shares", shareRate, usualShareRate, {
    good: "People are sharing it much more than usual.",
    bad: "People share it less than your usual videos.",
    unit: "shares per 1,000 views",
    weight: 60,
  });
  rateSignal("likes", likeRate, usualLikeRate, {
    good: "Viewers like it more than usual.",
    bad: "Fewer viewers press like than usual.",
    unit: "likes per 100 views",
    weight: 40,
  });
  rateSignal("comments", commentRate, usualCommentRate, {
    good: "It's getting more comments than usual.",
    bad: "It's getting fewer comments than usual.",
    unit: "comments per 1,000 views",
    weight: 35,
  });
  rateSignal("subscribers", subRate, usualSubRate, {
    good: "It's winning new subscribers faster than usual.",
    bad: "It's winning fewer new subscribers than usual.",
    unit: "new subscribers per 1,000 views",
    weight: 45,
  });

  /* --- Length --- */
  if (short && duration > 60 && avgPercent !== null && avgPercent < 50) {
    add({
      id: "length",
      status: "bad",
      title: "It may be too long for a Short.",
      detail: `It runs ${formatClock(duration)} and people watched ${formatDecimal(avgPercent)}% of it on average. Shorts under a minute are usually watched to the end more often.`,
      weight: 50,
    });
  }

  /* --- Key numbers --- */
  const waitingNote = "Arrives from YouTube in 1–3 days";
  const kpis: Kpi[] = [
    { id: "views", label: "Views", value: views, typical: usualNow?.median ?? null, format: "count" },
    {
      id: "watched",
      label: "Average part watched",
      value: avgPercent !== null ? avgPercent / 100 : null,
      typical: usualPercent !== null ? usualPercent / 100 : null,
      format: "percent",
      ...(avgPercent === null ? { note: waitingNote } : {}),
    },
    {
      id: "hook",
      label: "Still watching at 0:03",
      value: hook !== null ? Math.min(1, hook) : null,
      typical: usualHook !== null ? Math.min(1, usualHook) : null,
      format: "percent",
      ...(hook === null ? { note: waitingNote } : {}),
    },
    { id: "likes", label: "Likes per 100 views", value: likeRate, typical: usualLikeRate, format: "perHundred" },
    {
      id: "shares",
      label: "Shares per 1,000 views",
      value: shareRate,
      typical: usualShareRate,
      format: "perThousand",
      ...(shareRate === null ? { note: waitingNote } : {}),
    },
    {
      id: "subscribers",
      label: "New subscribers per 1,000 views",
      value: subRate,
      typical: usualSubRate,
      format: "perThousand",
      ...(subRate === null ? { note: waitingNote } : {}),
    },
  ];

  /* --- Charts --- */
  const span = Math.max(6, Math.min(ageHours, CURVE_HOURS));
  const usualCurve: Charts["usual"] = [];
  if (curves.length) {
    for (let i = 0; i <= 48; i++) {
      const hours = (span * i) / 48;
      const point = usualAt(curves, hours);
      if (point) usualCurve.push([hours, point.median, point.low, point.high]);
    }
  }
  const usualRetentionSets = similar.map((item) => item.retention).filter((points): points is number[] => Array.isArray(points) && points.length === 100);
  const usualRetention =
    usualRetentionSets.length >= 3
      ? Array.from({ length: 100 }, (_, i) => [(i + 1) / 100, median(usualRetentionSets.map((points) => points[i])) ?? 0] as [number, number])
      : null;
  const traffic = [...(analytics?.traffic ?? [])].sort((a, b) => b.views - a.views);
  const trafficRows: Charts["traffic"] = traffic.slice(0, 6).map((row) => ({
    source: row.source,
    label: trafficLabel(row.source),
    views: row.views,
    share: trafficTotal > 0 ? row.views / trafficTotal : 0,
    usualShare: baseline && Object.keys(baseline.traffic).length ? baseline.traffic[row.source] ?? 0 : null,
  }));
  if (traffic.length > 6) {
    const rest = traffic.slice(6);
    const restViews = sum(rest.map((row) => row.views));
    trafficRows.push({
      source: "OTHER",
      label: "Everything else",
      views: restViews,
      share: trafficTotal > 0 ? restViews / trafficTotal : 0,
      usualShare:
        baseline && Object.keys(baseline.traffic).length ? sum(rest.map((row) => baseline.traffic[row.source] ?? 0)) : null,
    });
  }
  const countryTotal = sum((analytics?.countries ?? []).map((row) => row.views));
  const deviceTotal = sum((analytics?.devices ?? []).map((row) => row.views));
  const hasAudience = Boolean(subscribed || countryTotal || deviceTotal || analytics?.ages.length);
  const charts: Charts = {
    views: actual,
    usual: usualCurve,
    retention:
      retention.length >= 20
        ? { durationSec: duration, actual: retention.map((point) => [point.ratio, point.watch]), usual: usualRetention, drops }
        : null,
    traffic: trafficRows,
    searchTerms: (analytics?.searchTerms ?? []).slice(0, 8),
    audience: hasAudience
      ? {
          newViewerShare: newViewers,
          usualNewViewerShare: usualNewViewers,
          // Views from the top countries, as a share of all views (the rest are smaller countries).
          countries: (analytics?.countries ?? []).slice(0, 6).map((row) => ({
            name: countryName(row.code),
            share: row.views / Math.max(1, totals?.views ?? countryTotal),
          })),
          devices: (analytics?.devices ?? []).map((row) => ({ name: deviceLabel(row.type), share: row.views / Math.max(1, deviceTotal) })),
          ages: (analytics?.ages ?? []).map((row) => ({ name: ageLabel(row.group), share: row.percent / 100 })),
          genders: (analytics?.genders ?? []).map((row) => ({ name: genderLabel(row.gender), share: row.percent / 100 })),
          sharing: (analytics?.sharing ?? []).filter((row) => row.shares > 0).map((row) => ({ name: sharingLabel(row.service), shares: row.shares })),
        }
      : null,
  };

  /* --- Notes on the numbers --- */
  const notes: string[] = [];
  if (!totals) {
    notes.push(
      "YouTube's detailed numbers (how long people watched, where they came from, who they are) usually arrive 1–3 days after upload. Until then this report uses the live view, like and comment counts.",
    );
  }
  if (usualNow && pool) {
    notes.push(
      pool.format === "all"
        ? `“Your usual” is the middle (median) of your last ${usualNow.count} videos at the same age. There weren't enough earlier ${kinds} to compare like with like, so it uses all of them.`
        : `“Your usual” is the middle (median) of your last ${usualNow.count} ${kinds} at the same age, so one big hit or flop doesn't skew it.`,
    );
  }
  notes.push(
    "YouTube doesn't give apps the number of times the thumbnail was shown or clicked (impressions and click-through rate). You can see them in YouTube Studio under Analytics → Reach.",
  );

  signals.sort((a, b) => b.weight - a.weight);
  return {
    ageHours,
    verdict,
    views,
    ratio,
    usual: usualNow && pool ? { ...usualNow, format: pool.format } : null,
    momentum,
    kpis,
    signals,
    charts,
    notes,
  };
}
