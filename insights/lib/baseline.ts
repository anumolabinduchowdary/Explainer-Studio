import type { BaselineVideo, Format, Snapshot } from "./types";
import { pacificDayEnd } from "./pacific";

/**
 * "Your usual": how the channel's earlier videos grew, hour by hour, and the
 * middle of that range at any age. Pure functions, so they are easy to test.
 */

const HOUR_MS = 3_600_000;
/** Curves are followed for four weeks, the length of the watch. */
export const CURVE_HOURS = 28 * 24;
/** Fewer earlier videos than this, and there is no fair "usual". */
export const MIN_USUAL_VIDEOS = 3;
/** YouTube's daily numbers can take up to three days to settle. */
export const SETTLE_MS = 3 * 86_400_000;

/** A value from sorted numbers, e.g. q = 0.5 for the median. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

export function median(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return clean.length ? quantile(clean, 0.5) : null;
}

/**
 * Turns YouTube's views per Pacific day into [hours since publishing, views so far].
 * Days that end after `completeUntil` are left out: YouTube fills them in later,
 * and a half-counted day would make the curve look flatter than it was.
 */
export function curveFromDaily(
  publishedAt: number,
  daily: ReadonlyArray<{ date: string; views: number }>,
  completeUntil: number,
): Array<[number, number]> {
  const curve: Array<[number, number]> = [[0, 0]];
  let total = 0;
  for (const day of [...daily].sort((a, b) => a.date.localeCompare(b.date))) {
    const end = pacificDayEnd(day.date);
    if (end > completeUntil) break;
    total += Math.max(0, day.views);
    const hours = (end - publishedAt) / HOUR_MS;
    if (hours <= 0) continue;
    if (hours > CURVE_HOURS + 24) break;
    curve.push([hours, total]);
  }
  return curve;
}

/** Views at `hours` along a curve, drawn as straight lines between its points. Null past its end. */
export function valueAt(curve: ReadonlyArray<readonly [number, number]>, hours: number): number | null {
  if (curve.length === 0) return null;
  if (hours <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [h1, v1] = curve[i];
    if (hours <= h1) {
      const [h0, v0] = curve[i - 1];
      return h1 === h0 ? v1 : v0 + ((v1 - v0) * (hours - h0)) / (h1 - h0);
    }
  }
  return null;
}

export type Usual = { median: number; low: number; high: number; count: number };

/** The usual views at an age: the median of the earlier videos old enough to compare, and their middle half. */
export function usualAt(curves: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, hours: number): Usual | null {
  const values = curves
    .map((curve) => valueAt(curve, hours))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (values.length < MIN_USUAL_VIDEOS) return null;
  return { median: quantile(values, 0.5), low: quantile(values, 0.25), high: quantile(values, 0.75), count: values.length };
}

/**
 * The earlier videos to compare with: the same kind (Shorts with Shorts, longer
 * videos with longer videos) when there are enough, otherwise all of them.
 */
export function comparable(videos: readonly BaselineVideo[], short: boolean): { videos: BaselineVideo[]; format: Format | "all" } {
  const same = videos.filter((video) => video.short === short);
  if (same.length >= MIN_USUAL_VIDEOS) return { videos: same, format: short ? "short" : "long" };
  return { videos: [...videos], format: "all" };
}

/**
 * This video's own curve: YouTube's daily counts for the days before tracking
 * began, then the live counts taken at each check. Views never go down.
 */
export function videoCurve(
  publishedAt: number,
  snapshots: readonly Snapshot[],
  daily: ReadonlyArray<{ date: string; views: number }>,
  completeUntil: number,
): Array<[number, number]> {
  const sorted = [...snapshots].sort((a, b) => a.at - b.at);
  const firstLive = sorted.length ? (sorted[0].at - publishedAt) / HOUR_MS : Infinity;
  const points: Array<[number, number]> = curveFromDaily(publishedAt, daily, completeUntil).filter(
    ([hours]) => hours < firstLive,
  );
  for (const snapshot of sorted) {
    const hours = (snapshot.at - publishedAt) / HOUR_MS;
    if (hours >= 0) points.push([hours, snapshot.views]);
  }
  points.sort((a, b) => a[0] - b[0]);
  let highest = 0;
  return points.map(([hours, views]) => {
    highest = Math.max(highest, views);
    return [hours, highest] as [number, number];
  });
}

/** Whether a video counts as a Short: vertical (when known) and up to three minutes long. */
export function isShort(durationSec: number, shape?: string | null): boolean {
  if (durationSec <= 0 || durationSec > 180) return false;
  if (!shape) return true;
  const [w, h] = shape.split(":").map(Number);
  return !(w > 0 && h > 0) || h >= w;
}

/** Share still watching at a given second, read off a retention curve sampled at 1%, 2% … 100% of the video. */
export function retentionAtSecond(points: readonly number[], durationSec: number, second: number): number | null {
  if (!points.length || durationSec <= 0) return null;
  const curve: Array<[number, number]> = points.map((watch, i) => [(i + 1) / points.length, watch]);
  return valueAt([[0, curve[0][1]], ...curve], Math.min(1, second / durationSec));
}
