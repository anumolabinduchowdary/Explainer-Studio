import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_DISCLAIMER, SOCIAL_HANDLE } from "@/lib/config";
import { finishGoogleSignIn, startGoogleSignIn } from "@/lib/server/auth/google";
import { SESSION_COOKIE, createSessionToken, readToken } from "@/lib/server/auth/session";
import { resetRateLimits } from "@/lib/server/rateLimit";
import {
  YOUTUBE_ATTEMPT_COOKIE,
  YOUTUBE_CALLBACK_PATH,
  YOUTUBE_COOKIE,
  YOUTUBE_SCOPE,
  accessToken,
  accountCookie,
  composeDetails,
  readAccount,
  seal,
  sendChunk,
  setThumbnail,
  startUpload,
  unseal,
  youtubeConfig,
  type YouTubeConfig,
} from "@/lib/server/youtube";
import { insightsConfig } from "@/lib/server/insights";
import {
  CHUNK_BYTES,
  DetailsRequestSchema,
  INSIGHTS_LIMITS,
  TrackRequestSchema,
  YOUTUBE_LIMITS,
  insightsScenes,
  sendVideo,
} from "@/lib/youtube";

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "https://studio.example.org";
const SESSION_URI = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc123";
const ENV = {
  AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  YOUTUBE_UPLOADS: "on",
};

function setEnv(values: Record<string, string>) {
  for (const name of ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_UPLOADS", "YOUTUBE_PRIVACY", "YOUTUBE_CATEGORY_ID", "ALLOWED_EMAILS", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "INSIGHTS_URL", "INSIGHTS_SECRET"]) {
    vi.stubEnv(name, values[name] ?? "");
  }
}
const config = (extra: Record<string, string> = {}): YouTubeConfig => {
  setEnv({ ...ENV, ...extra });
  const made = youtubeConfig();
  if (!made) throw new Error("expected YouTube uploads to be on");
  return made;
};

