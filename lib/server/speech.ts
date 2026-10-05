import "server-only";
import { VOICE_AGE_SETTINGS, type SpeechRequest, type VoiceAge } from "@/lib/story";
import { AppError } from "./appError";
import { missingSetting, type OpenAIClient } from "./openai";

/** The text-to-speech model name comes from the environment, like the others. */
function speechModel(): string {
  const model = process.env.OPENAI_SPEECH_MODEL?.trim();
  if (!model) {
    throw new AppError("server_misconfigured", 500, { message: missingSetting("OPENAI_SPEECH_MODEL") });
  }
  return model;
}

/** How we ask the voice to perform a line. */
export function speechInstructions(style: string | undefined, age: VoiceAge = "adult"): string {
  const manner = style?.trim();
  const ageManner = VOICE_AGE_SETTINGS[age].manner;
  return [
    "You are voicing one character in a short, friendly cartoon for families.",
    ageManner ? `The character is ${ageManner}.` : "",
    manner ? `The character sounds like this: ${manner}.` : "",
    "Speak naturally and clearly at an easy pace, with warmth. Say only the words given, in the language they are written in.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Turns one line into speech and returns it as an MP3 data URL. */
export async function generateSpeech(
  client: OpenAIClient,
  request: SpeechRequest,
  signal?: AbortSignal,
): Promise<string> {
  const model = speechModel();
  // The older "tts-1" models do not accept performance instructions.
  const steerable = !model.startsWith("tts-1");
  const response = await client.audio.speech.create(
    {
      model,
      voice: request.voice,
      input: request.text,
      response_format: "mp3",
      ...(steerable ? { instructions: speechInstructions(request.style, request.age) } : {}),
    },
    { signal },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new AppError("bad_model_output", 502);
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}
