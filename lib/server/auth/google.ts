import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { readToken, signToken } from "./session";
import type { AuthConfig } from "./config";

/**
 * "Continue with Google": the standard OpenID Connect sign-in (authorisation
 * code flow with PKCE). Addresses are from Google's published configuration:
 * https://accounts.google.com/.well-known/openid-configuration
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_URL = GOOGLE_TOKEN_URL;
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Google's public keys, fetched and cached by the library. */
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
const random = () => randomBytes(32).toString("base64url");

/** What a Google request asks for, and where Google sends the person back. */
export type GoogleFlow = {
  scope: string;
  callbackPath: string;
  /** Ask for lasting permission (a refresh token), as uploading to YouTube later needs. */
  offline?: boolean;
};

export const SIGN_IN_FLOW: GoogleFlow = { scope: "openid email profile", callbackPath: GOOGLE_CALLBACK_PATH };

/**
 * Starts a sign-in: where to send the visitor, and a signed note to keep in
 * their browser so the answer can be matched to this attempt.
 */
export async function startGoogleSignIn(
  config: AuthConfig,
  origin: string,
  flow: GoogleFlow = SIGN_IN_FLOW,
): Promise<{ url: string; token: string }> {
  if (!config.google) throw new Error("Google sign-in is not set up.");
  const state = random();
  const nonce = random();
  const verifier = random();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${origin}${flow.callbackPath}`,
    response_type: "code",
    scope: flow.scope,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(flow.offline
      ? // A refresh token is only given with consent shown; earlier permissions are kept.
        { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }
      : { prompt: "select_account" }),
  }).toString();
  const note = { state, nonce, verifier, back: flow.callbackPath };
  return { url: url.toString(), token: await signToken(config, "google", note, 10 * 60) };
}

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

type Finish = {
  code: string | null;
  state: string | null;
  token: string | undefined;
  origin: string;
  /** Which return address this is, so an attempt started for one purpose cannot finish another. */
  callbackPath?: string;
};
type Options = { keys?: JWTVerifyGetKey; signal?: AbortSignal };

export type GoogleResult = {
  email: string;
  name?: string;
  /** Only when lasting permission was asked for and given. Never leaves the server unencrypted. */
  refreshToken?: string;
  /** The permissions the person actually granted (they can untick some on Google's screen). */
  scopes?: string[];
};

/**
 * Finishes a sign-in after Google sends the visitor back. Returns the
 * person's verified email address, or null if anything does not add up.
 */
export async function finishGoogleSignIn(
  config: AuthConfig,
  { code, state, token, origin, callbackPath = GOOGLE_CALLBACK_PATH }: Finish,
  { keys = googleKeys, signal }: Options = {},
): Promise<GoogleResult | null> {
  if (!config.google || !code || !state) return null;
  const attempt = await readToken(config, "google", token);
  if (!attempt || typeof attempt.state !== "string" || typeof attempt.nonce !== "string") return null;
  if (typeof attempt.verifier !== "string" || !same(attempt.state, state)) return null;
  if ((attempt.back ?? GOOGLE_CALLBACK_PATH) !== callbackPath) return null;

  let idToken: unknown;
  let refreshToken: unknown;
  let granted: unknown;
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: `${origin}${callbackPath}`,
        grant_type: "authorization_code",
        code_verifier: attempt.verifier,
      }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const tokens = (await response.json()) as { id_token?: unknown; refresh_token?: unknown; scope?: unknown };
    idToken = tokens.id_token;
    refreshToken = tokens.refresh_token;
    granted = tokens.scope;
  } catch {
    return null;
  }
  if (typeof idToken !== "string") return null;

  try {
    // Checks Google's signature, that the token was issued for this app, and that it has not expired.
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: ISSUERS,
      audience: config.google.clientId,
      algorithms: ["RS256"],
    });
    if (typeof payload.nonce !== "string" || !same(payload.nonce, attempt.nonce)) return null;
    if (typeof payload.email !== "string" || payload.email_verified !== true) return null;
    return {
      email: payload.email.trim().toLowerCase(),
      ...(typeof payload.name === "string" && payload.name.trim() ? { name: payload.name.trim().slice(0, 80) } : {}),
      ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}),
      ...(typeof granted === "string" && granted ? { scopes: granted.split(/\s+/) } : {}),
    };
  } catch {
    return null;
  }
}
