import { z } from "zod";

/**
 * Sign-in, as the browser sees it.
 *
 * People sign in with Google or with a 6-digit code sent to their email.
 * There are no passwords and no database: the server keeps a signed cookie in
 * the browser that says who is signed in (see lib/server/auth).
 */

export const SIGN_IN_METHODS = ["google", "email"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** The signed-in person. Only what the page shows; nothing else is kept. */
export type SessionUser = { email: string; name?: string; method: SignInMethod };

export const OTP_LENGTH = 6;
export const OTP_MINUTES = 10;
export const SESSION_DAYS = 30;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please type a full email address, like name@example.org.");

export const EmailStartRequestSchema = z.object({ email });
export const EmailVerifyRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Please type the ${OTP_LENGTH}-digit code from the email.`),
});
export const OkResponseSchema = z.object({ ok: z.literal(true) });

/** Problems the sign-in page can be opened with, as /signin?error=<name>. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't finish. Please try again.",
  not_allowed:
    "This email address isn't approved for this app yet. Ask the person who runs it to add you.",
  expired: "You have been signed out. Please sign in again.",
};
