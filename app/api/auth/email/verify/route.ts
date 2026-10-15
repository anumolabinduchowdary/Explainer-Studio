import { EmailVerifyRequestSchema } from "@/lib/auth";
import { AppError } from "@/lib/server/appError";
import { isAllowed } from "@/lib/server/auth/config";
import { checkEmailCode, pendingEmail } from "@/lib/server/auth/emailCode";
import { createAuthPostHandler } from "@/lib/server/auth/routes";
import {
  AUTH_PATH,
  OTP_COOKIE,
  clearCookie,
  createSessionToken,
  readCookie,
  sessionCookie,
} from "@/lib/server/auth/session";
import { rateLimit } from "@/lib/server/rateLimit";

/** Guesses allowed per email address in ten minutes, the lifetime of a code. */
const GUESSES = 5;

/** Checks the code from the email and, if it is right, signs the person in. */
export const POST = createAuthPostHandler("api/auth/email/verify", "check", EmailVerifyRequestSchema, async ({ req, body, config }) => {
  const token = readCookie(req, OTP_COOKIE);
  const email = await pendingEmail(config, token);
  if (!email) throw new AppError("code_expired", 400);

  // A 6-digit code must not be guessable, so guesses are counted per address as well as per IP.
  const guesses = rateLimit(`auth-guess:${email}`, GUESSES, 10 * 60_000);
  if (!guesses.ok) throw new AppError("rate_limited", 429, { retryAfterSec: guesses.retryAfterSec });

  const check = await checkEmailCode(config, token, body.code);
  if (!check.ok) throw new AppError(check.reason === "expired" ? "code_expired" : "code_wrong", 400);
  if (!isAllowed(config.allow, check.email)) throw new AppError("code_wrong", 400);

  const session = await createSessionToken(config, { email: check.email, method: "email" });
  return {
    body: { ok: true },
    // The code is used up: its cookie is removed as the session begins.
    cookies: [sessionCookie(req, session), clearCookie(req, OTP_COOKIE, AUTH_PATH)],
  };
});
