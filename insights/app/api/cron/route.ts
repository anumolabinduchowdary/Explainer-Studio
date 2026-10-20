import { cronSecret } from "@/lib/config";
import { runDue } from "@/lib/monitor";
import { bearer, sameSecret } from "@/lib/session";

// The longest a function may run on Vercel's free plan with Fluid compute.
export const maxDuration = 300;

/**
 * The scheduler calls this (Vercel Cron sends CRON_SECRET by itself). It
 * checks every video that is due, for up to four minutes; the rest wait for
 * the next run.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = cronSecret();
  if (!secret) return Response.json({ error: { message: "CRON_SECRET is not set." } }, { status: 503 });
  if (!sameSecret(bearer(req), secret)) return Response.json({ error: { message: "Wrong or missing secret." } }, { status: 401 });
  try {
    const result = await runDue(240_000);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[cron] ${err instanceof Error ? err.name : "error"}`);
    return Response.json({ error: { message: "The checks could not run." } }, { status: 500 });
  }
}
