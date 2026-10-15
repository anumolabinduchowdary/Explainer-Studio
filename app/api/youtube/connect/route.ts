import { startGoogleSignIn } from "@/lib/server/auth/google";
import { cookieHeader, requestOrigin, requireUser } from "@/lib/server/auth/session";
import { toAppError } from "@/lib/server/appError";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { popupPage } from "@/lib/server/youtubePopup";
import {
  YOUTUBE_ATTEMPT_COOKIE,
  YOUTUBE_CALLBACK_PATH,
  YOUTUBE_PATH,
  YOUTUBE_SCOPE,
  youtubeConfig,
} from "@/lib/server/youtube";


/**
 * Opens Google's permission screen, in a small window, asking to let the app
 * upload to the person's YouTube channel. Lasting permission is asked for, so
 * later uploads need no further steps.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const limit = rateLimit(`youtube:connect:${clientIp(req)}`, 20, 60_000);
    if (!limit.ok) return popupPage("failed", "Too many tries. Please wait a minute and try again.");
    await requireUser(req);
    const config = youtubeConfig();
    if (!config) return popupPage("failed", "YouTube uploads are not switched on for this app.");
    const { url, token } = await startGoogleSignIn(config.auth, requestOrigin(req), {
      scope: `openid email ${YOUTUBE_SCOPE}`,
      callbackPath: YOUTUBE_CALLBACK_PATH,
      offline: true,
    });
    const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookieHeader(req, YOUTUBE_ATTEMPT_COOKIE, token, { maxAgeSec: 10 * 60, path: YOUTUBE_PATH }));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const error = toAppError(err);
    console.error(`[api/youtube/connect] ${error.code}`);
    return popupPage("failed", error.code === "signed_out" ? "Please sign in to the app first." : error.message);
  }
}
