import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { OTP_LENGTH, OTP_MINUTES } from "@/lib/auth";
import { readToken, signToken } from "./session";
import type { AuthConfig } from "./config";

/**
 * One-time sign-in codes, without a database.
 *
 * The code is emailed. The browser gets a signed token holding the email
 * address and a keyed fingerprint of the code (never the code itself), which
 * can only be recomputed with the server's secret. To sign in, the same
 * browser must send back the token and the code from the email.
 */

const fingerprint = (config: AuthConfig, email: string, code: string, salt: string) =>
  createHmac("sha256", config.secret).update(`${email}\n${code}\n${salt}`).digest();

export async function startEmailCode(config: AuthConfig, email: string): Promise<{ code: string; token: string }> {
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const salt = randomBytes(16).toString("base64url");
  const token = await signToken(
    config,
    "email-code",
    { sub: email, salt, mac: fingerprint(config, email, code, salt).toString("base64url") },
    OTP_MINUTES * 60,
  );
  return { code, token };
}

/** The email address a pending code was sent to, or null if the token is missing or out of date. */
export async function pendingEmail(config: AuthConfig, token: string | undefined): Promise<string | null> {
  const payload = await readToken(config, "email-code", token);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

export type CodeCheck = { ok: true; email: string } | { ok: false; reason: "expired" | "wrong" };

export async function checkEmailCode(config: AuthConfig, token: string | undefined, code: string): Promise<CodeCheck> {
  const payload = await readToken(config, "email-code", token);
  if (!payload || typeof payload.sub !== "string" || typeof payload.salt !== "string" || typeof payload.mac !== "string") {
    return { ok: false, reason: "expired" };
  }
  const expected = Buffer.from(payload.mac, "base64url");
  const given = fingerprint(config, payload.sub, code, payload.salt);
  // Compared in constant time, so the answer does not leak how close a guess was.
  const matches = expected.length === given.length && timingSafeEqual(expected, given);
  return matches ? { ok: true, email: payload.sub } : { ok: false, reason: "wrong" };
}