const request = (path: string, init: { body?: BodyInit | object; cookies?: Record<string, string>; headers?: Record<string, string>; method?: string } = {}) => {
  const raw = init.body instanceof Uint8Array || typeof init.body === "string" ? init.body : init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Request(`http://internal${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      host: "studio.example.org",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.9",
      ...(init.cookies ? { cookie: Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      ...init.headers,
    },
    body: raw as BodyInit | undefined,
  });
};

async function signedIn(extra: Record<string, string> = {}) {
  const made = config(extra);
  const session = await createSessionToken(made.auth, { email: "owner@example.org", method: "google" });
  const account = (await accountCookie(request("/"), made, { refreshToken: "refresh-SECRET", email: "channel@gmail.com" }))
    .split(";")[0]
    .split("=")[1];
  return { made, cookies: { [SESSION_COOKIE]: session, [YOUTUBE_COOKIE]: account } };
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; signal?: AbortSignal | null };
function fakeGoogle(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const call = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body, signal: init?.signal };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

beforeEach(() => {
  resetRateLimits();
  setEnv({});
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("switching YouTube uploads on", () => {
  it("is off unless asked for, and needs Google sign-in", () => {
    expect(youtubeConfig()).toBeNull();
    setEnv({ YOUTUBE_UPLOADS: "on" });
    expect(() => youtubeConfig()).toThrow(/AUTH_SECRET/);
    setEnv({ YOUTUBE_UPLOADS: "on", AUTH_SECRET: SECRET, SMTP_HOST: "h", SMTP_USER: "u@x.org", SMTP_PASSWORD: "p" });
    expect(() => youtubeConfig()).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("posts publicly in the Education category unless told otherwise", () => {
    expect(config()).toMatchObject({ privacy: "public", categoryId: "27" });
    expect(config({ YOUTUBE_PRIVACY: "Unlisted", YOUTUBE_CATEGORY_ID: "22" })).toMatchObject({ privacy: "unlisted", categoryId: "22" });
    expect(config({ YOUTUBE_PRIVACY: "everyone", YOUTUBE_CATEGORY_ID: "x" })).toMatchObject({ privacy: "public", categoryId: "27" });
  });
});

describe("keeping the channel's permission in the browser", () => {
  it("encrypts it, so it can be neither read nor changed without the server's secret", async () => {
    const made = config();
    const sealed = await seal(made, "youtube-account", { rt: "refresh-SECRET" }, 60);
    expect(sealed.split(".")).toHaveLength(5);
    expect(sealed).not.toContain("refresh");
    expect(Buffer.from(sealed.split(".")[3], "base64url").toString()).not.toContain("refresh-SECRET");
    expect((await unseal(made, "youtube-account", sealed))?.rt).toBe("refresh-SECRET");
    // Not usable for another purpose, after changes, or with another secret.
    expect(await unseal(made, "youtube-upload", sealed)).toBeNull();
    expect(await unseal(made, "youtube-account", `${sealed.slice(0, -4)}AAAA`)).toBeNull();
    expect(await unseal(config({ AUTH_SECRET: "another-secret-another-secret-another-secret" }), "youtube-account", sealed)).toBeNull();
  });

  it("stores it in an HttpOnly cookie that only the YouTube routes receive", async () => {
    const made = config();
    const line = await accountCookie(request("/"), made, { refreshToken: "r", email: "a@b.co" });
    expect(line).toMatch(/^es_youtube=[^;]+; Path=\/api\/youtube; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$/);
    const value = line.split(";")[0].split("=")[1];
    expect(await readAccount(request("/", { cookies: { [YOUTUBE_COOKIE]: value } }), made)).toEqual({ refreshToken: "r", email: "a@b.co" });
    expect(await readAccount(request("/"), made)).toBeNull();
  });
});

describe("talking to YouTube", () => {
  it("swaps the lasting permission for a short-lived access token", async () => {
    const made = config();
    const calls = fakeGoogle(() => Response.json({ access_token: "ya29.token", expires_in: 3599 }));
    expect(await accessToken(made, { refreshToken: "refresh-SECRET", email: "x" })).toBe("ya29.token");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(calls[0].body as URLSearchParams)).toEqual({
      client_id: ENV.GOOGLE_CLIENT_ID,
      client_secret: ENV.GOOGLE_CLIENT_SECRET,
      refresh_token: "refresh-SECRET",
      grant_type: "refresh_token",
    });
    fakeGoogle(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(accessToken(made, { refreshToken: "old", email: "x" })).rejects.toMatchObject({ code: "youtube_reconnect" });
    fakeGoogle(() => Response.json({ error: "server_error" }, { status: 500 }));
    await expect(accessToken(made, { refreshToken: "r", email: "x" })).rejects.toMatchObject({ code: "youtube_failed" });
  });

  it("opens an upload with the title, description and tags, public, and no audience mark", async () => {
    const made = config();
    const calls = fakeGoogle(() => new Response(null, { status: 200, headers: { Location: SESSION_URI } }));
    const details = { title: "Playtime at Physio", description: "Fun exercises.", tags: ["physiotherapy"], language: "hi" };
    expect(await startUpload(made, "ya29.token", details, 12_345, "video/mp4")).toBe(SESSION_URI);
    const [call] = calls;
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/upload/youtube/v3/videos");
    expect(Object.fromEntries(url.searchParams)).toEqual({ uploadType: "resumable", part: "snippet,status" });
    expect(call.headers).toMatchObject({
      authorization: "Bearer ya29.token",
      "x-upload-content-length": "12345",
      "x-upload-content-type": "video/mp4",
    });
    const video = JSON.parse(String(call.body));
    expect(video).toEqual({
      snippet: { title: details.title, description: details.description, tags: details.tags, categoryId: "27", defaultLanguage: "hi" },
      status: { privacyStatus: "public", embeddable: true },
    });
    expect(String(call.body)).not.toMatch(/MadeForKids|SyntheticMedia/);
  });

  it("explains YouTube's refusals in plain words", async () => {
    const made = config();
    const fail = (status: number, reason: string) =>
      fakeGoogle(() => Response.json({ error: { errors: [{ reason }] } }, { status }));
    const start = () => startUpload(made, "t", { title: "a", description: "", tags: [] }, 1, "video/mp4");
    fail(403, "quotaExceeded");
    await expect(start()).rejects.toMatchObject({ code: "youtube_quota" });
    fail(400, "uploadLimitExceeded");
    await expect(start()).rejects.toMatchObject({ code: "youtube_quota" });
    fail(401, "authError");
    await expect(start()).rejects.toMatchObject({ code: "youtube_reconnect" });
    fail(403, "youtubeSignupRequired");
    await expect(start()).rejects.toMatchObject({ code: "youtube_failed", message: expect.stringContaining("no YouTube channel") });
    fail(500, "backendError");
    await expect(start()).rejects.toMatchObject({ code: "youtube_failed" });
    // An upload address that is not YouTube's is never used.
    fakeGoogle(() => new Response(null, { status: 200, headers: { Location: "https://evil.example/upload" } }));
    await expect(start()).rejects.toMatchObject({ code: "youtube_failed" });
  });

  it("sends a piece, and reads how much YouTube has", async () => {
    const piece = new Uint8Array(CHUNK_BYTES);
    let calls = fakeGoogle(() => new Response(null, { status: 308, headers: { Range: `bytes=0-${CHUNK_BYTES - 1}` } }));
    expect(await sendChunk(SESSION_URI, "t", piece, 0, CHUNK_BYTES * 2 + 10)).toEqual({ done: false, received: CHUNK_BYTES });
    expect(calls[0]).toMatchObject({ method: "PUT", url: SESSION_URI });
    expect(calls[0].headers).toMatchObject({
      authorization: "Bearer t",
      "content-range": `bytes 0-${CHUNK_BYTES - 1}/${CHUNK_BYTES * 2 + 10}`,
    });
    calls = fakeGoogle(() => new Response(null, { status: 308 }));
    expect(await sendChunk(SESSION_URI, "t", piece, 0, CHUNK_BYTES * 3)).toEqual({ done: false, received: 0 });
    fakeGoogle(() => Response.json({ id: "dQw4w9WgXcQ", kind: "youtube#video" }, { status: 201 }));
    expect(await sendChunk(SESSION_URI, "t", new Uint8Array(10), CHUNK_BYTES * 2, CHUNK_BYTES * 2 + 10)).toEqual({ done: true, videoId: "dQw4w9WgXcQ" });
    fakeGoogle(() => new Response(null, { status: 404 }));
    await expect(sendChunk(SESSION_URI, "t", piece, 0, CHUNK_BYTES)).rejects.toMatchObject({ code: "youtube_failed", status: 410 });
    calls = fakeGoogle(() => new Response(null, { status: 200 }));
    await expect(sendChunk("https://evil.example/upload", "t", piece, 0, CHUNK_BYTES)).rejects.toMatchObject({ code: "youtube_failed" });
    expect(calls).toHaveLength(0);
  });

  it("sets the thumbnail, and explains when YouTube will not allow one", async () => {
    const calls = fakeGoogle(() => Response.json({ items: [] }));
    expect(await setThumbnail("t", "dQw4w9WgXcQ", new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({ ok: true });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
    expect(url.searchParams.get("videoId")).toBe("dQw4w9WgXcQ");
    expect(calls[0].headers["content-type"]).toBe("image/jpeg");
    fakeGoogle(() => Response.json({ error: { errors: [{ reason: "forbidden" }] } }, { status: 403 }));
    expect(await setThumbnail("t", "dQw4w9WgXcQ", new Uint8Array([1]))).toMatchObject({ ok: false, reason: expect.stringContaining("verified by phone") });
  });
});

describe("the title, description and tags", () => {
  const draft = {
    title: "Fun at <Physiotherapy>",
    summary: "Four friends and their physiotherapist show that exercise can be play.",
    points: ["Stretching helps balance", "Practise a little every day"],
    hashtags: ["#Physiotherapy", "Cerebral Palsy", "Inclusion!", "a", "b", "c"],
    tags: ["physiotherapy", "children's exercises", "cerebral palsy", "physiotherapy"],
  };

  it("always carries the disclaimer, the AI-voice line and the channel to follow", () => {
    const details = composeDetails(draft, { fallbackTitle: "x", health: true, aiVoices: true, language: "en" });
    expect(details.title).toBe("Fun at Physiotherapy");
    const lines = details.description.split("\n");
    expect(lines).toContain(HEALTH_DISCLAIMER);
    expect(lines).toContain("The voices in this video are AI-generated.");
    expect(lines).toContain(`Follow ${SOCIAL_HANDLE} for more.`);
    expect(details.description).toContain("• Stretching helps balance");
    expect(details.description.split("\n").at(-1)).toBe("#Physiotherapy #CerebralPalsy #Inclusion #a #b");
    expect(details.description).not.toMatch(/[<>]/);
    expect(details.tags).toEqual(["physiotherapy", "children's exercises", "cerebral palsy"]);
    expect(details.language).toBe("en");

    const plain = composeDetails(draft, { fallbackTitle: "x", health: false, aiVoices: false });
    expect(plain.description).not.toContain(HEALTH_DISCLAIMER);
    expect(plain.description).not.toContain("AI-generated");
    expect(plain).not.toHaveProperty("language");
  });

  it("asks viewers to follow the account only for videos that end with its QR card", () => {
    const other = composeDetails(draft, { fallbackTitle: "x", health: false, aiVoices: true, follow: false });
    expect(other.description).not.toContain(SOCIAL_HANDLE);
    expect(other.description).toContain("The voices in this video are AI-generated.");
    expect(composeDetails(draft, { fallbackTitle: "x", health: false, aiVoices: false, follow: true }).description).toContain(
      `Follow ${SOCIAL_HANDLE} for more.`,
    );
    expect(DetailsRequestSchema.parse({ kind: "story", title: "t", script: "s", language: "", health: false, aiVoices: false }).follow).toBe(true);
  });

  it("writes the disclaimer in the video's language too", () => {
    const hindi = composeDetails(draft, { fallbackTitle: "x", health: true, aiVoices: false, language: "hi", languageName: "Hindi" });
    const lines = hindi.description.split("\n");
    const at = lines.indexOf(HEALTH_DISCLAIMER);
    expect(lines[at - 1]).toBe("जागरूकता के लिए, चिकित्सीय सलाह नहीं।");
  });

  it("stays within YouTube's limits, even in scripts that take more bytes", () => {
    const long = composeDetails(
      {
        ...draft,
        title: "చాలా పొడవైన శీర్షిక ".repeat(20),
        summary: "తెలుగు వాక్యం ".repeat(900),
        tags: Array.from({ length: 80 }, (_, i) => `tag number ${i}`),
      },
      { fallbackTitle: "x", health: true, aiVoices: true },
    );
    expect(long.title.length).toBeLessThanOrEqual(YOUTUBE_LIMITS.title);
    expect(Buffer.byteLength(long.description)).toBeLessThanOrEqual(YOUTUBE_LIMITS.descriptionBytes);
    expect(long.description).toContain(HEALTH_DISCLAIMER);
    const cost = long.tags.reduce((sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0) + 1, 0);
    expect(cost).toBeLessThanOrEqual(YOUTUBE_LIMITS.tagsChars);
    expect(composeDetails({ ...draft, title: "  " }, { fallbackTitle: "My video", health: false, aiVoices: false }).title).toBe("My video");
  });
});

/* ------------------------------------------------------------------ */

describe("connecting a channel", () => {
  it("asks Google for lasting permission to upload, and comes back to the YouTube address", async () => {
    const { cookies } = await signedIn();
    const { GET } = await import("@/app/api/youtube/connect/route");
    const res = await GET(request("/api/youtube/connect", { cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE] } }));
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: `openid email ${YOUTUBE_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      redirect_uri: `${ORIGIN}${YOUTUBE_CALLBACK_PATH}`,
      code_challenge_method: "S256",
    });
    expect(res.headers.getSetCookie()[0]).toMatch(/^es_youtube_try=[^;]+; Path=\/api\/youtube; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);
  });

  it("needs the visitor to be signed in to the app", async () => {
    config();
    const { GET } = await import("@/app/api/youtube/connect/route");
    const res = await GET(request("/api/youtube/connect"));
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("Please sign in to the app first.");
  });

  it("refuses a sign-in attempt being reused to connect YouTube, and the other way round", async () => {
    const made = config();
    const signIn = await startGoogleSignIn(made.auth, ORIGIN);
    const state = new URL(signIn.url).searchParams.get("state");
    const crossed = await finishGoogleSignIn(made.auth, { code: "c", state, token: signIn.token, origin: ORIGIN, callbackPath: YOUTUBE_CALLBACK_PATH });
    expect(crossed).toBeNull();
    expect((await readToken(made.auth, "google", signIn.token))?.back).toBe("/api/auth/google/callback");
  });

  it("keeps the permission and the account it belongs to", async () => {
    const made = config();
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" }] });
    const begun = await startGoogleSignIn(made.auth, ORIGIN, { scope: `openid email ${YOUTUBE_SCOPE}`, callbackPath: YOUTUBE_CALLBACK_PATH, offline: true });
    const params = new URL(begun.url).searchParams;
    const idToken = await new SignJWT({ email: "Channel@Gmail.com", email_verified: true, nonce: params.get("nonce") })
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .setIssuer("https://accounts.google.com")
      .setAudience(ENV.GOOGLE_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    fakeGoogle(() => Response.json({ id_token: idToken, refresh_token: "1//refresh", scope: `openid ${YOUTUBE_SCOPE} https://www.googleapis.com/auth/userinfo.email` }));
    const result = await finishGoogleSignIn(
      made.auth,
      { code: "c", state: params.get("state"), token: begun.token, origin: ORIGIN, callbackPath: YOUTUBE_CALLBACK_PATH },
      { keys },
    );
    expect(result).toMatchObject({ email: "channel@gmail.com", refreshToken: "1//refresh" });
    expect(result?.scopes).toContain(YOUTUBE_SCOPE);
  });

  it("reports a refusal on Google's screen without repeating anything from the address", async () => {
    const { cookies } = await signedIn();
    const { GET } = await import("@/app/api/youtube/callback/route");
    const res = await GET(
      request("/api/youtube/callback?error=access_denied&state=%3Cscript%3Ealert(1)%3C%2Fscript%3E", {
        cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE], [YOUTUBE_ATTEMPT_COOKIE]: "x" },
      }),
    );
    const html = await res.text();
    expect(html).toContain("YouTube was not connected.");
    expect(html).toContain("press Allow");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain('"youtube":"failed"');
    expect(res.headers.getSetCookie().join()).toContain("es_youtube_try=; Path=/api/youtube; Max-Age=0");
    expect(res.headers.getSetCookie().join()).not.toMatch(/es_youtube=[^;]/);

    const mismatch = await GET(request("/api/youtube/callback?code=x&state=y", { cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE] } }));
    expect(await mismatch.text()).toContain("could not be checked");
  });
});

