import "server-only";
import { AppError } from "../appError";
import { missingSetting } from "../openai";

/**
 * Sign-in settings, read from the server's environment.
 *
 * Sign-in is off until AUTH_SECRET is set, so an app that has not been set up
 * for it keeps working as before. Once any sign-in setting is present the app
 * is closed to people who are not signed in, and a half-finished setup is
 * reported instead of leaving the door open.
 */

export type GoogleSettings = { clientId: string; clientSecret: string };
export type EmailSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  /** The "From" line of the email, e.g. "Explainer Studio <you@gmail.com>". */
  from: string;
};
export type Allowlist = { anyone: boolean; emails: ReadonlySet<string>; domains: ReadonlySet<string> };

export type AuthConfig = {
  /** Signs the cookies. Never leaves the server. */
  secret: Uint8Array;
  google: GoogleSettings | null;
  email: EmailSettings | null;
  allow: Allowlist;
};

const read = (name: string) => process.env[name]?.trim() ?? "";
const misconfigured = (name: string) =>
  new AppError("server_misconfigured", 500, { message: missingSetting(name) });

/**
 * "ana@example.org, @school.edu" -> those addresses and everyone at that
 * domain. An empty list means anyone who can prove their email may sign in.
 */
export function parseAllowlist(text: string): Allowlist {
  const entries = text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return {
    anyone: entries.length === 0,
    emails: new Set(entries.filter((entry) => !entry.startsWith("@"))),
    domains: new Set(entries.filter((entry) => entry.startsWith("@")).map((entry) => entry.slice(1))),
  };
}

export function isAllowed(allow: Allowlist, email: string): boolean {
  if (allow.anyone) return true;
  const address = email.trim().toLowerCase();
  return allow.emails.has(address) || allow.domains.has(address.slice(address.lastIndexOf("@") + 1));
}

/** The sign-in settings, or null when sign-in is switched off. */
export function authConfig(): AuthConfig | null {
  const secret = read("AUTH_SECRET");
  const googleId = read("GOOGLE_CLIENT_ID");
  const googleSecret = read("GOOGLE_CLIENT_SECRET");
  const smtp = {
    host: read("SMTP_HOST"),
    user: read("SMTP_USER"),
    password: read("SMTP_PASSWORD"),
  };
  const wantsEmail = Boolean(smtp.host || smtp.user || smtp.password);
  const wantsAny = Boolean(googleId || googleSecret || wantsEmail || read("ALLOWED_EMAILS"));

  if (!secret) {
    if (!wantsAny) return null;
    throw misconfigured("AUTH_SECRET");
  }
  if (secret.length < 32) {
    throw new AppError("server_misconfigured", 500, {
      message: "AUTH_SECRET is too short. Use a random value of at least 32 characters, then redeploy.",
    });
  }

  if (googleId && !googleSecret) throw misconfigured("GOOGLE_CLIENT_SECRET");
  if (googleSecret && !googleId) throw misconfigured("GOOGLE_CLIENT_ID");

  let email: EmailSettings | null = null;
  if (wantsEmail) {
    if (!smtp.host) throw misconfigured("SMTP_HOST");
    if (!smtp.user) throw misconfigured("SMTP_USER");
    if (!smtp.password) throw misconfigured("SMTP_PASSWORD");
    // With Gmail and most services the user name is the sending address.
    const from = read("AUTH_EMAIL_FROM") || (smtp.user.includes("@") ? smtp.user : "");
    if (!from) throw misconfigured("AUTH_EMAIL_FROM");
    const port = Number(read("SMTP_PORT") || 465);
    email = { ...smtp, from, port: Number.isInteger(port) && port > 0 ? port : 465 };
  }

  return {
    secret: new TextEncoder().encode(secret),
    google: googleId ? { clientId: googleId, clientSecret: googleSecret } : null,
    email,
    allow: parseAllowlist(read("ALLOWED_EMAILS")),
  };
}
