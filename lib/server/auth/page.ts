import "server-only";
import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/auth";
import { toAppError } from "../appError";
import { authConfig, type AuthConfig } from "./config";
import { SESSION_COOKIE, readSession } from "./session";

export type PageAuth =
  /** Sign-in is switched off: the app is open, as it was before sign-in existed. */
  | { state: "off" }
  | { state: "signed-in"; user: SessionUser }
  | { state: "signed-out"; methods: { google: boolean; email: boolean } }
  /** A sign-in setting is missing. The app stays closed and says which one. */
  | { state: "misconfigured"; message: string };

/** Who is looking at a page, worked out on the server from the session cookie. */
export async function pageAuth(): Promise<PageAuth> {
  let config: AuthConfig | null;
  try {
    config = authConfig();
  } catch (err) {
    return { state: "misconfigured", message: toAppError(err).message };
  }
  if (!config) return { state: "off" };
  const user = await readSession(config, (await cookies()).get(SESSION_COOKIE)?.value);
  if (user) return { state: "signed-in", user };
  return { state: "signed-out", methods: { google: config.google !== null, email: config.email !== null } };
}
