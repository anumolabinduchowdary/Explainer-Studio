import { toAppError } from "@/lib/server/appError";
import { startGoogleSignIn } from "@/lib/server/auth/google";
import { activeAuthConfig, limitByIp, redirectTo } from "@/lib/server/auth/routes";
import { AUTH_PATH, OAUTH_COOKIE, cookieHeader, requestOrigin } from "@/lib/server/auth/session";

/** Sends the visitor to Google to choose an account. */
export async function GET(req: Request): Promise<Response> {
  try {
    limitByIp(req, "google");
    const config = activeAuthConfig();
    if (!config.google) return redirectTo(req, "/signin?error=google");
    const { url, token } = await startGoogleSignIn(config, requestOrigin(req));
    return redirectTo(req, url, [cookieHeader(req, OAUTH_COOKIE, token, { maxAgeSec: 10 * 60, path: AUTH_PATH })], 302);
  } catch (err) {
    console.error(`[api/auth/google] ${toAppError(err).code}`);
    return redirectTo(req, "/signin?error=google");
  }
}
