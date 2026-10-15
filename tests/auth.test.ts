import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EmailStartRequestSchema, EmailVerifyRequestSchema, OTP_LENGTH, SIGN_IN_ERRORS } from "@/lib/auth";
import { authConfig, isAllowed, parseAllowlist, type AuthConfig } from "@/lib/server/auth/config";
import { checkEmailCode, pendingEmail, startEmailCode } from "@/lib/server/auth/emailCode";
import { GOOGLE_CALLBACK_PATH, finishGoogleSignIn, startGoogleSignIn } from "@/lib/server/auth/google";
import {
  OAUTH_COOKIE,
  OTP_COOKIE,
  SESSION_COOKIE,
  cookieHeader,
  createSessionToken,
  readCookie,
  readSession,
  readToken,
  requestOrigin,
  signToken,
} from "@/lib/server/auth/session";
import { createKeylessPostHandler } from "@/lib/server/handler";
import { resetRateLimits } from "@/lib/server/rateLimit";

// The mail library is replaced by a recorder: no email is ever sent from tests.
const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, string>>, transports: [] as unknown[], fail: false }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: unknown) => {
      mail.transports.push(options);
      return {
        sendMail: async (message: Record<string, string>) => {
          if (mail.fail) throw new Error("535 Authentication failed for app-password-SECRET");
          mail.sent.push(message);
        },
        close: () => undefined,
      };
    },
  },
}));

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "https://studio.example.org";

function setEnv(values: Record<string, string>) {
  for (const name of ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "AUTH_EMAIL_FROM", "ALLOWED_EMAILS"]) {
    vi.stubEnv(name, values[name] ?? "");
  }
}
const FULL = {
  AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "owner@gmail.com",
  SMTP_PASSWORD: "app-password-SECRET",
};
const config = (extra: Record<string, string> = {}): AuthConfig => {
  setEnv({ ...FULL, ...extra });
  const made = authConfig();
  if (!made) throw new Error("expected sign-in to be on");
  return made;
};

