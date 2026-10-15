import { redirectTo } from "@/lib/server/auth/routes";
import { SESSION_COOKIE, clearCookie, requestOrigin } from "@/lib/server/auth/session";

/** Signs the visitor out by removing the session cookie, then shows the sign-in page. */
export async function POST(req: Request): Promise<Response> {
  // Another website must not be able to sign people out.
  const origin = req.headers.get("origin");
  if (origin && origin !== requestOrigin(req)) return new Response(null, { status: 403 });
  return redirectTo(req, "/signin", [clearCookie(req, SESSION_COOKIE)]);
}
