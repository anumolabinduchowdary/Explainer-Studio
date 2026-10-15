/**
 * Languages a video can be made in. The list is a shortcut, not a limit:
 * people can also type any other language the AI can write.
 */
export const VIDEO_LANGUAGES = [
  { name: "English", code: "en", native: "English" },
  { name: "Hindi", code: "hi", native: "हिन्दी" },
  { name: "Telugu", code: "te", native: "తెలుగు" },
  { name: "Tamil", code: "ta", native: "தமிழ்" },
  { name: "Kannada", code: "kn", native: "ಕನ್ನಡ" },
  { name: "Malayalam", code: "ml", native: "മലയാളം" },
  { name: "Marathi", code: "mr", native: "मराठी" },
  { name: "Bengali", code: "bn", native: "বাংলা" },
  { name: "Gujarati", code: "gu", native: "ગુજરાતી" },
  { name: "Punjabi", code: "pa", native: "ਪੰਜਾਬੀ" },
  { name: "Odia", code: "or", native: "ଓଡ଼ିଆ" },
] as const;

export const LANGUAGE_MAX = 60;

/** The standard short code for a language in the list (e.g. "hi" for Hindi), or undefined. */
export function languageCode(name: string): string | undefined {
  return VIDEO_LANGUAGES.find((language) => language.name.toLowerCase() === name.trim().toLowerCase())?.code;
}

/** "Hindi" -> "हिन्दी (Hindi)", so people can find their language in their own script. */
export function languageLabel(name: string): string {
  const known = VIDEO_LANGUAGES.find((language) => language.name.toLowerCase() === name.trim().toLowerCase());
  if (!known) return name.trim();
  return known.native === known.name ? known.name : `${known.native} (${known.name})`;
}

/**
 * Languages OpenAI's voices are documented to speak well (its text-to-speech
 * guide lists them). Others may be read with a poor accent.
 */
const OPENAI_SPEECH_LANGUAGES = new Set(
  [
    "afrikaans", "arabic", "armenian", "azerbaijani", "belarusian", "bosnian", "bulgarian", "catalan",
    "chinese", "croatian", "czech", "danish", "dutch", "english", "estonian", "finnish", "french",
    "galician", "german", "greek", "hebrew", "hindi", "hungarian", "icelandic", "indonesian", "italian",
    "japanese", "kannada", "kazakh", "korean", "latvian", "lithuanian", "macedonian", "malay", "marathi",
    "maori", "nepali", "norwegian", "persian", "polish", "portuguese", "romanian", "russian", "serbian",
    "slovak", "slovenian", "spanish", "swahili", "swedish", "tagalog", "tamil", "thai", "turkish",
    "ukrainian", "urdu", "vietnamese", "welsh",
  ],
);

/** Whether OpenAI's voices are documented to speak this language well. Unknown or empty counts as English. */
export function openAiSpeaksWell(language: string): boolean {
  const words = language.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return true;
  return words.some((word) => OPENAI_SPEECH_LANGUAGES.has(word));
}