describe("the upload routes", () => {
  const post = async (path: string, init: Parameters<typeof request>[1]) => {
    const route = await import(`@/app/api/youtube/${path}/route`);
    return (route.POST as (req: Request) => Promise<Response>)(request(`/api/youtube/${path}`, { method: "POST", ...init }));
  };

  it("say whether a channel is connected, and only to someone signed in", async () => {
    const { cookies } = await signedIn();
    expect(await (await post("status", { body: {}, cookies })).json()).toEqual({ connected: true, email: "channel@gmail.com", privacy: "public", insights: false });
    expect(await (await post("status", { body: {}, cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE] } })).json()).toEqual({ connected: false, privacy: "public", insights: false });
    const anonymous = await post("status", { body: {} });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("signed_out");
    const foreign = await post("status", { body: {}, cookies, headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    setEnv({ ...ENV, YOUTUBE_UPLOADS: "" });
    expect((await post("status", { body: {}, cookies })).status).toBe(404);
  });

  it("upload a video in pieces and set its thumbnail, never handing a token to the browser", async () => {
    const { cookies } = await signedIn();
    const total = CHUNK_BYTES + 1000;
    const received: number[] = [];
    const calls = fakeGoogle((call) => {
      if (call.url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.token" });
      if (call.method === "POST" && call.url.includes("/upload/youtube/v3/videos")) {
        return new Response(null, { status: 200, headers: { Location: SESSION_URI } });
      }
      if (call.method === "PUT") {
        received.push((call.body as Uint8Array).length);
        const sum = received.reduce((a, b) => a + b, 0);
        return sum < total
          ? new Response(null, { status: 308, headers: { Range: `bytes=0-${sum - 1}` } })
          : Response.json({ id: "abcDEF12345" }, { status: 200 });
      }
      if (call.url.includes("/thumbnails/set")) return Response.json({});
      return new Response(null, { status: 500 });
    });

    const started = await post("start", {
      body: { details: { title: "Hello", description: "World", tags: ["a"] }, size: total, mimeType: "video/mp4" },
      cookies,
    });
    expect(started.status).toBe(200);
    const { upload } = await started.json();
    expect(upload).not.toContain("ya29");
    expect(upload).not.toContain("googleapis");

    const piece = (start: number, length: number) =>
      post("chunk", {
        body: new Uint8Array(length),
        cookies,
        headers: { "x-upload": upload, "x-upload-start": String(start), "x-upload-total": String(total), "content-type": "application/octet-stream" },
      });
    expect(await (await piece(0, CHUNK_BYTES)).json()).toEqual({ done: false, received: CHUNK_BYTES });
    expect(await (await piece(CHUNK_BYTES, 1000)).json()).toEqual({ done: true, videoId: "abcDEF12345" });
    expect(received).toEqual([CHUNK_BYTES, 1000]);

    const thumbnail = await post("thumbnail", {
      body: { upload, videoId: "abcDEF12345", image: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}` },
      cookies,
    });
    expect(await thumbnail.json()).toEqual({ ok: true });
    // Every YouTube call carried the token; none of them came from the browser.
    expect(calls.filter((call) => call.url.includes("googleapis.com/upload")).every((call) => call.headers.authorization === "Bearer ya29.token")).toBe(true);
  });

  it("refuse pieces that do not fit, and notes from another upload", async () => {
    const { cookies, made } = await signedIn();
    const upload = await seal(made, "youtube-upload", { s: SESSION_URI, at: "t", n: 10_000_000 }, 600);
    const calls = fakeGoogle(() => new Response(null, { status: 308 }));
    const piece = (start: number, length: number, total = 10_000_000, note = upload) =>
      post("chunk", { body: new Uint8Array(length), cookies, headers: { "x-upload": note, "x-upload-start": String(start), "x-upload-total": String(total) } });
    expect((await piece(0, 1000)).status).toBe(400); // not a multiple of 256 KB and not the last piece
    expect((await piece(0, CHUNK_BYTES + 256 * 1024)).status).toBe(413);
    expect((await piece(-1, 256 * 1024)).status).toBe(400);
    expect((await piece(0, 256 * 1024, 20_000_000)).status).toBe(410); // the note was for another file size
    expect((await piece(0, 256 * 1024, 10_000_000, "made-up")).status).toBe(410);
    expect(calls).toHaveLength(0);
    expect((await piece(0, 256 * 1024)).status).toBe(200);
  });

  it("ask to reconnect when no channel is connected", async () => {
    const { cookies } = await signedIn();
    const res = await post("start", {
      body: { details: { title: "Hello", description: "", tags: [] }, size: 10, mimeType: "video/mp4" },
      cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE] },
    });
    expect((await res.json()).error.code).toBe("youtube_reconnect");
  });

  it("disconnect by withdrawing the permission at Google and forgetting it", async () => {
    const { cookies } = await signedIn();
    const calls = fakeGoogle(() => new Response(null, { status: 200 }));
    const res = await post("disconnect", { body: {}, cookies });
    expect(await res.json()).toEqual({ connected: false });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(Object.fromEntries(calls[0].body as URLSearchParams)).toEqual({ token: "refresh-SECRET" });
    expect(res.headers.getSetCookie()[0]).toContain("es_youtube=; Path=/api/youtube; Max-Age=0");
  });
});

describe("sending a video from the browser", () => {
  it("sends it in 4 MB pieces, resends what YouTube missed, and waits out busy moments", async () => {
    const video = new Blob([new Uint8Array(CHUNK_BYTES * 2 + 5000)], { type: "video/mp4" });
    const sent: Array<{ start: string; size: number }> = [];
    let busyOnce = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        const size = (init.body as Blob).size;
        const start = Number(headers.get("x-upload-start"));
        if (busyOnce && start === CHUNK_BYTES) {
          busyOnce = false;
          return Response.json({ error: { code: "youtube_failed", message: "busy" } }, { status: 503 });
        }
        sent.push({ start: String(start), size });
        // YouTube took all of the first piece but only half of the second.
        if (start === 0) return Response.json({ done: false, received: CHUNK_BYTES });
        if (start === CHUNK_BYTES) return Response.json({ done: false, received: CHUNK_BYTES + CHUNK_BYTES / 2 });
        if (start + size === video.size) return Response.json({ done: true, videoId: "abcDEF12345" });
        return Response.json({ done: false, received: start + size });
      }),
    );
    vi.useFakeTimers();
    const progress: number[] = [];
    const done = sendVideo("note", video, { onProgress: (s) => progress.push(s) });
    await vi.runAllTimersAsync();
    expect(await done).toEqual({ videoId: "abcDEF12345" });
    // The second piece was tried again after a busy answer, and the third starts where YouTube stopped.
    expect(sent.map((item) => [Number(item.start), item.size])).toEqual([
      [0, CHUNK_BYTES],
      [CHUNK_BYTES, CHUNK_BYTES],
      [CHUNK_BYTES * 1.5, CHUNK_BYTES / 2 + 5000],
    ]);
    expect(progress.at(-1)).toBe(video.size);
  });

  it("stops with YouTube's reason when the daily limit is reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "youtube_quota", message: "limit" } }, { status: 429 })));
    vi.useFakeTimers();
    const attempt = sendVideo("note", new Blob([new Uint8Array(10)])).catch((err) => err);
    await vi.runAllTimersAsync();
    expect((await attempt).info.code).toBe("youtube_quota");
  });
});

/* ------------------------------------------------------------------ */

describe("telling Video Insights about an upload", () => {
  const INSIGHTS = { INSIGHTS_URL: "https://insights.example.org/", INSIGHTS_SECRET: "insights-SECRET-0123456789" };
  const studio = {
    kind: "story",
    title: "Playtime at Physio",
    language: "Hindi",
    health: true,
    aiVoices: true,
    durationSec: 42.5,
    shape: "9:16",
    scenes: [
      { startSec: 0, text: "Meet Riya." },
      { startSec: 12.3, text: "At the park" },
    ],
  };
  const post = async (path: string, init: Parameters<typeof request>[1]) => {
    const route = await import(`@/app/api/youtube/${path}/route`);
    return (route.POST as (req: Request) => Promise<Response>)(request(`/api/youtube/${path}`, { method: "POST", ...init }));
  };

  it("gives the browser a receipt for the finished upload, without the channel's id", async () => {
    const { cookies, made } = await signedIn();
    const upload = await seal(made, "youtube-upload", { s: SESSION_URI, at: "t", n: 1000 }, 600);
    fakeGoogle(() => Response.json({ id: "abcDEF12345", snippet: { channelId: "UCchannel-0123" } }, { status: 200 }));
    expect(await sendChunk(SESSION_URI, "t", new Uint8Array(1000), 0, 1000)).toEqual({ done: true, videoId: "abcDEF12345", channelId: "UCchannel-0123" });

    const res = await post("chunk", { body: new Uint8Array(1000), cookies, headers: { "x-upload": upload, "x-upload-start": "0", "x-upload-total": "1000" } });
    const body = await res.json();
    expect(body).toMatchObject({ done: true, videoId: "abcDEF12345", receipt: expect.any(String) });
    expect(Object.keys(body).sort()).toEqual(["done", "receipt", "videoId"]);
    expect(JSON.stringify(body)).not.toContain("UCchannel");
    expect(await unseal(made, "youtube-receipt", body.receipt)).toMatchObject({ v: "abcDEF12345", c: "UCchannel-0123", aud: "youtube-receipt" });
  });

  it("only accepts a receipt made for that purpose, unchanged and in time", async () => {
    const made = config();
    const receipt = await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UCchannel-0123" }, 86_400);
    expect(await unseal(made, "youtube-receipt", receipt)).toMatchObject({ v: "abcDEF12345", c: "UCchannel-0123" });
    expect(await unseal(made, "youtube-upload", receipt)).toBeNull();
    expect(await unseal(made, "youtube-account", receipt)).toBeNull();
    const upload = await seal(made, "youtube-upload", { v: "abcDEF12345", c: "UCchannel-0123" }, 600);
    expect(await unseal(made, "youtube-receipt", upload)).toBeNull();
    expect(await unseal(made, "youtube-receipt", `${receipt.slice(0, -4)}AAAA`)).toBeNull();
    expect(await unseal(made, "youtube-receipt", await seal(made, "youtube-receipt", { v: "a", c: "b" }, -10))).toBeNull();
  });

  it("refuses a missing, made-up, expired or borrowed receipt, before calling Insights", async () => {
    const foreign = await seal(config({ ...INSIGHTS, AUTH_SECRET: "another-secret-another-secret-another-secret" }), "youtube-receipt", { v: "x", c: "y" }, 600);
    const { cookies, made } = await signedIn(INSIGHTS);
    const calls = fakeGoogle(() => Response.json({ reportUrl: "https://insights.example.org/r/1", tracking: true }));
    const track = (receipt: unknown) => post("track", { body: { receipt, studio }, cookies });
    expect((await track(undefined)).status).toBe(400);
    expect((await track("made-up-receipt-made-up-receipt")).status).toBe(403);
    expect((await track(await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UC1" }, -10))).status).toBe(403);
    expect((await track(await seal(made, "youtube-upload", { v: "abcDEF12345", c: "UC1" }, 600))).status).toBe(403);
    expect((await track(foreign)).status).toBe(403);
    expect(calls).toHaveLength(0);
    // And, like the other YouTube routes, only for someone signed in with a channel connected.
    const receipt = await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UC1" }, 600);
    expect((await post("track", { body: { receipt, studio } })).status).toBe(401);
    expect((await post("track", { body: { receipt, studio }, cookies: { [SESSION_COOKIE]: cookies[SESSION_COOKIE] } })).status).toBe(401);
  });

  it("does nothing when Insights is not set up", async () => {
    const { cookies, made } = await signedIn();
    const calls = fakeGoogle(() => Response.json({ reportUrl: "https://insights.example.org/r/1", tracking: true }));
    const receipt = await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UC1" }, 600);
    const res = await post("track", { body: { receipt, studio }, cookies });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reportUrl: null, tracking: false });
    expect(calls).toHaveLength(0);
    expect(insightsConfig()).toBeNull();
    setEnv({ ...ENV, INSIGHTS_URL: INSIGHTS.INSIGHTS_URL });
    expect(insightsConfig()).toBeNull();
  });

  it("posts the agreed details with the shared secret, and passes back the report's address", async () => {
    const { cookies, made } = await signedIn(INSIGHTS);
    const calls = fakeGoogle(() => Response.json({ reportUrl: "https://insights.example.org/videos/abcDEF12345", tracking: true }));
    const receipt = await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UCchannel-0123" }, 600);
    const res = await post("track", { body: { receipt, studio }, cookies });
    expect(await res.json()).toEqual({ reportUrl: "https://insights.example.org/videos/abcDEF12345", tracking: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://insights.example.org/api/track", method: "POST" });
    expect(calls[0].headers).toMatchObject({ authorization: "Bearer insights-SECRET-0123456789", "content-type": "application/json" });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0].body))).toEqual({
      videoId: "abcDEF12345",
      channelId: "UCchannel-0123",
      uploadedBy: "owner@example.org",
      studio,
    });
    // The status says so, so the panel knows to ask.
    expect((await (await post("status", { body: {}, cookies })).json()).insights).toBe(true);
  });

  it("passes on only a report on Insights' own site, and never logs the secret or the answer", async () => {
    const { cookies, made } = await signedIn(INSIGHTS);
    const receipt = await seal(made, "youtube-receipt", { v: "abcDEF12345", c: "UC1" }, 600);
    const track = async () => (await post("track", { body: { receipt, studio }, cookies })).json();
    for (const elsewhere of ["https://insights.example.org.evil.example/r/1", "https://evil.example/https://insights.example.org/r", "javascript:alert(1)"]) {
      fakeGoogle(() => Response.json({ reportUrl: elsewhere, tracking: true }));
      expect(await track()).toEqual({ reportUrl: null, tracking: true });
    }
    fakeGoogle(() => Response.json({ error: "private details from Insights" }, { status: 500 }));
    const failed = await post("track", { body: { receipt, studio }, cookies });
    expect(failed.status).toBe(502);
    fakeGoogle(() => new Response("not json"));
    expect((await post("track", { body: { receipt, studio }, cookies })).status).toBe(502);
    fakeGoogle(() => {
      throw new TypeError("fetch failed");
    });
    expect((await post("track", { body: { receipt, studio }, cookies })).status).toBe(502);
    const logged = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(logged).toContain("api/youtube/track");
    expect(logged).not.toMatch(/insights-SECRET|private details|UC1/);
  });

  it("only sends the secret over HTTPS, except to this computer", () => {
    const check = (url: string) => {
      setEnv({ INSIGHTS_URL: url, INSIGHTS_SECRET: "s" });
      return insightsConfig()?.url ?? null;
    };
    expect(check("https://insights.example.org/")).toBe("https://insights.example.org");
    expect(check("https://example.org/insights//")).toBe("https://example.org/insights");
    expect(check("http://localhost:3001")).toBe("http://localhost:3001");
    expect(check("http://insights.example.org")).toBeNull();
    expect(check("https://user:pass@insights.example.org")).toBeNull();
    expect(check("not a url")).toBeNull();
  });

  it("describes up to 40 scenes, each in a few words", () => {
    const scenes = insightsScenes(
      Array.from({ length: 45 }, (_, i) => ({ startSec: i * 3.14159, text: `  Scene ${i}\n${"word ".repeat(40)}` })),
    );
    expect(scenes).toHaveLength(INSIGHTS_LIMITS.scenes);
    expect(scenes[1]).toMatchObject({ startSec: 3.1 });
    expect(scenes.every((scene) => scene.text.length <= INSIGHTS_LIMITS.sceneText && !scene.text.includes("\n"))).toBe(true);
    expect(scenes[0].text.startsWith("Scene 0 word")).toBe(true);
    expect(insightsScenes([{ startSec: -1, text: "Short" }])).toEqual([{ startSec: 0, text: "Short" }]);
    const parsed = TrackRequestSchema.safeParse({ receipt: "x".repeat(40), studio: { ...studio, scenes: Array(41).fill({ startSec: 0, text: "a" }) } });
    expect(parsed.success).toBe(false);
  });
});
