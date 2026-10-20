import { authSettings } from "@/lib/config";
import { safeNext, startSignIn } from "@/lib/google";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { ATTEMPT_COOKIE, AUTH_PATH, cookieHeader, requestOrigin } from "@/lib/session";

/** Sends the visitor to Google's sign-in and permission screen. */
export async function GET(req: Request): Promise<Response> {
  const origin = requestOrigin(req);
  if (!rateLimit(`auth-start:${clientIp(req)}`, 20)) return Response.redirect(`${origin}/?error=busy`, 303);
  try {
    const next = safeNext(new URL(req.url).searchParams.get("next"));
    const { url, token } = await startSignIn(authSettings(), origin, next);
    const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookieHeader(req, ATTEMPT_COOKIE, token, { maxAgeSec: 10 * 60, path: AUTH_PATH }));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error(`[auth/start] ${err instanceof Error ? err.name : "error"}`);
    return Response.redirect(`${origin}/?error=failed`, 303);
  }
}
