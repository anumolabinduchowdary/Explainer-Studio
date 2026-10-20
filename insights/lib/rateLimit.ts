import "server-only";

/**
 * A small per-address limit kept in memory. Each server instance counts on its
 * own, so treat it as a speed bump against accidental loops, not a wall.
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, perWindow: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= perWindow) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [name, times] of hits) if (!times.some((at) => now - at < windowMs)) hits.delete(name);
  }
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
