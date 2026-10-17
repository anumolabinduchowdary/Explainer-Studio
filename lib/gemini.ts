import type { VoiceOption } from "./voices";

/**
 * Google Gemini's voices: each line is acted from a written direction (who
 * the character is, how the line is said, the accent), which makes them sound
 * like real people talking. Used instead of the other voice services when
 * GEMINI_API_KEY is set on the server (see lib/server/gemini.ts).
 *
 * Voices: https://ai.google.dev/gemini-api/docs/speech-generation
 */

/**
 * The 30 prebuilt voices, with Google's one-word description and the gender
 * Google gives the same voices in Cloud Text-to-Speech. `like` is the OpenAI
 * voice each one is closest to: the story writer casts with OpenAI's voices,
 * so a character it gave a deep voice gets Gemini's gravelly one, and so on.
 * Within each gender the order is the order voices are given out.
 */
const VOICES: Array<[id: string, gender: "female" | "male", sound: string, like?: string]> = [
  ["Sulafat", "female", "warm", "marin"],
  ["Vindemiatrix", "female", "gentle", "sage"],
  ["Autonoe", "female", "bright", "coral"],
  ["Laomedeia", "female", "upbeat", "nova"],
  ["Achernar", "female", "soft", "shimmer"],
  ["Aoede", "female", "breezy"],
  ["Leda", "female", "youthful"],
  ["Despina", "female", "smooth"],
  ["Kore", "female", "firm", "alloy"],
  ["Callirrhoe", "female", "easy-going"],
  ["Erinome", "female", "clear"],
  ["Zephyr", "female", "bright"],
  ["Pulcherrima", "female", "forward"],
  ["Gacrux", "female", "mature"],
  ["Algieba", "male", "smooth", "cedar"],
  ["Achird", "male", "friendly", "ash"],
  ["Puck", "male", "upbeat", "verse"],
  ["Umbriel", "male", "easy-going", "ballad"],
  ["Charon", "male", "informative", "fable"],
  ["Schedar", "male", "even", "echo"],
  ["Algenib", "male", "gravelly", "onyx"],
  ["Sadachbia", "male", "lively"],
  ["Iapetus", "male", "clear"],
  ["Zubenelgenubi", "male", "casual"],
  ["Enceladus", "male", "breathy"],
  ["Orus", "male", "firm"],
  ["Fenrir", "male", "excitable"],
  ["Alnilam", "male", "firm"],
  ["Rasalgethi", "male", "informative"],
  ["Sadaltager", "male", "knowledgeable"],
];

export const GEMINI_VOICE_OPTIONS: VoiceOption[] = [
  ...VOICES.filter(([, gender]) => gender === "female"),
  ...VOICES.filter(([, gender]) => gender === "male"),
].map(([id, gender, sound, like]) => ({
  id,
  label: `${id} (${gender}, ${sound})`,
  gender,
  age: "adult" as const,
  ...(like ? { like } : {}),
}));

const IDS = new Set(VOICES.map(([id]) => id));

export function isGeminiVoice(id: string): boolean {
  return IDS.has(id);
}
