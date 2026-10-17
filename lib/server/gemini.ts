import "server-only";
import { z } from "zod";
import type { SpeechRequest } from "@/lib/story";
import { AppError } from "./appError";
import { accentDirection, speechInstructions } from "./speech";

/**
 * Google Gemini as the voice service: each line is acted from a written
 * direction, which sounds like real people talking.
 *
 * It is used instead of the other voice services when GEMINI_API_KEY is set
 * on the server. Like the OpenAI key, the key is read from the environment
 * only: it is sent to Google in a request header and is never logged, put in
 * a URL or sent to the browser.
 *
 * API reference: https://ai.google.dev/gemini-api/docs/speech-generation
 */

const DEFAULT_API = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-3.8-flash-tts";
const SAMPLE_RATE = 24000;
const MAX_AUDIO_BYTES = 8_000_000;

export type GeminiSettings = { key: string; model: string; baseUrl: string };

/** The account to use, or null when Gemini is not set up. */
export function geminiSettings(): GeminiSettings | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return {
    key,
    model: process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_MODEL,
    // The address can be changed for local testing only.
    baseUrl: (process.env.GEMINI_API_URL?.trim() || DEFAULT_API).replace(/\/+$/, ""),
  };
}

const ErrorSchema = z.object({ error: z.object({ message: z.string().optional(), status: z.string().optional() }) });

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

/** Finds the base64 audio in the reply, wherever the steps put it. */
function findAudio(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 8) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "audio" && typeof record.data === "string") return record.data;
  for (const child of Object.values(record)) {
    const items = Array.isArray(child) ? child : [child];
    for (const item of items) {
      const found = findAudio(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Google's failures are sorted into our own errors, with a message that says
 * what to do. Its own message is never passed on or logged.
 */
async function geminiError(response: Response): Promise<AppError> {
  const parsed = ErrorSchema.safeParse(await response.json().catch(() => null));
  const said = parsed.success ? (parsed.data.error.message ?? "") : "";
  const status = parsed.success ? (parsed.data.error.status ?? "") : "";
  if (response.status === 401 || response.status === 403 || /api key/i.test(said) || status === "PERMISSION_DENIED") {
    return new AppError("voice_key_invalid", 401, {
      message: "Google did not accept the Gemini key in the server settings. Check GEMINI_API_KEY in Vercel, then redeploy.",
    });
  }
  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") {
    // Google says how long to wait ("Please retry in 17s").
    const wait = Number(said.match(/retry in ([\d.]+)\s*s/i)?.[1]);
    return new AppError("voice_busy", 429, { retryAfterSec: Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) + 1 : 20 });
  }
  if (response.status === 400 && /voice|speaker/i.test(said)) return new AppError("voice_unavailable", 422);
  return new AppError("voice_busy", 503);
}

/**
 * The direction the voice acts from: who the character is, how this line is
 * said, and the accent (Indian English, or a native speaker from India).
 */
export function geminiDirection(request: SpeechRequest): string {
  return speechInstructions(request.style, request.age, request.delivery, accentDirection(request.language, request.text));
}

/** Speaks one line with one of Gemini's voices and returns it as a WAV data URL. */
export async function speakWithGemini(
  settings: GeminiSettings,
  request: SpeechRequest,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/v1beta/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": settings.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        input: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                // The text is spoken exactly as written; the direction goes alongside it.
                text: request.text,
                annotations: [{ type: "speech_metadata", style: geminiDirection(request) }],
              },
            ],
          },
        ],
        response_format: { type: "audio", mime_type: "audio/wav", sample_rate: SAMPLE_RATE },
        generation_config: { speech_config: [{ voice: request.voice }] },
      }),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppError("voice_busy", 503);
  }
  if (!response.ok) throw await geminiError(response);

  const audio = findAudio(await response.json().catch(() => null));
  if (!audio) throw new AppError("voice_busy", 502);
  const bytes = Buffer.from(audio, "base64");
  if (bytes.subarray(0, 4).toString("latin1") !== "RIFF" || bytes.length > MAX_AUDIO_BYTES) {
    throw new AppError("voice_busy", 502);
  }
  return `data:audio/wav;base64,${bytes.toString("base64")}`;
}
