import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { SESSION_DAYS, SIGN_IN_METHODS, type SessionUser } from "@/lib/auth";
import { AppError } from "../appError";
import { authConfig, isAllowed, type AuthConfig } from "./config";

/**
 * Sessions without a database: a signed token in an HttpOnly cookie says who
 * is signed in. It cannot be read by scripts on the page or changed without
 * the server's secret. The approved-emails list is checked on every request,
 * so removing someone takes effect straight away.
 */

export const SESSION_COOKIE = "es_session";
/** Short-lived cookies used while signing in. They are only sent to /api/auth. */
export const OTP_COOKIE = "es_code";
export const OAUTH_COOKIE = "es_google";
export const AUTH_PATH = "/api/auth";

/** What a token may be used for, so one kind can never stand in for another. */
export type TokenUse = "session" | "email-code" | "google";

export async function signToken(
  config: AuthConfig,
  use: TokenUse,
  claims: JWTPayload,
  lifetimeSec: number,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(use)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSec)
    .sign(config.secret);
}

/** The token's contents, or null if it is missing, forged, expired or meant for something else. */
export async function readToken(
  config: AuthConfig,
  use: TokenUse,
  token: string | undefined,
): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.secret, { algorithms: ["HS256"], audience: use });
    return payload;
  } catch {
    return null;
  }
}

const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export function createSessionToken(config: AuthConfig, user: SessionUser): Promise<string> {
  const claims = { sub: user.email, method: user.method, ...(user.name ? { name: user.name } : {}) };
  return signToken(config, "session", claims, SESSION_SECONDS);
}

/** The signed-in person, or null. Someone no longer on the approved list is signed out. */
export async function readSession(config: AuthConfig, token: string | undefined): Promise<SessionUser | null> {
  const payload = await readToken(config, "session", token);
  const email = typeof payload?.sub === "string" ? payload.sub : "";
  const method = SIGN_IN_METHODS.find((item) => item === payload?.method);
  if (!payload || !email || !method || !isAllowed(config.allow, email)) return null;
  return { email, method, ...(typeof payload.name === "string" ? { name: payload.name } : {}) };
}

/* ------------------------------------------------------------------ */
/* Cookies and requests                                                */
/* ------------------------------------------------------------------ */

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The address the visitor used, e.g. "https://example.org", as the hosting platform reports it. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

type CookieOptions = { maxAgeSec: number; path?: string };

/** A Set-Cookie line. Always HttpOnly and SameSite=Lax; Secure whenever the site is on HTTPS. */
export function cookieHeader(req: Request, name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${value}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${options.maxAgeSec}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(requestOrigin(req).startsWith("https://") ? ["Secure"] : []),
  ].join("; ");
}

export const sessionCookie = (req: Request, token: string) =>
  cookieHeader(req, SESSION_COOKIE, token, { maxAgeSec: SESSION_SECONDS });
export const clearCookie = (req: Request, name: string, path = "/") =>
  cookieHeader(req, name, "", { maxAgeSec: 0, path });

/**
 * Rejects a form or script on another website trying to act for the visitor.
 * Browsers send the Origin header with every cross-site POST.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin && origin !== requestOrigin(req)) {
    throw new AppError("invalid_input", 403, { message: "That request came from another website." });
  }
}

/**
 * Who is making this request. Returns null when sign-in is switched off, and
 * throws when it is on and the visitor is not signed in.
 */
export async function requireUser(req: Request): Promise<SessionUser | null> {
  const config = authConfig();
  if (!config) return null;
  const user = await readSession(config, readCookie(req, SESSION_COOKIE));
  if (!user) throw new AppError("signed_out", 401);
  return user;
}
