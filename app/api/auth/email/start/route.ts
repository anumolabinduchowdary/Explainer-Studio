import { EmailStartRequestSchema, OTP_MINUTES } from "@/lib/auth";
import { AppError } from "@/lib/server/appError";
import { isAllowed } from "@/lib/server/auth/config";
import { startEmailCode } from "@/lib/server/auth/emailCode";
import { sendSignInCode } from "@/lib/server/auth/mailer";
import { createAuthPostHandler } from "@/lib/server/auth/routes";
import { AUTH_PATH, OTP_COOKIE, cookieHeader } from "@/lib/server/auth/session";
import { rateLimit } from "@/lib/server/rateLimit";

export const maxDuration = 30;

/** Emails a 6-digit sign-in code and remembers, in a signed cookie, which address it went to. */
export const POST = createAuthPostHandler("api/auth/email/start", "send", EmailStartRequestSchema, async ({ req, body, config }) => {
  if (!config.email) {
    throw new AppError("invalid_input", 404, { message: "Signing in by email is not set up for this app." });
  }
  // Stops one address being flooded with codes, whoever asks for them.
  const perAddress = rateLimit(`auth-send:${body.email}`, 3, 10 * 60_000);
  if (!perAddress.ok) throw new AppError("rate_limited", 429, { retryAfterSec: perAddress.retryAfterSec });

  const { code, token } = await startEmailCode(config, body.email);
  // Addresses that are not approved get no email, and the same answer, so the list cannot be probed.
  if (isAllowed(config.allow, body.email)) await sendSignInCode(config.email, body.email, code);

  return {
    body: { ok: true },
    cookies: [cookieHeader(req, OTP_COOKIE, token, { maxAgeSec: OTP_MINUTES * 60, path: AUTH_PATH })],
  };
});
