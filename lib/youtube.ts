import { z } from "zod";
import { ApiError, toErrorInfo } from "./api";
import { LANGUAGE_MAX } from "./languages";
import { SourceSchema, type Source } from "./quality";
import { isErrorCode } from "./errors";

/**
 * Posting a finished video straight to YouTube.
 *
 * The person connects their channel once (Google asks them to allow it).
 * After that, one press of "Upload to YouTube" writes the title, description
 * and tags, makes a thumbnail, sends the video in pieces through our server
 * (so no YouTube key ever reaches the browser) and sets the thumbnail.
 */

/** YouTube's own limits. */
export const YOUTUBE_LIMITS = { title: 100, descriptionBytes: 5000, tagsChars: 500 } as const;
/** Each piece of the video sent to the server. Must be a multiple of 256 KB and fit under the host's 4.5 MB request limit. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

export const YouTubeStatusSchema = z.object({
  connected: z.boolean(),
  /** The Google account the channel belongs to. */
  email: z.string().optional(),
  /** How new uploads appear: public, unlisted or private. */
  privacy: z.enum(["public", "unlisted", "private"]).optional(),
  /** Whether each upload is handed to the Video Insights app. */
  insights: z.boolean().optional(),
});
export type YouTubeStatus = z.infer<typeof YouTubeStatusSchema>;

export const DetailsRequestSchema = z.object({
  kind: z.enum(["explainer", "story"]),
  title: z.string().trim().max(200),
  /** The words of the video (dialogue or on-screen text), for writing the description. */
  script: z.string().trim().min(1, "The video has no words to describe.").max(12_000),
  language: z.string().trim().max(LANGUAGE_MAX),
  health: z.boolean(),
  aiVoices: z.boolean(),
  /** Trusted organisations chosen by the fact check, listed under "Learn more". */
  sources: z.array(SourceSchema).max(3).default([]),
  /** Ask viewers to follow the account: only when the video ends with its QR card. */
  follow: z.boolean().default(true),
});
export type DetailsRequest = z.infer<typeof DetailsRequestSchema>;

export const VideoDetailsSchema = z.object({
  title: z.string().trim().min(1).max(YOUTUBE_LIMITS.title),
  description: z.string().max(YOUTUBE_LIMITS.descriptionBytes),
  tags: z.array(z.string().trim().min(1).max(100)).max(30),
  /** A short language code such as "hi", when the language is known. */
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
});
export type VideoDetails = z.infer<typeof VideoDetailsSchema>;

export const StartRequestSchema = z.object({
  details: VideoDetailsSchema,
  size: z.number().int().positive().max(4 * 1024 ** 3),
  mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/),
});
export const StartResponseSchema = z.object({ upload: z.string().min(20) });

export const ChunkResponseSchema = z.union([
  z.object({ done: z.literal(false), received: z.number().int().nonnegative() }),
  /** The receipt (encrypted) proves to the server that this browser has just uploaded the video. */
  z.object({ done: z.literal(true), videoId: z.string(), receipt: z.string().optional() }),
]);

export const ThumbnailRequestSchema = z.object({
  upload: z.string().min(20),
  videoId: z.string().regex(/^[\w-]{6,20}$/),
  image: z
    .string()
    .max(3_000_000, "The thumbnail is too large.")
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, "The thumbnail must be a JPEG picture."),
});
export const ThumbnailResponseSchema = z.object({ ok: z.boolean(), reason: z.string().optional() });

export const DetailsResponseSchema = z.object({ details: VideoDetailsSchema });

/* ------------------------------------------------------------------ */
/* Video Insights                                                      */
/* ------------------------------------------------------------------ */

/** What Video Insights (a separate app) takes about the video's scenes. */
export const INSIGHTS_LIMITS = { scenes: 40, sceneText: 120 } as const;

export const InsightsSceneSchema = z.object({
  startSec: z.number().nonnegative().max(86_400),
  text: z.string().max(INSIGHTS_LIMITS.sceneText),
});
export type InsightsScene = z.infer<typeof InsightsSceneSchema>;

