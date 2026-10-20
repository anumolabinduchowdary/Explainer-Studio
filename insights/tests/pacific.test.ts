import { describe, expect, it } from "vitest";
import { addDays, pacificDate, pacificDayEnd, pacificMidnight } from "@/lib/pacific";

const HOUR = 3_600_000;

describe("Pacific days", () => {
  it("starts winter days at 08:00 UTC and summer days at 07:00 UTC", () => {
    expect(new Date(pacificMidnight("2026-01-15")).toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(new Date(pacificMidnight("2026-07-15")).toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });

  it("has a 23-hour day when the clocks go forward and a 25-hour day when they go back", () => {
    expect((pacificDayEnd("2026-03-08") - pacificMidnight("2026-03-08")) / HOUR).toBe(23);
    expect((pacificDayEnd("2026-11-01") - pacificMidnight("2026-11-01")) / HOUR).toBe(25);
    expect((pacificDayEnd("2026-06-01") - pacificMidnight("2026-06-01")) / HOUR).toBe(24);
  });

  it("names the Pacific date of a moment", () => {
    // 06:59 UTC on 21 Oct is still 20 Oct in California (UTC−7).
    expect(pacificDate(Date.UTC(2026, 9, 21, 6, 59))).toBe("2026-10-20");
    expect(pacificDate(Date.UTC(2026, 9, 21, 7, 0))).toBe("2026-10-21");
    // A video posted in India at 9 am on 21 Oct is 20 Oct in California.
    expect(pacificDate(Date.UTC(2026, 9, 21, 3, 30))).toBe("2026-10-20");
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
