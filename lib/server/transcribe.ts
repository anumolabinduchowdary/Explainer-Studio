import "server-only";
import { toFile } from "openai";
import { AppError } from "./appError";
import { missingSetting, type OpenAIClient } from "./openai";

/** The speech-to-text model name comes from the environment, like the others. */
function transcribeModel(): string {
  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim();
  if (!model) {
    throw new AppError("server_misconfigured", 500, {
      message: missingSetting("OPENAI_TRANSCRIBE_MODEL"),
    });
  }
  return model;
}

/** File extensions OpenAI recognises, by the type the browser recorded. */
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

/**
 * Writes down what was said in a short recording (a base64 data URL).
 * The language is detected automatically. The recording is passed straight to
 * OpenAI and is not stored or logged.
 */
export async function transcribeAudio(
  client: OpenAIClient,
  dataUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const model = transcribeModel();
  const match = /^data:(audio\/[a-z0-9.-]+)[^,]*;base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new AppError("invalid_input", 400, { message: "That recording could not be read." });

  const type = match[1].toLowerCase();
  const extension = EXTENSIONS[type];
  if (!extension) throw new AppError("invalid_input", 400, { message: "That recording could not be read." });

  const file = await toFile(Buffer.from(match[2], "base64"), `speech.${extension}`, { type });
  const result = await client.audio.transcriptions.create({ model, file }, { signal });
  return result.text.trim();
}
