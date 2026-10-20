import "server-only";

/**
 * How long a request may run before the app answers with a timeout, in
 * milliseconds. On Vercel, functions are cut off at 60 seconds (the routes'
 * maxDuration), so the default stays just under that. On your own computer,
 * or a hosting plan that allows longer functions, REQUEST_TIME_LIMIT_SEC can
 * raise it, for example when a thorough model needs longer to write a story.
 */
export function requestTimeLimitMs(): number {
  const seconds = Number(process.env.REQUEST_TIME_LIMIT_SEC?.trim());
  if (!Number.isFinite(seconds) || seconds < 10) return 55_000;
  return Math.min(seconds, 800) * 1000;
}
