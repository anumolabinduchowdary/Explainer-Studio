import "server-only";
import { cookies } from "next/headers";
import { authSettings, setupProblem, studioUrl } from "./config";
import { SESSION_COOKIE, readSession, type SessionUser } from "./session";

/** Who is looking at a page: signed in, signed out, or the app still needs setting up. */
export type PageAuth =
  | { state: "signed-in"; user: SessionUser }
  | { state: "signed-out" }
  | { state: "setup"; message: string };

export async function pageAuth(): Promise<PageAuth> {
  const problem = setupProblem();
  if (problem) return { state: "setup", message: problem };
  const user = await readSession(authSettings(), (await cookies()).get(SESSION_COOKIE)?.value);
  return user ? { state: "signed-in", user } : { state: "signed-out" };
}

export { studioUrl };

/**
 * The time this request is answered. Pages call it after `connection()`, so
 * they are rendered once per request and "3 hours ago" is counted from now.
 */
export const requestTime = () => Date.now();
