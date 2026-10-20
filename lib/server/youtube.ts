import "server-only";
import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt, type JWTPayload } from "jose";
import type { SessionUser } from "@/lib/auth";
import { SOCIAL_HANDLE } from "@/lib/config";
import { disclaimerLines } from "@/lib/disclaimer";
import { TRUSTED_SOURCES } from "@/lib/quality";
import type { ApiErrorBody } from "@/lib/errors";
import { YOUTUBE_LIMITS, type VideoDetails } from "@/lib/youtube";
import { AppError, describeForLog, toAppError } from "./appError";
import { authConfig, type AuthConfig, type GoogleSettings } from "./auth/config";
import { GOOGLE_TOKEN_URL } from "./auth/google";
import { assertSameOrigin, cookieHeader, readCookie, requireUser } from "./auth/session";
import { missingSetting } from "./openai";
import { clientIp, rateLimit } from "./rateLimit";

/**
 * YouTube uploads on the server.
 *
 * The channel's permission (a Google refresh token) is kept in the person's
 * own browser, inside an HttpOnly cookie encrypted with a key derived from
 * AUTH_SECRET, so it cannot be read by scripts on the page or by anyone
 * without the server's secret. Every request to YouTube is made from here.
 *
 * Addresses and limits are from the YouTube Data API documentation:
 * https://developers.google.com/youtube/v3/docs/videos/insert
 * https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_PATH = "/api/youtube";
export const YOUTUBE_CALLBACK_PATH = "/api/youtube/callback";
/** The connected channel's permission, encrypted. */
export const YOUTUBE_COOKIE = "es_youtube";
/** The short-lived note kept while the person is on Google's permission screen. */
export const YOUTUBE_ATTEMPT_COOKIE = "es_youtube_try";
const ACCOUNT_DAYS = 180;

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const PRIVACY = ["public", "unlisted", "private"] as const;
export type Privacy = (typeof PRIVACY)[number];

export type YouTubeConfig = {
  auth: AuthConfig & { google: GoogleSettings };
  privacy: Privacy;
  categoryId: string;
  /** Encrypts what is kept in the browser. Derived from AUTH_SECRET. */
  key: Uint8Array;
};

/**
 * The upload settings, or null when YouTube uploads are switched off.
 * They need Google sign-in, because the same Google app asks for permission
 * to post, and only people who have signed in may use them.
 */
export function youtubeConfig(): YouTubeConfig | null {
  if (process.env.YOUTUBE_UPLOADS?.trim().toLowerCase() !== "on") return null;
  const auth = authConfig();
  if (!auth) throw new AppError("server_misconfigured", 500, { message: missingSetting("AUTH_SECRET") });
  if (!auth.google) {
    throw new AppError("server_misconfigured", 500, { message: missingSetting("GOOGLE_CLIENT_ID") });
  }
  const wanted = process.env.YOUTUBE_PRIVACY?.trim().toLowerCase() ?? "";
  const category = process.env.YOUTUBE_CATEGORY_ID?.trim() ?? "";
  return {
    auth: auth as YouTubeConfig["auth"],
    privacy: (PRIVACY as readonly string[]).includes(wanted) ? (wanted as Privacy) : "public",
    // 27 is "Education".
    categoryId: /^\d{1,3}$/.test(category) ? category : "27",
    key: createHash("sha256").update("explainer-studio youtube\n").update(auth.secret).digest(),
  };
}

/* ------------------------------------------------------------------ */
/* Sealed values kept in the browser                                   */
/* ------------------------------------------------------------------ */

/** "youtube-receipt": proof that this browser has just uploaded a video, for Video Insights. */
type SealUse = "youtube-account" | "youtube-upload" | "youtube-receipt";

export async function seal(config: YouTubeConfig, use: SealUse, claims: JWTPayload, lifetimeSec: number): Promise<string> {
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience(use)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSec)
    .encrypt(config.key);
}

export async function unseal(config: YouTubeConfig, use: SealUse, token: string | undefined | null): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, config.key, { audience: use });
    return payload;
  } catch {
    return null;
  }
}

export type YouTubeAccount = { refreshToken: string; email: string };

