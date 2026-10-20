import { describe, expect, it } from "vitest";
import { comparable, curveFromDaily, isShort, median, retentionAtSecond, usualAt, valueAt, videoCurve } from "@/lib/baseline";
import { pacificMidnight } from "@/lib/pacific";
import type { BaselineVideo } from "@/lib/types";

const HOUR = 3_600_000;

describe("growth curves", () => {
  // Posted at 6 pm Pacific (summer), so its first Pacific day lasts only 6 hours.
  const posted = pacificMidnight("2026-07-10") + 18 * HOUR;
  const daily = [
    { date: "2026-07-10", views: 100 },
    { date: "2026-07-11", views: 300 },
    { date: "2026-07-12", views: 200 },
    { date: "2026-07-13", views: 50 },
  ];

  it("places each day's views at the hours since posting when that day ended", () => {
    const curve = curveFromDaily(posted, daily, pacificMidnight("2026-07-20"));
    expect(curve).toEqual([
      [0, 0],
      [6, 100],
      [30, 400],
      [54, 600],
      [78, 650],
    ]);
  });

  it("leaves out days YouTube may still be counting", () => {
    const curve = curveFromDaily(posted, daily, pacificMidnight("2026-07-13"));
    expect(curve.at(-1)).toEqual([54, 600]);
  });

  it("reads values between points and nothing past the end", () => {
    const curve: Array<[number, number]> = [
      [0, 0],
      [10, 100],
      [20, 300],
    ];
    expect(valueAt(curve, 5)).toBe(50);
    expect(valueAt(curve, 15)).toBe(200);
    expect(valueAt(curve, 20)).toBe(300);
    expect(valueAt(curve, 21)).toBeNull();
  });

  it("takes the median and middle half of the videos old enough to compare", () => {
    const curves: Array<Array<[number, number]>> = [100, 200, 300, 400, 10_000].map((total) => [
      [0, 0],
      [48, total],
    ]);
    const usual = usualAt(curves, 24)!;
    expect(usual.median).toBe(150);
    expect(usual.low).toBe(100);
    expect(usual.high).toBe(200);
    // One huge hit does not move the median much.
    expect(usual.count).toBe(5);
    // Too few videos reach 100 hours, so there is no usual there.
    expect(usualAt(curves, 100)).toBeNull();
  });

  it("joins YouTube's daily counts with the live counts, never going down", () => {
    const start = pacificMidnight("2026-07-10");
    const curve = videoCurve(
      start,
      [
        { at: start + 30 * HOUR, views: 500, likes: 0, comments: 0 },
        { at: start + 31 * HOUR, views: 490, likes: 0, comments: 0 },
      ],
      [{ date: "2026-07-10", views: 200 }],
      start + 100 * HOUR,
    );
    expect(curve).toEqual([
      [0, 0],
      [24, 200],
      [30, 500],
      [31, 500],
    ]);
  });
});

describe("comparing like with like", () => {
  const video = (id: string, short: boolean) => ({ id, short }) as BaselineVideo;

  it("compares Shorts with Shorts when there are at least three", () => {
    const pool = comparable([video("a", true), video("b", true), video("c", true), video("d", false)], true);
    expect(pool.format).toBe("short");
    expect(pool.videos.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("uses every video when there are too few of the same kind", () => {
    const pool = comparable([video("a", true), video("b", false), video("c", false), video("d", false)], true);
    expect(pool.format).toBe("all");
    expect(pool.videos).toHaveLength(4);
  });

  it("knows a Short: vertical or square, up to three minutes", () => {
    expect(isShort(45, "9:16")).toBe(true);
    expect(isShort(45, "1:1")).toBe(true);
    expect(isShort(45, "16:9")).toBe(false);
    expect(isShort(200, "9:16")).toBe(false);
    expect(isShort(60)).toBe(true);
  });

  it("finds the median and reads a retention curve at a second", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    const points = Array.from({ length: 100 }, (_, i) => 1 - (i + 1) / 200);
    // 3 seconds into a 30-second video is 10% of the way.
    expect(retentionAtSecond(points, 30, 3)).toBeCloseTo(0.95, 5);
  });
});
