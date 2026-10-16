import "server-only";
import { isEnglish } from "@/lib/disclaimer";
import { languageCode } from "@/lib/languages";
import { mainScript } from "@/lib/quality";
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

const INDIAN_LANGUAGE_CODES = new Set(["hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "or"]);
const INDIAN_SCRIPTS = new Set(["Devanagari", "Telugu", "Tamil", "Kannada", "Malayalam", "Bengali", "Gujarati", "Gurmukhi", "Oriya"]);

export const INDIAN_ENGLISH_ACCENT =
  "Accent: a natural Indian English accent, the way an educated person from India speaks every day, with Indian rhythm, intonation and vowel sounds. Say Indian names and words the Indian way (for example Priya, Arjun, Lakshmi, Diwali or namaste). Never an American or British accent.";

/**
 * The accent asked of the voice. The app is made for families in India, so
 * every language is spoken with an Indian accent (OpenAI's voices otherwise
 * sound American): English as Indian English, Indian languages as a native
 * speaker from India, and any other language as a fluent speaker from India
 * would say it. The language comes from the video when it is known,
 * otherwise from the script the line is written in.
 */
export function accentDirection(language: string | undefined, text: string): string {
  const name = language?.trim() ?? "";
  const script = mainScript(text);
  const code = languageCode(name);
  const indian = INDIAN_SCRIPTS.has(script) || (code !== undefined && INDIAN_LANGUAGE_CODES.has(code)) || /hinglish/i.test(name);
  if (indian) {
    const which = name && !isEnglish(name) ? name : "the language of the words";
    return `Accent: a native speaker of ${which} from India, with natural, everyday pronunciation, not formal or bookish.`;
  }
  if (isEnglish(name) && script === "Latin") return INDIAN_ENGLISH_ACCENT;
  const which = name && !isEnglish(name) ? name : "the language of the words";
  return `Accent: an Indian accent. Speak ${which} the way a fluent speaker from India would, with Indian rhythm and intonation, while keeping every word clear and correct. Never an American or British accent.`;
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
  accent?: string,
): string {
  const manner = style?.trim();
  const ageManner = VOICE_AGE_SETTINGS[age].manner;
  const line = delivery?.trim();
  return [
    "You are a voice actor playing one character in a warm cartoon for families in India. Speak as a real person talking to someone right in front of you, not as an announcer and not as if reading aloud.",
    accent ?? "",
    ageManner ? `Character: ${ageManner}.` : "",
    manner ? `Personality: ${manner}.` : "",
    line ? `This line: ${line}.` : "",
    "Delivery: natural and expressive, with the rise and fall of everyday conversation. Stress the words that matter, let questions sound like real questions, smile when the words are happy, and take small natural pauses at commas. Never flat or monotone.",
    "Say only the words given, in the language they are written in.",
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
      ...(steerable
        ? {
            instructions: speechInstructions(
              request.style,
              request.age,
              request.delivery,
              accentDirection(request.language, request.text),
            ),
          }
        : {}),
    },
    { signal },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new AppError("bad_model_output", 502);
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}