export async function accountCookie(req: Request, config: YouTubeConfig, account: YouTubeAccount): Promise<string> {
  const sealed = await seal(config, "youtube-account", { rt: account.refreshToken, email: account.email }, ACCOUNT_DAYS * 86400);
  return cookieHeader(req, YOUTUBE_COOKIE, sealed, { maxAgeSec: ACCOUNT_DAYS * 86400, path: YOUTUBE_PATH });
}

export async function readAccount(req: Request, config: YouTubeConfig): Promise<YouTubeAccount | null> {
  const payload = await unseal(config, "youtube-account", readCookie(req, YOUTUBE_COOKIE));
  if (typeof payload?.rt !== "string" || typeof payload.email !== "string") return null;
  return { refreshToken: payload.rt, email: payload.email };
}

/* ------------------------------------------------------------------ */
/* Talking to Google and YouTube                                       */
/* ------------------------------------------------------------------ */

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppError("youtube_failed", 502);
  }
}

/**
 * Turns a YouTube error into one of ours. YouTube's message is not passed on:
 * it can repeat parts of the request.
 */
async function youtubeError(response: Response): Promise<AppError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { errors?: Array<{ reason?: string }> };
  } | null;
  const reasons = (body?.error?.errors ?? []).map((item) => item.reason ?? "");
  if (response.status === 401 || reasons.includes("authError")) return new AppError("youtube_reconnect", 401);
  if (reasons.some((reason) => reason === "quotaExceeded" || reason === "uploadLimitExceeded" || reason === "dailyLimitExceeded")) {
    return new AppError("youtube_quota", 429);
  }
  if (reasons.includes("youtubeSignupRequired")) {
    return new AppError("youtube_failed", 403, {
      message: "This Google account has no YouTube channel yet. Create a channel on YouTube, then connect again.",
    });
  }
  if (reasons.includes("insufficientPermissions") || reasons.includes("forbidden")) {
    return new AppError("youtube_reconnect", 403, {
      message: "The app was not given permission to upload to this channel. Connect YouTube again and allow uploading.",
    });
  }
  return new AppError("youtube_failed", response.status >= 500 ? 503 : 502);
}

