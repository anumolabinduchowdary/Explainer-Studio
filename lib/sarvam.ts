import { isEnglish } from "./disclaimer";
import { languageCode } from "./languages";
import { mainScript } from "./quality";
import type { VoiceOption } from "./voices";

/**
 * Sarvam AI's voices (Bulbul v3): real Indian voices for Indian English and
 * ten Indian languages. Used instead of OpenAI's voices when SARVAM_API_KEY
 * is set on the server (see lib/server/sarvam.ts).
 *
 * Voices: https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices
 */

/**
 * Every Bulbul v3 voice, best first: Sarvam names shubh and ishita (and priya)
 * as its top voices. All are adults and every voice speaks every language.
 * varun is deep and dramatic, good for a villain but not as a default, so it
 * comes last.
 */
const MALE = [
  "shubh", "aditya", "rahul", "rohan", "amit", "dev", "ratan", "manan", "sumit", "kabir", "aayan", "ashutosh",
  "advait", "anand", "tarun", "sunny", "mani", "gokul", "vijay", "mohit", "rehan", "soham", "varun",
] as const;
const FEMALE = [
  "ishita", "priya", "ritu", "neha", "pooja", "simran", "kavya", "shreya", "roopa", "tanya", "shruti", "suhani",
  "kavitha", "rupali",
] as const;

const NOTES: Record<string, string> = {
  shubh: "recommended",
  ishita: "recommended",
  priya: "recommended",
  varun: "deep and dramatic",
};

const label = (id: string, gender: string) =>
  `${id[0].toUpperCase()}${id.slice(1)} (${[gender, NOTES[id]].filter(Boolean).join(", ")})`;

/** Women's voices, then men's, each best first: characters are given the first free voice of their gender. */
export const SARVAM_VOICE_OPTIONS: VoiceOption[] = [
  ...FEMALE.map((id) => ({ id, label: label(id, "female"), gender: "female" as const, age: "adult" as const })),
  ...MALE.map((id) => ({ id, label: label(id, "male"), gender: "male" as const, age: "adult" as const })),
];

const SARVAM_IDS = new Set<string>([...MALE, ...FEMALE]);

export function isSarvamVoice(id: string): boolean {
  return SARVAM_IDS.has(id);
}

/** Our language codes (see lib/languages) to Sarvam's. */
const CODES: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  ta: "ta-IN",
  te: "te-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  pa: "pa-IN",
  or: "od-IN",
};

/** The script a line is written in, when the video's language is not named. */
const BY_SCRIPT: Record<string, string> = {
  Latin: "en-IN",
  Devanagari: "hi-IN",
  Bengali: "bn-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN",
  Gujarati: "gu-IN",
  Kannada: "kn-IN",
  Malayalam: "ml-IN",
  Gurmukhi: "pa-IN",
  Oriya: "od-IN",
};

/**
 * Sarvam's code for a line ("en-IN", "hi-IN"…), or null when Sarvam does not
 * speak the language (for example French), in which case OpenAI's voices are used.
 */
export function sarvamLanguage(language: string | undefined, text: string): string | null {
  const name = language?.trim() ?? "";
  const code = languageCode(name);
  if (code) return CODES[code] ?? null;
  // Hinglish is written in Latin letters and spoken with an Indian English voice.
  if (/hinglish/i.test(name)) return "en-IN";
  // No language named (or "Original"): go by the letters the line is written in.
  if (isEnglish(name)) return BY_SCRIPT[mainScript(text)] ?? null;
  return null;
}

/** Whether Sarvam's voices can speak a story in this language. Empty means "as written", which is assumed to be fine. */
export function sarvamSpeaks(language: string): boolean {
  const name = language.trim();
  if (!name || isEnglish(name) || /hinglish/i.test(name)) return true;
  const code = languageCode(name);
  return code !== undefined && code in CODES;
}
