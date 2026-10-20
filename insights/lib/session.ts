import "server-only";
import { timingSafeEqual } from "node:crypto";
import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify, type JWTPayload } from "jose";
import { isAllowed, type AuthSettings } from "./config";

/**
 * Cookies and secrets.
 *
 * The session cookie is a signed token naming the Google account that signed
 * in. It is HttpOnly (scripts on the page cannot read it), SameSite=Lax and
 * Secure on HTTPS. Google permissions are kept in the database encrypted, so
 * a copy of the database alone cannot be used to read anyone's channel.
 */

export const SESSION_COOKIE = "vi_session";
/** The short-lived note kept while the person is on Google's screen. */
export const ATTEMPT_COOKIE = "vi_google";
export const AUTH_PATH = "/api/auth";
const SESSION_DAYS = 30;

type TokenUse = "session" | "google";

export async function signToken(settings: AuthSettings, use: TokenUse, claims: JWTPayload, lifetimeSec: number): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`insights-${use}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSec)
    .sign(settings.secret);
}

export async function readToken(settings: AuthSettings, use: TokenUse, token: string | undefined | null): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, settings.secret, { algorithms: ["HS256"], audience: `insights-${use}` });
    return payload;
  } catch {
    return null;
  }
}

/** Encrypts a Google refresh token for the database. */
export async function sealSecret(settings: AuthSettings, secret: string): Promise<string> {
  return new EncryptJWT({ rt: secret })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience("insights-refresh-token")
    .setIssuedAt()
    .encrypt(settings.tokenKey);
}

/** The refresh token, or null if it cannot be opened (for example after AUTH_SECRET changed). */
export async function openSecret(settings: AuthSettings, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  try {
    const { payload } = await jwtDecrypt(sealed, settings.tokenKey, { audience: "insights-refresh-token" });
    return typeof payload.rt === "string" ? payload.rt : null;
  } catch {
    return null;
  }
}

export type SessionUser = { email: string; name?: string };

export function createSession(settings: AuthSettings, user: SessionUser): Promise<string> {
  return signToken(settings, "session", { sub: user.email, ...(user.name ? { name: user.name } : {}) }, SESSION_DAYS * 86400);
}

/** The signed-in person, or null. Someone no longer on ALLOWED_EMAILS is signed out. */
export async function readSession(settings: AuthSettings, token: string | undefined | null): Promise<SessionUser | null> {
  const payload = await readToken(settings, "session", token);
  const email = typeof payload?.sub === "string" ? payload.sub : "";
  if (!email || !isAllowed(settings.allow, email)) return null;
  return { email, ...(typeof payload?.name === "string" ? { name: payload.name } : {}) };
}

/* ------------------------------------------------------------------ */
/* Requests and cookies                                                */
/* ------------------------------------------------------------------ */

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The address the visitor used, e.g. "https://insights.example.org". */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function cookieHeader(req: Request, name: string, value: string, options: { maxAgeSec: number; path?: string }): string {
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
  cookieHeader(req, SESSION_COOKIE, token, { maxAgeSec: SESSION_DAYS * 86400 });
export const clearCookie = (req: Request, name: string, path = "/") => cookieHeader(req, name, "", { maxAgeSec: 0, path });

/** True when the request came from this site (browsers send Origin with every cross-site POST). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === requestOrigin(req);
}

/** Compares two secrets without leaking, through timing, how much of them matched. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The secret in an "Authorization: Bearer …" header. */
export function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}