const request = (path: string, init: { body?: unknown; cookies?: Record<string, string>; origin?: string; ip?: string } = {}) =>
  new Request(`http://internal${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      host: "studio.example.org",
      "x-forwarded-proto": "https",
      "x-forwarded-for": init.ip ?? "203.0.113.7",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.origin ? { origin: init.origin } : {}),
      ...(init.cookies
        ? { cookie: Object.entries(init.cookies).map(([name, value]) => `${name}=${value}`).join("; ") }
        : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** name -> value for every cookie a response sets, plus the full Set-Cookie lines. */
function cookiesSet(response: Response) {
  const lines = response.headers.getSetCookie();
  const values = Object.fromEntries(lines.map((line) => line.split(";")[0].split("=") as [string, string]));
  return { lines, values };
}

beforeEach(() => {
  resetRateLimits();
  mail.sent.length = 0;
  mail.transports.length = 0;
  mail.fail = false;
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

describe("sign-in settings", () => {
  it("leaves the app open when nothing is set, as it was before sign-in existed", () => {
    expect(authConfig()).toBeNull();
  });

  it("switches on with a secret and reads the ways of signing in", () => {
    const made = config({ ALLOWED_EMAILS: "Ana@Example.org, @school.edu" });
    expect(made.google).toEqual({ clientId: FULL.GOOGLE_CLIENT_ID, clientSecret: FULL.GOOGLE_CLIENT_SECRET });
    // The sender defaults to the mailbox that sends, and the port to the encrypted one.
    expect(made.email).toMatchObject({ host: "smtp.gmail.com", port: 465, from: "owner@gmail.com" });
    expect(isAllowed(made.allow, "ana@example.org")).toBe(true);
    expect(isAllowed(made.allow, "TEACHER@School.edu")).toBe(true);
    expect(isAllowed(made.allow, "stranger@example.org")).toBe(false);
    expect(isAllowed(made.allow, "x@notschool.edu")).toBe(false);
  });

  it("lets anyone in only when no list is given", () => {
    expect(parseAllowlist("").anyone).toBe(true);
    expect(parseAllowlist(" , ;").anyone).toBe(true);
    expect(isAllowed(parseAllowlist(""), "anyone@example.org")).toBe(true);
    expect(parseAllowlist("a@b.co").anyone).toBe(false);
  });

  it("stays closed and names the missing setting when the setup is half done", () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }, /AUTH_SECRET/],
      [{ ALLOWED_EMAILS: "a@b.co" }, /AUTH_SECRET/],
      [{ AUTH_SECRET: "short" }, /too short/],
      [{ AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: "id" }, /GOOGLE_CLIENT_SECRET/],
      [{ AUTH_SECRET: SECRET, GOOGLE_CLIENT_SECRET: "s" }, /GOOGLE_CLIENT_ID/],
      [{ AUTH_SECRET: SECRET, SMTP_HOST: "smtp.x.org" }, /SMTP_USER/],
      [{ AUTH_SECRET: SECRET, SMTP_HOST: "smtp.x.org", SMTP_USER: "resend" }, /SMTP_PASSWORD/],
      [{ AUTH_SECRET: SECRET, SMTP_HOST: "smtp.x.org", SMTP_USER: "resend", SMTP_PASSWORD: "p" }, /AUTH_EMAIL_FROM/],
    ];
    for (const [env, message] of cases) {
      setEnv(env);
      expect(() => authConfig()).toThrow(message);
    }
    // No setting's value is ever repeated in the message.
    setEnv({ AUTH_SECRET: SECRET, SMTP_HOST: "smtp.x.org", SMTP_USER: "u", SMTP_PASSWORD: "hunter2-SECRET" });
    expect(() => authConfig()).not.toThrow(/hunter2/);
  });

  it("is switched on, with no way in, when only the secret is set", () => {
    setEnv({ AUTH_SECRET: SECRET });
    expect(authConfig()).toMatchObject({ google: null, email: null });
  });
});

describe("sessions", () => {
  it("remembers who signed in, and nothing else", async () => {
    const made = config();
    const token = await createSessionToken(made, { email: "ana@example.org", name: "Ana", method: "google" });
    expect(await readSession(made, token)).toEqual({ email: "ana@example.org", name: "Ana", method: "google" });
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(["aud", "exp", "iat", "method", "name", "sub"]);
  });

  it("rejects a changed, foreign, expired or missing token", async () => {
    const made = config();
    const token = await createSessionToken(made, { email: "ana@example.org", method: "email" });
    const [head, body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: "admin@example.org" })).toString("base64url");
    expect(await readSession(made, `${head}.${forged}.${signature}`)).toBeNull();
    expect(await readSession(made, `${head}.${body}.`)).toBeNull();
    expect(await readSession(made, undefined)).toBeNull();
    expect(await readSession(made, "not-a-token")).toBeNull();
    // An unsigned token ("alg: none") is never accepted.
    const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    expect(await readSession(made, `${none}.${body}.`)).toBeNull();

    const other = config({ AUTH_SECRET: "another-secret-another-secret-another-secret" });
    expect(await readSession(other, token)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await readSession(made, token)).toBeNull();
  });

  it("signs someone out as soon as they are taken off the approved list", async () => {
    const open = config({ ALLOWED_EMAILS: "ana@example.org, ben@example.org" });
    const token = await createSessionToken(open, { email: "ben@example.org", method: "email" });
    expect(await readSession(open, token)).not.toBeNull();
    expect(await readSession(config({ ALLOWED_EMAILS: "ana@example.org" }), token)).toBeNull();
  });

  it("never lets one kind of token stand in for another", async () => {
    const made = config();
    const code = await startEmailCode(made, "ana@example.org");
    expect(await readSession(made, code.token)).toBeNull();
    const fake = await signToken(made, "email-code", { sub: "ana@example.org", method: "email" }, 600);
    expect(await readSession(made, fake)).toBeNull();
    expect(await readToken(made, "google", await createSessionToken(made, { email: "a@b.co", method: "email" }))).toBeNull();
  });

  it("writes cookies that scripts cannot read and that are only sent over HTTPS", () => {
    const secure = cookieHeader(request("/"), SESSION_COOKIE, "abc", { maxAgeSec: 60 });
    expect(secure).toBe("es_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure");
    const local = cookieHeader(new Request("http://localhost:3000/"), SESSION_COOKIE, "abc", { maxAgeSec: 60 });
    expect(local).not.toContain("Secure");
    expect(readCookie(request("/", { cookies: { a: "1", es_session: "x.y.z" } }), SESSION_COOKIE)).toBe("x.y.z");
    expect(readCookie(request("/"), SESSION_COOKIE)).toBeUndefined();
    expect(requestOrigin(request("/"))).toBe(ORIGIN);
  });
});

describe("email codes", () => {
  it("accepts the right code and only the right code", async () => {
    const made = config();
    const { code, token } = await startEmailCode(made, "ana@example.org");
    expect(code).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    expect(await pendingEmail(made, token)).toBe("ana@example.org");
    expect(await checkEmailCode(made, token, code)).toEqual({ ok: true, email: "ana@example.org" });
    const wrong = String((Number(code) + 1) % 10 ** OTP_LENGTH).padStart(OTP_LENGTH, "0");
    expect(await checkEmailCode(made, token, wrong)).toEqual({ ok: false, reason: "wrong" });
  });

  it("keeps the code out of the browser: the cookie holds only a keyed fingerprint", async () => {
    const made = config();
    const { code, token } = await startEmailCode(made, "ana@example.org");
    const payload = decodeJwt(token);
    expect(Object.keys(payload).sort()).toEqual(["aud", "exp", "iat", "mac", "salt", "sub"]);
    expect(Object.values(payload)).not.toContain(code);
    // The same code for the same person gives a different fingerprint each time.
    const again = await startEmailCode(made, "ana@example.org");
    expect(decodeJwt(again.token).mac).not.toBe(payload.mac);
  });

  it("runs out after ten minutes and cannot be moved to another address or server", async () => {
    const made = config();
    const { code, token } = await startEmailCode(made, "ana@example.org");
    const other = config({ AUTH_SECRET: "another-secret-another-secret-another-secret" });
    expect(await checkEmailCode(other, token, code)).toEqual({ ok: false, reason: "expired" });
    expect(await checkEmailCode(made, undefined, code)).toEqual({ ok: false, reason: "expired" });

    const swapped = await signToken(made, "email-code", { ...decodeJwt(token), sub: "admin@example.org" }, 600);
    expect(await checkEmailCode(made, swapped, code)).toEqual({ ok: false, reason: "wrong" });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await checkEmailCode(made, token, code)).toEqual({ ok: false, reason: "expired" });
  });

  it("checks what people type", () => {
    expect(EmailStartRequestSchema.parse({ email: "  Ana@Example.ORG " }).email).toBe("ana@example.org");
    for (const bad of ["", "ana", "ana@", "ana@example", "a b@example.org"]) {
      expect(EmailStartRequestSchema.safeParse({ email: bad }).success).toBe(false);
    }
    expect(EmailVerifyRequestSchema.safeParse({ code: " 012345 " }).success).toBe(true);
    for (const bad of ["12345", "1234567", "12a456", ""]) {
      expect(EmailVerifyRequestSchema.safeParse({ code: bad }).success).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("signing in by email (routes)", () => {
  const start = async (email: string, init: Parameters<typeof request>[1] = {}) => {
    const { POST } = await import("@/app/api/auth/email/start/route");
    return POST(request("/api/auth/email/start", { body: { email }, ...init }));
  };
  const verify = async (code: string, cookie: string | undefined, init: Parameters<typeof request>[1] = {}) => {
    const { POST } = await import("@/app/api/auth/email/verify/route");
    return POST(request("/api/auth/email/verify", { body: { code }, cookies: cookie ? { [OTP_COOKIE]: cookie } : {}, ...init }));
  };
  const codeFrom = (message: Record<string, string>) => message.text.match(/\b(\d{6})\b/)?.[1] ?? "";

  it("emails a code, then signs the person in and uses the code up", async () => {
    const made = config();
    const started = await start("Ana@Example.org");
    expect(started.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "ana@example.org", from: "owner@gmail.com" });
    expect(mail.transports[0]).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true });
    const pending = cookiesSet(started);
    expect(pending.lines[0]).toContain("Path=/api/auth");
    expect(pending.lines[0]).toContain("HttpOnly");
    // The reply itself never contains the code.
    expect(JSON.stringify(await started.json())).toBe('{"ok":true}');

    const code = codeFrom(mail.sent[0]);
    const done = await verify(code, pending.values[OTP_COOKIE]);
    expect(done.status).toBe(200);
    const after = cookiesSet(done);
    expect(await readSession(made, after.values[SESSION_COOKIE])).toEqual({ email: "ana@example.org", method: "email" });
    expect(after.lines.find((line) => line.startsWith(SESSION_COOKIE))).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
    expect(after.lines.find((line) => line.startsWith(OTP_COOKIE))).toContain("Max-Age=0");
  });

  it("refuses a wrong code, and stops counting guesses after five", async () => {
    config();
    const started = await start("ana@example.org");
    const cookie = cookiesSet(started).values[OTP_COOKIE];
    const right = codeFrom(mail.sent[0]);
    const wrong = right === "000000" ? "000001" : "000000";
    for (let guess = 1; guess <= 5; guess++) {
      const res = await verify(wrong, cookie, { ip: `198.51.100.${guess}` });
      expect((await res.json()).error.code).toBe("code_wrong");
    }
    // Even the right code is refused now, from any address, until the ten minutes are over.
    const locked = await verify(right, cookie, { ip: "198.51.100.99" });
    expect(locked.status).toBe(429);
    expect(cookiesSet(locked).values[SESSION_COOKIE]).toBeUndefined();
  });

  it("needs the cookie from the browser that asked for the code", async () => {
    config();
    await start("ana@example.org");
    const res = await verify(codeFrom(mail.sent[0]), undefined);
    expect((await res.json()).error.code).toBe("code_expired");
  });

  it("sends nothing to an address that is not approved, and gives the same answer", async () => {
    config({ ALLOWED_EMAILS: "ana@example.org" });
    const stranger = await start("stranger@example.org");
    expect(stranger.status).toBe(200);
    expect(await stranger.json()).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(0);
    expect((await (await verify("123456", cookiesSet(stranger).values[OTP_COOKIE])).json()).error.code).toBe("code_wrong");

    expect((await start("ana@example.org")).status).toBe(200);
    expect(mail.sent).toHaveLength(1);
  });

  it("limits how many codes one address can be sent", async () => {
    config();
    for (let i = 0; i < 3; i++) expect((await start("ana@example.org", { ip: `198.51.100.${i}` })).status).toBe(200);
    const fourth = await start("ana@example.org", { ip: "198.51.100.50" });
    expect(fourth.status).toBe(429);
    expect(mail.sent).toHaveLength(3);
  });

  it("refuses requests from another website, bad input and too many tries from one place", async () => {
    config();
    const foreign = await start("ana@example.org", { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect((await start("ana@example.org", { origin: ORIGIN })).status).toBe(200);
    expect((await (await start("not-an-email")).json()).error.message).toContain("full email address");
    expect(mail.sent).toHaveLength(1);

    resetRateLimits();
    let last = 200;
    for (let i = 0; i < 14; i++) last = (await start(`person${i}@example.org`)).status;
    expect(last).toBe(429);
  });

  it("reports a mail problem plainly, without the mail server's message", async () => {
    config();
    mail.fail = true;
    const res = await start("ana@example.org");
    expect(res.status).toBe(502);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("email_failed");
    expect(body).not.toContain("SECRET");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRET");
    expect(logged).not.toContain("ana@example.org");
  });

  it("does not exist while sign-in is switched off, or when email is not set up", async () => {
    setEnv({});
    expect((await start("ana@example.org")).status).toBe(404);
    setEnv({ AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" });
    expect((await start("ana@example.org")).status).toBe(404);
    expect(mail.sent).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe("signing in with Google", () => {
  async function googleSide(clientId = FULL.GOOGLE_CLIENT_ID) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
    const idToken = (claims: Record<string, unknown>, expires = "5m") =>
      new SignJWT({ email: "ana@gmail.com", email_verified: true, name: "Ana K", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer("https://accounts.google.com")
        .setAudience(clientId)
        .setIssuedAt()
        .setExpirationTime(expires)
        .sign(privateKey);
    return { keys, idToken, privateKey };
  }
  const tokenEndpoint = (idToken: string | null, status = 200) => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      void url;
      void init;
      return Response.json(idToken ? { id_token: idToken, access_token: "x" } : { error: "invalid_grant" }, { status });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("sends the visitor to Google with a one-off state, nonce and PKCE challenge", async () => {
    const made = config();
    const first = await startGoogleSignIn(made, ORIGIN);
    const url = new URL(first.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: FULL.GOOGLE_CLIENT_ID,
      redirect_uri: `${ORIGIN}${GOOGLE_CALLBACK_PATH}`,
      response_type: "code",
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    // The client secret and the PKCE verifier never appear in the address.
    expect(first.url).not.toContain(FULL.GOOGLE_CLIENT_SECRET);
    const note = await readToken(made, "google", first.token);
    expect(note).toMatchObject({ state: params.state, nonce: params.nonce });
    expect(first.url).not.toContain(String(note?.verifier));
    const second = await startGoogleSignIn(made, ORIGIN);
    expect(new URL(second.url).searchParams.get("state")).not.toBe(params.state);
  });

  it("signs in someone whose email Google has verified", async () => {
    const made = config();
    const { keys, idToken } = await googleSide();
    const begun = await startGoogleSignIn(made, ORIGIN);
    const params = new URL(begun.url).searchParams;
    const fetchMock = tokenEndpoint(await idToken({ nonce: params.get("nonce") }));

    const person = await finishGoogleSignIn(
      made,
      { code: "auth-code", state: params.get("state"), token: begun.token, origin: ORIGIN },
      { keys },
    );
    expect(person).toEqual({ email: "ana@gmail.com", name: "Ana K" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    const sent = Object.fromEntries(init?.body as URLSearchParams);
    expect(sent).toMatchObject({
      code: "auth-code",
      client_id: FULL.GOOGLE_CLIENT_ID,
      client_secret: FULL.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${ORIGIN}${GOOGLE_CALLBACK_PATH}`,
      grant_type: "authorization_code",
    });
    expect(sent.code_verifier).toBe((await readToken(made, "google", begun.token))?.verifier);
  });

  it("refuses anything that does not add up", async () => {
    const made = config();
    const { keys, idToken } = await googleSide();
    const begun = await startGoogleSignIn(made, ORIGIN);
    const params = new URL(begun.url).searchParams;
    const good = { code: "auth-code", state: params.get("state"), token: begun.token, origin: ORIGIN };
    const nonce = params.get("nonce");
    const finish = (input: Parameters<typeof finishGoogleSignIn>[1], token: string | null, status = 200) => {
      tokenEndpoint(token, status);
      return finishGoogleSignIn(made, input, { keys });
    };

    // A reply that does not belong to this browser's attempt.
    expect(await finish({ ...good, state: "someone-elses-state" }, await idToken({ nonce }))).toBeNull();
    expect(await finish({ ...good, token: undefined }, await idToken({ nonce }))).toBeNull();
    expect(await finish({ ...good, code: null }, await idToken({ nonce }))).toBeNull();
    // An identity that was not issued for this sign-in, this app, or by Google.
    expect(await finish(good, await idToken({ nonce: "another-nonce" }))).toBeNull();
    expect(await finish(good, await idToken({ nonce, email_verified: false }))).toBeNull();
    expect(await finish(good, await idToken({ nonce, email: undefined }))).toBeNull();
    expect(await finish(good, await idToken({ nonce }, "-1m"))).toBeNull();
    const elsewhere = await googleSide("some-other-app.apps.googleusercontent.com");
    expect(await finishGoogleSignIn(made, good, { keys })).toBeNull();
    tokenEndpoint(await elsewhere.idToken({ nonce }));
    expect(await finishGoogleSignIn(made, good, { keys })).toBeNull();
    // Google refused the code, or could not be reached.
    expect(await finish(good, null, 400)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await finishGoogleSignIn(made, good, { keys })).toBeNull();
  });

  it("starts at /api/auth/google and comes back with errors as fixed messages", async () => {
    config();
    const begin = await (await import("@/app/api/auth/google/route")).GET(request("/api/auth/google"));
    expect(begin.status).toBe(302);
    expect(begin.headers.get("Location")).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(begin.headers.get("Location")).toContain(encodeURIComponent(`${ORIGIN}${GOOGLE_CALLBACK_PATH}`));
    const note = cookiesSet(begin);
    expect(note.lines[0]).toMatch(/Path=\/api\/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);

    // Coming back with a state that does not match: no session, and the attempt's cookie is removed.
    const { GET } = await import("@/app/api/auth/google/callback/route");
    const back = await GET(request("/api/auth/google/callback?code=x&state=wrong", { cookies: { [OAUTH_COOKIE]: note.values[OAUTH_COOKIE] } }));
    expect(back.status).toBe(303);
    expect(back.headers.get("Location")).toBe("/signin?error=google");
    expect(cookiesSet(back).values[SESSION_COOKIE]).toBeUndefined();
    expect(cookiesSet(back).lines[0]).toContain(`${OAUTH_COOKIE}=; Path=/api/auth; Max-Age=0`);
    expect(SIGN_IN_ERRORS.google).toBeTruthy();

    setEnv({ AUTH_SECRET: SECRET, SMTP_HOST: "h", SMTP_USER: "u@x.org", SMTP_PASSWORD: "p" });
    const unavailable = await (await import("@/app/api/auth/google/route")).GET(request("/api/auth/google"));
    expect(unavailable.headers.get("Location")).toBe("/signin?error=google");
  });
});

