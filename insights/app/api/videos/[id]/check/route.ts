import { authSettings } from "@/lib/config";
import { formatAge } from "@/lib/format";
import { CHECK_NOW_GAP, REFRESH_ON_VIEW, checkVideo } from "@/lib/monitor";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { SESSION_COOKIE, readCookie, readSession, sameOrigin } from "@/lib/session";
import { canSee, getVideo } from "@/lib/store";

export const maxDuration = 120;

const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Checks one video now. Opening a report asks for this when the last check is
 * old; "Check now" asks with `manual: true`.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/check">): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, message: "That request came from another website." }, 403);
  if (!rateLimit(`check:${clientIp(req)}`, 30)) return json({ ok: false, message: "Too many checks. Please wait a minute." }, 429);
  try {
    const user = await readSession(authSettings(), readCookie(req, SESSION_COOKIE));
    if (!user) return json({ ok: false, message: "Please sign in again." }, 401);
    const { id } = await ctx.params;
    const video = await getVideo(id);
    if (!video || !(await canSee(user.email, video.channel_id))) return json({ ok: false, message: "Video not found." }, 404);
    const body = (await req.json().catch(() => ({}))) as { manual?: unknown };
    const manual = body.manual === true;

    if (video.state === "finished" || video.state === "gone") {
      return json(manual ? { ok: false, message: "This video is no longer being watched, so its last report stays as it is." } : { ok: true, fresh: true });
    }
    const since = Date.now() - (video.last_check_at ?? 0);
    if (!manual && since < REFRESH_ON_VIEW) return json({ ok: true, fresh: true });
    if (manual && since < CHECK_NOW_GAP) {
      return json({ ok: false, message: `Checked ${formatAge(since / 3_600_000)} ago. You can check again in a few minutes.` });
    }
    const result = await checkVideo(id, { manual });
    return json(result.ok ? { ok: true } : { ok: false, message: result.message });
  } catch (err) {
    console.error(`[videos/check] ${err instanceof Error ? err.name : "error"}`);
    return json({ ok: false, message: "The check could not run. Please try again." }, 500);
  }
}
