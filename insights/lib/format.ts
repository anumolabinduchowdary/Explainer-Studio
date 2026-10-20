/** Numbers and times in plain words, the same on the server and in the page. */

const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** 950 -> "950", 1234 -> "1,234", 12345 -> "12.3K". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "–";
  return Math.abs(value) >= 10_000 ? compact.format(value) : whole.format(Math.round(value));
}

/** 0.4567 -> "46%". */
export function formatShare(share: number): string {
  if (!Number.isFinite(share)) return "–";
  const percent = share * 100;
  return `${percent > 0 && percent < 1 ? "<1" : whole.format(percent)}%`;
}

/** 2.345 -> "2.3×". */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "–";
  return `${ratio >= 10 ? whole.format(ratio) : oneDecimal.format(ratio)}×`;
}

export const formatDecimal = (value: number) => (Number.isFinite(value) ? oneDecimal.format(value) : "–");

/** 75 -> "1:15". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Hours since publishing, in words: "40 minutes", "5 hours", "3 days". */
export function formatAge(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (hours < 48) {
    const rounded = Math.round(hours);
    return `${rounded} hour${rounded === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** A moment, relative to now: "just now", "12 minutes ago", "3 days ago". */
export function formatAgo(at: number, now: number): string {
  const hours = (now - at) / 3_600_000;
  if (hours < 1 / 60) return "just now";
  return `${formatAge(hours)} ago`;
}

/** A short date in the reader's language, e.g. "20 Oct 2026". */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
}
