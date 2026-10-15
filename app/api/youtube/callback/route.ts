import { toAppError } from "@/lib/server/appError";
import { finishGoogleSignIn } from "@/lib/server/auth/google";
import { clearCookie, readCookie, requestOrigin, requireUser } from "@/lib/server/auth/session";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { popupPage } from "@/lib/server/youtubePopup";
import {
  YOUTUBE_ATTEMPT_COOKIE,
  YOUTUBE_CALLBACK_PATH,
  YOUTUBE_PATH,
  YOUTUBE_SCOPE,
  accountCookie,
  youtubeConfig,
} from "@/lib/server/youtube";

/** Google sends the person back here after the permission screen. */
export async function GET(req: Request): Promise<Response> {
  // The attempt is over either way, so its note is always removed.
  const done = clearCookie(req, YOUTUBE_ATTEMPT_COOKIE, YOUTUBE_PATH);
  try {
    const limit = rateLimit(`youtube:callback:${clientIp(req)}`, 20, 60_000);
    if (!limit.ok) return popupPage("failed", "Too many tries. Please wait a minute and try again.", [done]);
    await requireUser(req);
    const config = youtubeConfig();
    if (!config) return popupPage("failed", "YouTube uploads are not switched on for this app.", [done]);

    const params = new URL(req.url).searchParams;
    if (params.get("error")) {
      return popupPage("failed", "Uploading was not allowed on Google's screen. Try again and press Allow.", [done]);
    }
    const result = await finishGoogleSignIn(config.auth, {
      code: params.get("code"),
      state: params.get("state"),
      token: readCookie(req, YOUTUBE_ATTEMPT_COOKIE),
      origin: requestOrigin(req),
      callbackPath: YOUTUBE_CALLBACK_PATH,
    });
    if (!result) return popupPage("failed", "Google's answer could not be checked. Please try again.", [done]);
    // People can untick permissions on Google's screen; uploading is the one this needs.
    if (!result.scopes?.includes(YOUTUBE_SCOPE)) {
      return popupPage("failed", "Permission to upload videos was not given. Try again and tick it on Google's screen.", [done]);
    }
    if (!result.refreshToken) {
      return popupPage("failed", "Google did not give lasting permission. Please try again.", [done]);
    }
    const account = await accountCookie(req, config, { refreshToken: result.refreshToken, email: result.email });
    return popupPage("connected", "", [account, done]);
  } catch (err) {
    const error = toAppError(err);
    console.error(`[api/youtube/callback] ${error.code}`);
    return popupPage("failed", error.code === "signed_out" ? "Please sign in to the app first." : error.message, [done]);
  }
}
