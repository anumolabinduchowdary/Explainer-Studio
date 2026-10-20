import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthSettings } from "./config";
import { readToken, signToken } from "./session";

/**
 * "Sign in with Google", which also gives the app permission to read the
 * channel's YouTube numbers. The standard OpenID Connect code flow with PKCE,
 * a one-off state and nonce, and a check of Google's signature on the answer
 * (the same flow Explainer Studio uses, in lib/server/auth/google.ts there).
 * Addresses are from https://accounts.google.com/.well-known/openid-configuration
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const CALLBACK_PATH = "/api/auth/callback";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const SCOPE = `openid email ${YOUTUBE_READ_SCOPE} ${ANALYTICS_SCOPE}`;

const random = () => randomBytes(32).toString("base64url");

/** Only pages of this app may be returned to after signing in. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(videos\/[\w-]{6,20})?$/.test(next) ? next : "/";
}

/** Where to send the visitor, and a signed note to keep in their browser so Google's answer can be matched to it. */
export async function startSignIn(settings: AuthSettings, origin: string, next = "/"): Promise<{ url: string; token: string }> {
  const state = random();
  const nonce = random();
  const verifier = random();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: settings.google.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: SCOPE,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    // Lasting permission, so the app can check videos while nobody is looking.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();
  return { url: url.toString(), token: await signToken(settings, "google", { state, nonce, verifier, next: safeNext(next) }, 10 * 60) };
}

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export type SignInResult = {
  /** The page to return to. */
  next: string;
  email: string;
  name?: string;
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
};

/** Finishes the sign-in. Null if anything does not add up. */
export async function finishSignIn(
  settings: AuthSettings,
  answer: { code: string | null; state: string | null; token: string | undefined; origin: string },
  { keys = googleKeys, signal }: { keys?: JWTVerifyGetKey; signal?: AbortSignal } = {},
): Promise<SignInResult | null> {
  const { code, state, token, origin } = answer;
  if (!code || !state) return null;
  const attempt = await readToken(settings, "google", token);
  if (!attempt || typeof attempt.state !== "string" || typeof attempt.nonce !== "string" || typeof attempt.verifier !== "string") {
    return null;
  }
  if (!same(attempt.state, state)) return null;

  let tokens: { id_token?: unknown; access_token?: unknown; refresh_token?: unknown; scope?: unknown };
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: settings.google.clientId,
        client_secret: settings.google.clientSecret,
        redirect_uri: `${origin}${CALLBACK_PATH}`,
        grant_type: "authorization_code",
        code_verifier: attempt.verifier,
      }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    tokens = await response.json();
  } catch {
    return null;
  }
  if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string") return null;

  try {
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      issuer: ISSUERS,
      audience: settings.google.clientId,
      algorithms: ["RS256"],
    });
    if (typeof payload.nonce !== "string" || !same(payload.nonce, attempt.nonce)) return null;
    if (typeof payload.email !== "string" || payload.email_verified !== true) return null;
    return {
      next: safeNext(typeof attempt.next === "string" ? attempt.next : "/"),
      email: payload.email.trim().toLowerCase(),
      ...(typeof payload.name === "string" && payload.name.trim() ? { name: payload.name.trim().slice(0, 80) } : {}),
      accessToken: tokens.access_token,
      ...(typeof tokens.refresh_token === "string" && tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/) : [],
    };
  } catch {
    return null;
  }
}

/** The permission was withdrawn, or (for Google apps still in Testing) ran out after 7 days. */
export class PermissionLost extends Error {
  constructor() {
    super("Google permission is no longer valid.");
    this.name = "PermissionLost";
  }
}

/** A fresh access token, valid for about an hour. */
export async function accessToken(settings: AuthSettings, refreshToken: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        client_id: settings.google.clientId,
        client_secret: settings.google.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("Google could not be reached.");
  }
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
  if (body?.error === "invalid_grant") throw new PermissionLost();
  if (!response.ok || typeof body?.access_token !== "string") throw new Error("Google did not give a fresh permission.");
  return body.access_token;
}

/** Withdraws the permission at Google, so it can never be used again. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    body: new URLSearchParams({ token: refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