/** The scenes as Video Insights takes them: at most 40, each with a few words. */
export function insightsScenes(scenes: ReadonlyArray<{ startSec: number; text: string }>): InsightsScene[] {
  return scenes.slice(0, INSIGHTS_LIMITS.scenes).map((scene) => {
    const text = scene.text.replace(/\s+/g, " ").trim();
    return {
      startSec: Math.round(Math.max(0, scene.startSec) * 10) / 10,
      text: text.length > INSIGHTS_LIMITS.sceneText ? `${text.slice(0, INSIGHTS_LIMITS.sceneText - 1).trimEnd()}…` : text,
    };
  });
}

/** Asks the server to tell Video Insights about a video this browser has just uploaded. */
export const TrackRequestSchema = z.object({
  receipt: z.string().min(20).max(4000),
  studio: z.object({
    kind: z.enum(["explainer", "story"]),
    title: z.string().trim().max(200),
    language: z.string().trim().max(LANGUAGE_MAX),
    health: z.boolean(),
    aiVoices: z.boolean(),
    durationSec: z.number().nonnegative().max(86_400),
    /** The aspect ratio, e.g. "9:16". */
    shape: z.string().trim().max(16),
    scenes: z.array(InsightsSceneSchema).max(INSIGHTS_LIMITS.scenes),
  }),
});
export type TrackRequest = z.infer<typeof TrackRequestSchema>;
/** The report's address, or null when Video Insights is not set up or gave none. */
export const TrackResponseSchema = z.object({
  reportUrl: z.string().regex(/^https?:\/\//).nullable(),
  tracking: z.boolean(),
});

/** What a video page tells the YouTube panel about its video. */
export type YouTubeInfo = {
  kind: "explainer" | "story";
  title: string;
  script: string;
  /** The video's language, or "" when not known. */
  language: string;
  health: boolean;
  aiVoices: boolean;
  /** Trusted organisations from the fact check. */
  sources: Source[];
  /** Whether the video ends with the Special Parenting QR card, so the description mentions the account. */
  follow: boolean;
  /** "Use my own key" mode, for writing the description. */
  apiKey: string;
  /** A 1280×720 JPEG data URL for the thumbnail, or null if one cannot be made. */
  makeThumbnail: () => Promise<string | null>;
  /** For Video Insights: the video's length in seconds. */
  durationSec?: number;
  /** For Video Insights: the aspect ratio, e.g. "9:16". */
  shape?: string;
  /** For Video Insights: when each scene starts, and a few words from it. */
  scenes?: InsightsScene[];
};

export const youtubeLink = (videoId: string) => `https://youtu.be/${videoId}`;
export const studioLink = (videoId: string) => `https://studio.youtube.com/video/${videoId}/edit`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends one piece of the video. Network hiccups and busy answers are tried again a few times. */
async function sendChunk(
  upload: string,
  piece: Blob,
  start: number,
  total: number,
  signal?: AbortSignal,
): Promise<z.infer<typeof ChunkResponseSchema>> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch("/api/youtube/chunk", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Upload": upload,
          "X-Upload-Start": String(start),
          "X-Upload-Total": String(total),
        },
        body: piece,
        signal,
        cache: "no-store",
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt >= 4) throw new ApiError("network");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = ChunkResponseSchema.safeParse(json);
      if (parsed.success) return parsed.data;
      throw new ApiError("youtube_failed");
    }
    const error = (json as { error?: { code?: unknown; message?: string; retryAfterSec?: number } } | null)?.error;
    const busy = response.status >= 500 || response.status === 429;
    if (busy && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (error && isErrorCode(error.code)) throw new ApiError(error.code, error.message, error.retryAfterSec);
    throw new ApiError("youtube_failed");
  }
}

/** Sends the whole video, piece by piece, and returns YouTube's id for it and the upload's receipt. */
export async function sendVideo(
  upload: string,
  video: Blob,
  options: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<{ videoId: string; receipt?: string }> {
  const total = video.size;
  let start = 0;
  // A piece YouTube did not fully take is sent again from where it stopped.
  for (let rounds = 0; rounds < Math.ceil(total / CHUNK_BYTES) * 3 + 3; rounds++) {
    const end = Math.min(total, start + CHUNK_BYTES);
    const result = await sendChunk(upload, video.slice(start, end), start, total, options.signal);
    if (result.done) {
      options.onProgress?.(total, total);
      return { videoId: result.videoId, receipt: result.receipt };
    }
    start = result.received;
    options.onProgress?.(start, total);
  }
  throw new ApiError("youtube_failed");
}

export { toErrorInfo };
