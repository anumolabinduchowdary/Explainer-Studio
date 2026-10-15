import { toAppError } from "@/lib/server/appError";
import { isAllowed } from "@/lib/server/auth/config";
import { finishGoogleSignIn } from "@/lib/server/auth/google";
import { activeAuthConfig, limitByIp, redirectTo } from "@/lib/server/auth/routes";
import {
  AUTH_PATH,
  OAUTH_COOKIE,
  clearCookie,
  createSessionToken,
  readCookie,
  requestOrigin,
  sessionCookie,
} from "@/lib/server/auth/session";

/** Google sends the visitor back here. If everything checks out, they are signed in. */
export async function GET(req: Request): Promise<Response> {
  // The sign-in attempt is over either way, so its cookie is always removed.
  const done = clearCookie(req, OAUTH_COOKIE, AUTH_PATH);
  try {
    limitByIp(req, "google");
    const config = activeAuthConfig();
    const params = new URL(req.url).searchParams;
    const person = await finishGoogleSignIn(config, {
      code: params.get("code"),
      state: params.get("state"),
      token: readCookie(req, OAUTH_COOKIE),
      origin: requestOrigin(req),
    });
    if (!person) return redirectTo(req, "/signin?error=google", [done]);
    if (!isAllowed(config.allow, person.email)) return redirectTo(req, "/signin?error=not_allowed", [done]);

    const session = await createSessionToken(config, { ...person, method: "google" });
    return redirectTo(req, "/", [sessionCookie(req, session), done]);
  } catch (err) {
    console.error(`[api/auth/google/callback] ${toAppError(err).code}`);
    return redirectTo(req, "/signin?error=google", [done]);
  }
}
