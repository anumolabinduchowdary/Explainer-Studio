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

/**
 * Sarvam's newer voices (Bulbul v4 Flash), each recorded for one language in
 * one speaking style. Only conversational and storytelling styles are listed
 * (not ads, banking and so on), and only names whose gender is clear. They
 * are offered in the Voices menu after the general voices, but not given out
 * by themselves: in a Telugu listening test the conversational ones (Kavitha,
 * Pooja) sounded halting. Only voices that passed a listening test (see
 * LISTENED) are given out first.
 * The id is "<name>_<language>_<style>"; the name is the person, so
 * "tarun_te_narration" and "tarun" are never given to two characters.
 */
const NATIVE: Record<string, Array<[id: string, gender: "female" | "male"]>> = {
  "en-IN": [
    ["ishita_en_stories", "female"], ["aditi_en_stories", "female"], ["chandrika_en_stories", "female"],
    ["roopa_en_conversational", "female"], ["simran_en_conversation", "female"], ["zarina_en_conversation", "female"],
    ["shubh_en_narration", "male"], ["dev_en_conversational", "male"], ["deven_en_conversation", "male"],
    ["sarang_en_narration", "male"],
  ],
  "hi-IN": [
    ["kavya_hi_conversational", "female"], ["shreya_hi_conversational", "female"], ["roopa_hi_conversational", "female"],
    ["ritu_hi_conversation", "female"], ["simran_hi_conversation", "female"], ["sarika_hi_conversation", "female"],
    ["tanya_hi_narration", "female"], ["shilpa_hi_narration", "female"],
    ["rahul_hi_conversational", "male"], ["aditya_hi_conversational", "male"], ["amit_hi_conversational", "male"],
    ["kabir_hi_conversational", "male"], ["mohit_hi_conversational", "male"], ["tarun_hi_conversational", "male"],
    ["manan_hi_conversational", "male"], ["sumit_hi_conversational", "male"], ["ashutosh_hi_conversational", "male"],
    ["aayan_hi_conversational", "male"], ["mani_hi_conversational", "male"],
  ],
  "te-IN": [["kavitha_te_conversation", "female"], ["tarun_te_narration", "male"]],
  "ta-IN": [["gokul_ta_narration", "male"], ["vijay_ta_narration", "male"]],
  "kn-IN": [["chaitra_kn_conversation", "female"], ["suchitra_kn_narration", "female"], ["chetan_kn_conversation", "male"]],
  "mr-IN": [
    ["ishita_mr_conversational", "female"], ["neha_mr_narration", "female"], ["rupali_mr_stories", "female"],
    ["nilesh_mr_conversation", "male"], ["soham_mr_narration", "male"], ["mukul_mr_stories", "male"],
  ],
  "pa-IN": [["anand_pa_conversation", "male"]],
  "gu-IN": [["pooja_gu_conversational", "female"], ["bhavik_gu_conversation", "male"]],
  "bn-IN": [["roopa_bn_conversational", "female"], ["arnab_bn_conversation", "male"]],
};

const LANGUAGE_NAMES: Record<string, string> = {
  "en-IN": "Indian English", "hi-IN": "Hindi", "te-IN": "Telugu", "ta-IN": "Tamil", "kn-IN": "Kannada",
  "mr-IN": "Marathi", "pa-IN": "Punjabi", "gu-IN": "Gujarati", "bn-IN": "Bengali",
};

function nativeOption(id: string, gender: "female" | "male", code: string): VoiceOption {
  const [name, , ...style] = id.split("_");
  const manner = /conversation/.test(style.join(" ")) ? "conversational" : "storyteller";
  return {
    id,
    label: `${name[0].toUpperCase()}${name.slice(1)} (${gender}, ${LANGUAGE_NAMES[code]} voice, ${manner})`,
    gender,
    age: "adult",
  };
}

/** Native voices that sounded natural when listened to, and so are given out before the general ones. */
const LISTENED = new Set(["tarun_te_narration"]);

const NATIVE_IDS = new Set(Object.values(NATIVE).flatMap((voices) => voices.map(([id]) => id)));
const V3_IDS = new Set<string>([...MALE, ...FEMALE]);

/** Every Sarvam voice, native ones included: for knowing a voice's gender whatever the language. */
export const ALL_SARVAM_VOICE_OPTIONS: VoiceOption[] = [
  ...Object.entries(NATIVE).flatMap(([code, voices]) => voices.map(([id, gender]) => nativeOption(id, gender, code))),
  ...SARVAM_VOICE_OPTIONS,
];

export function isSarvamVoice(id: string): boolean {
  return V3_IDS.has(id) || NATIVE_IDS.has(id);
}

/** The model a voice belongs to: the native voices are Bulbul v4 Flash, the others Bulbul v3. */
export function sarvamModelFor(id: string): "bulbul:v3" | "bulbul:v4-flash" {
  return NATIVE_IDS.has(id) ? "bulbul:v4-flash" : "bulbul:v3";
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

/**
 * The voices for a story in this language. Characters are given the first
 * free voice of their gender, so the order matters: native voices that passed
 * a listening test, then the general voices (which speak every language),
 * then the language's other native voices, to choose by hand.
 */
export function sarvamVoicesFor(language: string): VoiceOption[] {
  const code = language.trim() ? sarvamLanguage(language, "") : null;
  const native = code ? (NATIVE[code] ?? []).map(([id, gender]) => nativeOption(id, gender, code)) : [];
  return [
    ...native.filter((voice) => LISTENED.has(voice.id)),
    ...SARVAM_VOICE_OPTIONS,
    ...native.filter((voice) => !LISTENED.has(voice.id)),
  ];
}

/** Whether Sarvam's voices can speak a story in this language. Empty means "as written", which is assumed to be fine. */
export function sarvamSpeaks(language: string): boolean {
  const name = language.trim();
  if (!name || isEnglish(name) || /hinglish/i.test(name)) return true;
  const code = languageCode(name);
  return code !== undefined && code in CODES;
}
