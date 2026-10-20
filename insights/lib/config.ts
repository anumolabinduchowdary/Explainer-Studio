import "server-only";
import { createHash } from "node:crypto";

/**
 * Settings, read from the server's environment. Nothing here ever reaches the
 * browser. A missing setting is reported by name, so a half-finished setup
 * says what to add instead of failing quietly.
 */

export class SetupError extends Error {
  readonly setting: string;
  constructor(setting: string, message?: string) {
    super(
      message ??
        `${setting} is not set on the server. Add it to the environment settings, then redeploy (or restart the app if you run it yourself).`,
    );
    this.name = "SetupError";
    this.setting = setting;
  }
}

const read = (name: string) => process.env[name]?.trim() ?? "";

export type Allowlist = { anyone: boolean; emails: ReadonlySet<string>; domains: ReadonlySet<string> };

/** "ana@example.org, @school.edu": those addresses and everyone at that domain. Empty means anyone. */
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

export type AuthSettings = {
  /** Signs the cookies. */
  secret: Uint8Array;
  /** Encrypts the Google permissions kept in the database. Derived from AUTH_SECRET. */
  tokenKey: Uint8Array;
  google: { clientId: string; clientSecret: string };
  allow: Allowlist;
};

/** Sign-in settings. Throws a SetupError naming the first missing one. */
export function authSettings(): AuthSettings {
  const secret = read("AUTH_SECRET");
  if (!secret) throw new SetupError("AUTH_SECRET");
  if (secret.length < 32) {
    throw new SetupError("AUTH_SECRET", "AUTH_SECRET is too short. Use a random value of at least 32 characters, then redeploy.");
  }
  const clientId = read("GOOGLE_CLIENT_ID");
  const clientSecret = read("GOOGLE_CLIENT_SECRET");
  if (!clientId) throw new SetupError("GOOGLE_CLIENT_ID");
  if (!clientSecret) throw new SetupError("GOOGLE_CLIENT_SECRET");
  return {
    secret: new TextEncoder().encode(secret),
    tokenKey: createHash("sha256").update("video-insights google tokens\n").update(secret).digest(),
    google: { clientId, clientSecret },
    allow: parseAllowlist(read("ALLOWED_EMAILS")),
  };
}

/** The first missing sign-in setting, or null when sign-in is ready. */
export function setupProblem(): string | null {
  try {
    authSettings();
    return null;
  } catch (err) {
    return err instanceof SetupError ? err.message : "The app's settings could not be read.";
  }
}

/** The secret Explainer Studio sends with each upload, or null when that link is not set up. */
export const insightsSecret = () => read("INSIGHTS_SECRET") || null;
/** The secret the scheduler sends (Vercel sends CRON_SECRET by itself). */
export const cronSecret = () => read("CRON_SECRET") || null;
/** Where Explainer Studio lives, for a link back to it. */
export const studioUrl = () => {
  const url = read("STUDIO_URL");
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : null;
};

export type AiSettings = { apiKey: string; model: string; effort?: string };

/** OpenAI settings for writing the reports in plain words, or null to use the built-in rules only. */
export function aiSettings(): AiSettings | null {
  const apiKey = read("OPENAI_API_KEY");
  const model = read("OPENAI_TEXT_MODEL");
  if (!apiKey || !model) return null;
  const effort = read("OPENAI_REASONING_EFFORT");
  return { apiKey, model, ...(effort ? { effort } : {}) };
}
