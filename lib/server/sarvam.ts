import "server-only";
import { z } from "zod";
import { sarvamLanguage, sarvamModelFor } from "@/lib/sarvam";
import { VOICE_AGE_SETTINGS, type SpeechRequest } from "@/lib/story";
import { AppError } from "./appError";

/**
 * Sarvam AI (sarvam.ai) as the voice service: real Indian voices.
 *
 * It is used instead of OpenAI's voices when SARVAM_API_KEY is set on the
 * server, for every language it speaks (Indian English and ten Indian
 * languages); other languages keep OpenAI's voices. Like the OpenAI key, the
 * key is read from the environment only: it is sent to Sarvam in a request
 * header and is never logged, put in a URL or sent to the browser.
 *
 * API reference: https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
 */

const DEFAULT_API = "https://api.sarvam.ai";
const MAX_AUDIO_BYTES = 8_000_000;

export type SarvamSettings = { key: string; baseUrl: string };

/** The account to use, or null when Sarvam is not set up. */
export function sarvamSettings(): SarvamSettings | null {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) return null;
  // The address can be changed for local testing only.
  const baseUrl = (process.env.SARVAM_API_URL?.trim() || DEFAULT_API).replace(/\/+$/, "");
  return { key, baseUrl };
}

const ReplySchema = z.object({ audios: z.array(z.string().min(1)).min(1) });
const ErrorSchema = z.object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }) });

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

/**
 * Sarvam's failures are sorted into our own errors, with a message that says
 * what to do. Its own message is never passed on or logged.
 */
async function sarvamError(response: Response): Promise<AppError> {
  const parsed = ErrorSchema.safeParse(await response.json().catch(() => null));
  const code = parsed.success ? (parsed.data.error.code ?? "") : "";
  const said = parsed.success ? (parsed.data.error.message ?? "").toLowerCase() : "";
  if (response.status === 401 || response.status === 403 || /api_key|authentication/.test(code)) {
    return new AppError("voice_key_invalid", 401, {
      message: "Sarvam AI did not accept the key in the server settings. Check SARVAM_API_KEY in Vercel, then redeploy.",
    });
  }
  if (response.status === 402 || /quota|billing/.test(code)) {
    return new AppError("voice_credit", 402, {
      message: "The Sarvam AI account has no credit left. Add credit at dashboard.sarvam.ai, then try again.",
    });
  }
  if (response.status === 429 || /rate_limit/.test(code)) {
    const wait = Number(response.headers.get("retry-after"));
    return new AppError("voice_busy", 429, Number.isFinite(wait) && wait > 0 ? { retryAfterSec: Math.ceil(wait) } : {});
  }
  if ((response.status === 400 || response.status === 422) && /speaker/.test(said)) {
    return new AppError("voice_unavailable", 422);
  }
  return new AppError("voice_busy", 503);
}

/** Sarvam is asked for MP3; the type is read from the bytes, so a WAV reply is labelled correctly too. */
function audioType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") return "audio/wav";
  if (bytes.subarray(0, 3).toString("latin1") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  return null;
}

/** Speaks one line with one of Sarvam's voices and returns it as an audio data URL. */
export async function speakWithSarvam(
  settings: SarvamSettings,
  request: SpeechRequest,
  signal?: AbortSignal,
): Promise<string> {
  const language = sarvamLanguage(request.language, request.text);
  if (!language) {
    throw new AppError("voice_unavailable", 422, {
      message: `Sarvam AI's voices don't speak ${request.language || "this language"}. Choose another voice and try again.`,
    });
  }
  const age = request.age ?? "adult";
  // Every Sarvam voice is an adult. For a child or an older person the browser raises or lowers
  // the pitch by playing the recording faster or slower, so the voice is asked to make up for it.
  const pace = VOICE_AGE_SETTINGS[age].pace;

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/text-to-speech`, {
      method: "POST",
      headers: { "api-subscription-key": settings.key, "content-type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        language_code: language,
        speaker: request.voice,
        // The language's own native voices are Bulbul v4 Flash; the general ones Bulbul v3.
        model: sarvamModelFor(request.voice),
        pace,
        speech_sample_rate: 24000,
        output_audio_codec: "mp3",
      }),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppError("voice_busy", 503);
  }
  if (!response.ok) throw await sarvamError(response);

  const reply = ReplySchema.safeParse(await response.json().catch(() => null));
  if (!reply.success) throw new AppError("voice_busy", 502);
  const bytes = Buffer.from(reply.data.audios[0], "base64");
  const type = audioType(bytes);
  if (!type || bytes.length > MAX_AUDIO_BYTES) throw new AppError("voice_busy", 502);
  return `data:${type};base64,${bytes.toString("base64")}`;
}
