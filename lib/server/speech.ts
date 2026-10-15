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

/**
 * How we ask the voice to perform a line. Written like a director's note to an
 * actor: the aim is a real person talking to someone in front of them, not a
 * voice reading text aloud, which is what makes speech sound robotic.
 */
export function speechInstructions(
  style: string | undefined,
  age: VoiceAge = "adult",
  delivery?: string,
): string {
  const manner = style?.trim();
  const ageManner = VOICE_AGE_SETTINGS[age].manner;
  const line = delivery?.trim();
  return [
    "You are a voice actor playing one character in a warm cartoon for families. Speak as a real person talking to someone right in front of you, not as an announcer and not as if reading aloud.",
    ageManner ? `Character: ${ageManner}.` : "",
    manner ? `Personality: ${manner}.` : "",
    line ? `This line: ${line}.` : "",
    "Delivery: natural and expressive, with the rise and fall of everyday conversation. Stress the words that matter, let questions sound like real questions, smile when the words are happy, and take small natural pauses at commas. Never flat or monotone.",
    "Say only the words given, in the language they are written in, with the natural accent and pronunciation of a native speaker of that language.",
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
      ...(steerable ? { instructions: speechInstructions(request.style, request.age, request.delivery) } : {}),
    },
    { signal },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new AppError("bad_model_output", 502);
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}
