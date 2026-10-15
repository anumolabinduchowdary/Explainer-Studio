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
  z.object({ done: z.literal(true), videoId: z.string() }),
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
  /** "Use my own key" mode, for writing the description. */
  apiKey: string;
  /** A 1280×720 JPEG data URL for the thumbnail, or null if one cannot be made. */
  makeThumbnail: () => Promise<string | null>;
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

/** Sends the whole video, piece by piece, and returns YouTube's id for it. */
export async function sendVideo(
  upload: string,
  video: Blob,
  options: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const total = video.size;
  let start = 0;
  // A piece YouTube did not fully take is sent again from where it stopped.
  for (let rounds = 0; rounds < Math.ceil(total / CHUNK_BYTES) * 3 + 3; rounds++) {
    const end = Math.min(total, start + CHUNK_BYTES);
    const result = await sendChunk(upload, video.slice(start, end), start, total, options.signal);
    if (result.done) {
      options.onProgress?.(total, total);
      return result.videoId;
    }
    start = result.received;
    options.onProgress?.(start, total);
  }
  throw new ApiError("youtube_failed");
}

export { toErrorInfo };
