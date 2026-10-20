/**
 * YouTube Analytics counts views per day in Pacific time (America/Los_Angeles).
 * These helpers turn those days into real moments, so a day's views can be
 * placed at the right number of hours after a video was published, whatever
 * the time zone and the season.
 */

const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 86_400_000;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Pacific wall-clock time minus UTC at that moment, in milliseconds (about −8 or −7 hours). */
function offsetAt(ms: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Pacific date at this moment, as YouTube writes it: "2026-10-20". */
export function pacificDate(ms: number): string {
  const shifted = new Date(ms + offsetAt(ms));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The moment a Pacific date begins. */
export function pacificMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  // Two passes settle on the right offset even on the days the clocks change.
  let moment = utcMidnight - offsetAt(utcMidnight);
  moment = utcMidnight - offsetAt(moment);
  return moment;
}

/** The moment a Pacific date ends (the next day begins). */
export const pacificDayEnd = (date: string) => pacificMidnight(addDays(date, 1));