/** A fresh access token for the connected channel, valid for about an hour. */
export async function accessToken(config: YouTubeConfig, account: YouTubeAccount, signal?: AbortSignal): Promise<string> {
  const response = await call(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.auth.google.clientId,
      client_secret: config.auth.google.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
  // "invalid_grant": the permission was removed, or (for apps Google has not reviewed) ran out after 7 days.
  if (!response.ok) throw new AppError(body?.error === "invalid_grant" ? "youtube_reconnect" : "youtube_failed", 401);
  if (typeof body?.access_token !== "string") throw new AppError("youtube_failed", 502);
  return body.access_token;
}

/** Forgets the permission at Google too, so it cannot be used again. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, { method: "POST", body: new URLSearchParams({ token: refreshToken }), cache: "no-store" }).catch(
    () => undefined,
  );
}

/** Opens a resumable upload and returns its address (YouTube's "session URI"). */
export async function startUpload(
  config: YouTubeConfig,
  token: string,
  details: VideoDetails,
  size: number,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${UPLOAD_URL}?${new URLSearchParams({ uploadType: "resumable", part: "snippet,status" })}`;
  // The audience ("made for kids") is deliberately not set: YouTube uses the channel's own setting.
  const video = {
    snippet: {
      title: details.title,
      description: details.description,
      tags: details.tags,
      categoryId: config.categoryId,
      ...(details.language ? { defaultLanguage: details.language } : {}),
    },
    status: { privacyStatus: config.privacy, embeddable: true },
  };
  const body = JSON.stringify(video);
  const response = await call(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": mimeType,
    },
    body,
    signal,
  });
  if (!response.ok) throw await youtubeError(response);
  const session = response.headers.get("location");
  if (!session || !isYouTubeUpload(session)) throw new AppError("youtube_failed", 502);
  return session;
}

/** Only YouTube's own upload addresses are ever written to. */
export function isYouTubeUpload(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname.startsWith("/upload/youtube/");
  } catch {
    return false;
  }
}

/** The channel's id stays on the server: it only goes into the upload's receipt. */
export type ChunkResult = { done: false; received: number } | { done: true; videoId: string; channelId?: string };

/** Sends one piece of the video to the open upload. */
export async function sendChunk(
  session: string,
  token: string,
  bytes: Uint8Array<ArrayBuffer>,
  start: number,
  total: number,
  signal?: AbortSignal,
): Promise<ChunkResult> {
  if (!isYouTubeUpload(session)) throw new AppError("youtube_failed", 400);
  const end = start + bytes.length - 1;
  const response = await call(session, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(bytes.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: bytes,
    signal,
  });
  if (response.status === 308) {
    // "Resume Incomplete": the Range header says how much YouTube has so far.
    const range = response.headers.get("range")?.match(/bytes=0-(\d+)/);
    return { done: false, received: range ? Number(range[1]) + 1 : 0 };
  }
  if (response.status === 404) {
    throw new AppError("youtube_failed", 410, { message: "The upload took too long and was closed by YouTube. Please press Upload again." });
  }
  if (!response.ok) throw await youtubeError(response);
  const video = (await response.json().catch(() => null)) as { id?: unknown; snippet?: { channelId?: unknown } } | null;
  if (typeof video?.id !== "string") throw new AppError("youtube_failed", 502);
  const channelId = video.snippet?.channelId;
  return { done: true, videoId: video.id, ...(typeof channelId === "string" && channelId ? { channelId } : {}) };
}

/** Sets the video's thumbnail. Returns a reason instead of failing: the video is already up. */
export async function setThumbnail(token: string, videoId: string, jpeg: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string }> {
  const url = `${THUMBNAIL_URL}?${new URLSearchParams({ videoId, uploadType: "media" })}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
      body: jpeg,
      signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "YouTube could not be reached to set the thumbnail." };
  }
  if (response.ok) return { ok: true };
  if (response.status === 403) {
    return {
      ok: false,
      reason: "YouTube did not allow a custom thumbnail. Channels usually need to be verified by phone in YouTube Studio first.",
    };
  }
  return { ok: false, reason: "YouTube did not accept the thumbnail, so it chose one from the video." };
}

/* ------------------------------------------------------------------ */
/* Title, description and tags                                         */
/* ------------------------------------------------------------------ */

/** YouTube does not allow < or > in titles and descriptions. */
const clean = (text: string) => text.replace(/[<>]/g, "").replace(/[ \t]+/g, " ").trim();

function fitBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let cut = text;
  while (Buffer.byteLength(cut) > maxBytes - 3) cut = cut.slice(0, Math.floor(cut.length * 0.95));
  return `${cut.trimEnd()}…`;
}

export type DetailsDraft = { title: string; summary: string; points: string[]; hashtags: string[]; tags: string[] };

/**
 * Puts together what YouTube receives. The AI writes the title, summary,
 * points and tags; the lines every video must carry (the health disclaimer,
 * the AI-voice statement, the channel to follow) are added here, so they are
 * always there and always worded the same.
 */
