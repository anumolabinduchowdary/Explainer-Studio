import { authSettings } from "@/lib/config";
import { revoke } from "@/lib/google";
import { SESSION_COOKIE, openSecret, readCookie, readSession, requestOrigin, sameOrigin } from "@/lib/session";
import { canSee, deleteChannel, getChannel } from "@/lib/store";

/**
 * Disconnects a channel: the permission is withdrawn at Google, and the
 * channel, its videos, their checks and reports are deleted.
 */
export async function POST(req: Request): Promise<Response> {
  const origin = requestOrigin(req);
  if (!sameOrigin(req)) return new Response("That request came from another website.", { status: 403 });
  try {
    const settings = authSettings();
    const user = await readSession(settings, readCookie(req, SESSION_COOKIE));
    if (!user) return Response.redirect(`${origin}/`, 303);
    const form = await req.formData();
    const id = String(form.get("channel") ?? "");
    if (!/^UC[\w-]{10,40}$/.test(id) || !(await canSee(user.email, id))) {
      return new Response("You can only disconnect a channel you connected.", { status: 403 });
    }
    const channel = await getChannel(id);
    const refresh = await openSecret(settings, channel?.token);
    if (refresh) await revoke(refresh);
    await deleteChannel(id);
    return Response.redirect(`${origin}/`, 303);
  } catch (err) {
    console.error(`[channel/disconnect] ${err instanceof Error ? err.name : "error"}`);
    return new Response("The channel could not be disconnected. Please try again.", { status: 500 });
  }
}
