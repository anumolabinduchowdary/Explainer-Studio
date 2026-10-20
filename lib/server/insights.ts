import "server-only";
import { z } from "zod";
import type { TrackRequest } from "@/lib/youtube";
import { AppError } from "./appError";

/**
 * Video Insights: a separate app (folder insights/) that watches each video
 * Studio posts to YouTube and reports whether it is doing better than the
 * channel's usual videos, and why. Studio only tells it about each upload.
 *
 * Two settings switch it on: INSIGHTS_URL (where Insights runs) and
 * INSIGHTS_SECRET (the same value as in Insights). The secret is read on the
 * server only and never logged.
 */

export type InsightsConfig = {
  /** Insights' address, without a trailing slash, e.g. "https://insights.example.org". */
  url: string;
  secret: string;
};

const TIMEOUT_MS = 10_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Insights' address and secret, or null when either is not set. The secret
 * is only sent over HTTPS, except to this computer while developing.
 */
export function insightsConfig(): InsightsConfig | null {
  const raw = process.env.INSIGHTS_URL?.trim() ?? "";
  const secret = process.env.INSIGHTS_SECRET?.trim() ?? "";
  if (!raw || !secret) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password) return null;
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, secret };
}

/** What Insights is told about a video (the agreed format of its /api/track). */
export type TrackBody = {
  videoId: string;
  channelId: string;
  /** The email the person signed in to Studio with. */
  uploadedBy?: string;
  studio: TrackRequest["studio"];
};

const InsightsAnswerSchema = z.object({
  reportUrl: z.string().max(2048).nullish(),
  tracking: z.boolean(),
});

/** Only a report on Insights' own site is passed on to the browser. */
function ownReport(config: InsightsConfig, reportUrl: string | null | undefined): string | null {
  if (!reportUrl?.startsWith(`${config.url}/`)) return null;
  try {
    return new URL(reportUrl).origin === new URL(config.url).origin ? reportUrl : null;
  } catch {
    return null;
  }
}

/**
 * Tells Insights about a video that has just been posted. Insights' answer is
 * checked, never logged; only a report address on Insights' own site is kept.
 */
export async function trackUpload(
  config: InsightsConfig,
  body: TrackBody,
  signal?: AbortSignal,
): Promise<{ reportUrl: string | null; tracking: boolean }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.url}/api/track`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // The secret is never carried on to another address.
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    if (timeout.aborted) throw new AppError("timeout", 504, { message: "Video Insights took too long to answer." });
    throw new AppError("server_error", 502, { message: "Video Insights could not be reached." });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError("server_error", 502, { message: "Video Insights did not take the video." });
  }
  const answer = InsightsAnswerSchema.safeParse(await response.json().catch(() => null));
  if (!answer.success) throw new AppError("server_error", 502, { message: "Video Insights gave an answer that could not be read." });
  return { reportUrl: ownReport(config, answer.data.reportUrl), tracking: answer.data.tracking };
}