/* ------------------------------------------------------------------ */

describe("the app behind sign-in", () => {
  const POST = createKeylessPostHandler({
    route: "test",
    schema: z.object({ text: z.string() }),
    run: async () => ({ ok: true }),
  });

  it("runs API routes for anyone while sign-in is off", async () => {
    setEnv({});
    expect((await POST(request("/api/test", { body: { text: "hi" } }))).status).toBe(200);
  });

  it("refuses API routes without a valid session once sign-in is on", async () => {
    const made = config({ ALLOWED_EMAILS: "ana@example.org" });
    const anonymous = await POST(request("/api/test", { body: { text: "hi" } }));
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("signed_out");

    const token = await createSessionToken(made, { email: "ana@example.org", method: "google" });
    expect((await POST(request("/api/test", { body: { text: "hi" }, cookies: { [SESSION_COOKIE]: token } }))).status).toBe(200);

    const forged = await POST(request("/api/test", { body: { text: "hi" }, cookies: { [SESSION_COOKIE]: `${token}x` } }));
    expect(forged.status).toBe(401);

    // Taken off the list: the same cookie stops working at once.
    config({ ALLOWED_EMAILS: "someone-else@example.org" });
    expect((await POST(request("/api/test", { body: { text: "hi" }, cookies: { [SESSION_COOKIE]: token } }))).status).toBe(401);
  });

  it("stays closed when the sign-in setup is broken", async () => {
    setEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" });
    const res = await POST(request("/api/test", { body: { text: "hi" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_misconfigured");
  });

  it("signs out by removing the cookie, and only when asked by this site", async () => {
    config();
    const { POST: signOut } = await import("@/app/api/auth/signout/route");
    const out = await signOut(request("/api/auth/signout", { body: {}, origin: ORIGIN }));
    expect(out.status).toBe(303);
    expect(out.headers.get("Location")).toBe("/signin");
    expect(cookiesSet(out).lines[0]).toBe("es_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    expect((await signOut(request("/api/auth/signout", { body: {}, origin: "https://evil.example" }))).status).toBe(403);
  });
});
