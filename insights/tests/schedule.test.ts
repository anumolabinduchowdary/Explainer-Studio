import { describe, expect, it } from "vitest";
import { dueMilestone, nextCheckAt } from "@/lib/monitor";

const HOUR = 3_600_000;

describe("when to check", () => {
  const posted = Date.UTC(2026, 9, 1);

  it("checks hourly for two days, then every 6 hours, then daily", () => {
    expect(nextCheckAt(posted, posted + 2 * HOUR)).toBe(posted + 3 * HOUR);
    expect(nextCheckAt(posted, posted + 50 * HOUR)).toBe(posted + 56 * HOUR);
    expect(nextCheckAt(posted, posted + 200 * HOUR)).toBe(posted + 224 * HOUR);
  });

  it("never steps over a milestone", () => {
    // At 70 hours, the next 6-hour step would pass the day-3 report at 72 hours.
    expect(nextCheckAt(posted, posted + 70 * HOUR)).toBe(posted + 72 * HOUR + 5 * 60_000);
  });

  it("stops after four weeks", () => {
    expect(nextCheckAt(posted, posted + 672 * HOUR)).toBeNull();
  });

  it("saves only the latest milestone passed, once", () => {
    expect(dueMilestone(10, new Set())).toBeNull();
    expect(dueMilestone(25, new Set())).toBe("day1");
    expect(dueMilestone(100, new Set())).toBe("day3");
    expect(dueMilestone(100, new Set(["day3"]))).toBeNull();
    expect(dueMilestone(700, new Set(["day1", "day3", "week1"]))).toBe("day28");
  });
});
