import { SESSION_COOKIE, clearCookie, requestOrigin, sameOrigin } from "@/lib/session";

/** Signs out of this browser. The channel stays connected and keeps being watched. */
export async function POST(req: Request): Promise<Response> {
  const origin = requestOrigin(req);
  if (!sameOrigin(req)) return new Response("That request came from another website.", { status: 403 });
  const headers = new Headers({ Location: `${origin}/`, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearCookie(req, SESSION_COOKIE));
  return new Response(null, { status: 303, headers });
}
