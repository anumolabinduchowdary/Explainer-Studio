import { after } from "next/server";
import { authSettings, isAllowed } from "@/lib/config";
import { ANALYTICS_SCOPE, YOUTUBE_READ_SCOPE, finishSignIn } from "@/lib/google";
import { runDue } from "@/lib/monitor";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import {
  ATTEMPT_COOKIE,
  AUTH_PATH,
  clearCookie,
  createSession,
  readCookie,
  requestOrigin,
  sealSecret,
  sessionCookie,
} from "@/lib/session";
import { connectChannel } from "@/lib/store";
import { myChannel } from "@/lib/youtube";

export const maxDuration = 120;

/**
 * Google sends the visitor back here. Signing in also connects the channel
 * that account owns: its permission is encrypted and saved, and the videos
 * Studio sent for it start being checked.
 */
export async function GET(req: Request): Promise<Response> {
  const origin = requestOrigin(req);
  // The attempt is over either way, so its note is always removed.
  const done = clearCookie(req, ATTEMPT_COOKIE, AUTH_PATH);
  const back = (path: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: `${origin}${path}`, "Cache-Control": "no-store" });
    for (const cookie of [done, ...cookies]) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  };
  if (!rateLimit(`auth-callback:${clientIp(req)}`, 20)) return back("/?error=busy");

  try {
    const settings = authSettings();
    const params = new URL(req.url).searchParams;
    if (params.get("error")) return back("/?error=denied");
    const result = await finishSignIn(settings, {
      code: params.get("code"),
      state: params.get("state"),
      token: readCookie(req, ATTEMPT_COOKIE),
      origin,
    });
    if (!result) return back("/?error=failed");
    if (!isAllowed(settings.allow, result.email)) return back("/?error=not_allowed");
    // People can untick permissions on Google's screen; both are needed.
    if (!result.scopes.includes(YOUTUBE_READ_SCOPE) || !result.scopes.includes(ANALYTICS_SCOPE)) return back("/?error=scopes");
    if (!result.refreshToken) return back("/?error=no_refresh");

    const channel = await myChannel(result.accessToken);
    if (!channel?.id) return back("/?error=no_channel");
    const now = Date.now();
    await connectChannel(
      { id: channel.id, title: channel.title, thumbnail: channel.thumbnail, token: await sealSecret(settings, result.refreshToken) },
      result.email,
      now,
    );
    // Check this channel's waiting videos once the page has been answered.
    after(async () => {
      await runDue(90_000).catch((err) => console.error(`[auth/callback] first checks: ${err instanceof Error ? err.name : "error"}`));
    });
    const session = await createSession(settings, { email: result.email, ...(result.name ? { name: result.name } : {}) });
    return back(result.next, [sessionCookie(req, session)]);
  } catch (err) {
    console.error(`[auth/callback] ${err instanceof Error ? err.name : "error"}`);
    return back("/?error=failed");
  }
}