export function composeDetails(
  draft: DetailsDraft,
  facts: {
    fallbackTitle: string;
    health: boolean;
    aiVoices: boolean;
    /** A short code for YouTube, e.g. "hi". */
    language?: string;
    /** The video's language by name, e.g. "Hindi", for the disclaimer's translation. */
    languageName?: string;
    /** Trusted organisations to list under "Learn more". Only ones on the app's own list are kept. */
    sources?: ReadonlyArray<{ name: string; url: string }>;
    /** Whether to ask viewers to follow the account: only for videos that end with its QR card. */
    follow?: boolean;
  },
): VideoDetails {
  let title = clean(draft.title) || clean(facts.fallbackTitle) || "New video";
  if (title.length > YOUTUBE_LIMITS.title) title = `${title.slice(0, YOUTUBE_LIMITS.title - 1).trimEnd()}…`;

  const hashtags = [...new Set(draft.hashtags.map((tag) => tag.replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean))]
    .slice(0, 5)
    .map((tag) => `#${tag}`);
  const fixed = [
    ...(facts.health ? disclaimerLines(facts.languageName ?? "") : []),
    facts.aiVoices ? "The voices in this video are AI-generated." : "",
    facts.follow === false ? "" : `Follow ${SOCIAL_HANDLE} for more.`,
  ].filter(Boolean);
  const points = draft.points.map(clean).filter(Boolean).slice(0, 5).map((point) => `• ${point}`);
  const trusted = (facts.sources ?? [])
    .map((source) => TRUSTED_SOURCES.find((known) => known.url === source.url))
    .filter((source): source is (typeof TRUSTED_SOURCES)[number] => Boolean(source))
    .slice(0, 3);
  const learnMore = trusted.length ? ["Learn more:", ...trusted.map((source) => `${source.name}: ${source.url}`)].join("\n") : "";
  const tail = [learnMore, fixed.join("\n"), hashtags.join(" ")].filter(Boolean).join("\n\n");
  const room = YOUTUBE_LIMITS.descriptionBytes - Buffer.byteLength(tail) - 4;
  const body = fitBytes([clean(draft.summary), points.join("\n")].filter(Boolean).join("\n\n"), Math.max(200, room));
  const description = [body, tail].filter(Boolean).join("\n\n");

  const tags: string[] = [];
  let used = 0;
  for (const tag of draft.tags.map((item) => clean(item).replace(/[,"]/g, "")).filter(Boolean)) {
    // YouTube counts a tag with spaces as if it were quoted.
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + 1;
    if (used + cost > YOUTUBE_LIMITS.tagsChars || tags.includes(tag)) continue;
    tags.push(tag.slice(0, 100));
    used += cost;
  }
  return { title, description, tags, ...(facts.language ? { language: facts.language } : {}) };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

type RouteResult = { body: object; cookies?: string[]; status?: number };
type RouteContext<Body> = {
  req: Request;
  body: Body;
  config: YouTubeConfig;
  account: YouTubeAccount;
  /** The person signed in to the app. */
  user: SessionUser | null;
};

/**
 * A YouTube route: rate limited, same-site only, signed-in only, and only
 * for someone who has connected a channel. Errors become plain messages and
 * nothing about the request or the tokens is logged.
 */
export function youtubeRoute<Body>(
  route: string,
  options: { perMinute: number; read: (req: Request) => Promise<Body>; needsAccount?: boolean },
  run: (context: RouteContext<Body>) => Promise<RouteResult>,
) {
  return async function POST(req: Request): Promise<Response> {
    try {
      const limit = rateLimit(`youtube:${route}:${clientIp(req)}`, options.perMinute, 60_000);
      if (!limit.ok) throw new AppError("rate_limited", 429, { retryAfterSec: limit.retryAfterSec });
      assertSameOrigin(req);
      const user = await requireUser(req);
      const config = youtubeConfig();
      if (!config) throw new AppError("invalid_input", 404, { message: "YouTube uploads are not switched on for this app." });
      const account = await readAccount(req, config);
      if (options.needsAccount !== false && !account) throw new AppError("youtube_reconnect", 401);
      const body = await options.read(req);
      const result = await run({ req, body, config, account: account as YouTubeAccount, user });
      const headers = new Headers({ "Cache-Control": "no-store" });
      for (const cookie of result.cookies ?? []) headers.append("Set-Cookie", cookie);
      return Response.json(result.body, { status: result.status ?? 200, headers });
    } catch (err) {
      const appError = toAppError(err);
      console.error(`[${route}] ${appError.code} (${appError.status}) ${describeForLog(err)}`);
      const payload: ApiErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.retryAfterSec ? { retryAfterSec: appError.retryAfterSec } : {}),
        },
      };
      return Response.json(payload, { status: appError.status, headers: { "Cache-Control": "no-store" } });
    }
  };
}

/** Reads a small JSON body and checks it against a schema. */
export function readJson<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, maxChars = 4_000_000) {
  return async (req: Request): Promise<T> => {
    const text = await req.text();
    if (text.length > maxChars) throw new AppError("invalid_input", 413, { message: "That request is too large." });
    let json: unknown;
    try {
      json = JSON.parse(text || "{}");
    } catch {
      throw new AppError("invalid_input", 400, { message: "The request was not valid JSON." });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AppError("invalid_input", 400, { message: parsed.error.issues[0]?.message });
    return parsed.data;
  };
}
