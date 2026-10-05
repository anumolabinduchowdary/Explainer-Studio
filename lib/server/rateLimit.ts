/**
 * Per-IP fixed-window rate limiter held in memory.
 *
 * Good enough for v1 (no database). On serverless hosts each instance keeps
 * its own counters, so treat this as a speed bump rather than a hard quota.
 * For strict limits, swap this for a shared store (see README).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) prune(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count >= limit) return { ok: false, remaining: 0, retryAfterSec };
  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, retryAfterSec };
}

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  // Still full of live entries: drop the oldest so memory stays bounded.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const overflow = buckets.size - MAX_TRACKED_KEYS + 1;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= overflow) break;
    }
  }
}

/** Best-effort client IP. Vercel sets x-forwarded-for itself, so it can be trusted there. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function requestsPerMinute(): number {
  const parsed = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10;
}

/** Pictures cost more than text, so they have their own allowance. */
export function imagesPerMinute(): number {
  const parsed = Number(process.env.RATE_LIMIT_IMAGES_PER_MINUTE);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 24;
}

/** One request per spoken line; a story has a dozen or more. */
export function speechPerMinute(): number {
  const parsed = Number(process.env.RATE_LIMIT_SPEECH_PER_MINUTE);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 60;
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
