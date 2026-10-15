import { HEALTH_DISCLAIMER } from "./config";

/**
 * The health disclaimer in other languages.
 *
 * Health videos end with "For awareness, not medical advice." In a video in
 * another language the line is shown in that language first and then in
 * English, so viewers can read it and the exact English sentence is always
 * there. These translations were written for the app: please have a native
 * speaker of each language check them before relying on them.
 */
export const LOCAL_DISCLAIMERS: Record<string, string> = {
  hindi: "जागरूकता के लिए, चिकित्सीय सलाह नहीं।",
  telugu: "అవగాహన కోసం, వైద్య సలహా కాదు.",
  tamil: "விழிப்புணர்வுக்காக, மருத்துவ ஆலோசனை அல்ல.",
  kannada: "ಜಾಗೃತಿಗಾಗಿ, ವೈದ್ಯಕೀಯ ಸಲಹೆ ಅಲ್ಲ.",
  malayalam: "അവബോധത്തിനായി, വൈദ്യോപദേശമല്ല.",
  marathi: "जागरूकतेसाठी, वैद्यकीय सल्ला नाही.",
  bengali: "সচেতনতার জন্য, চিকিৎসা পরামর্শ নয়।",
  gujarati: "જાગૃતિ માટે, તબીબી સલાહ નથી.",
  punjabi: "ਜਾਗਰੂਕਤਾ ਲਈ, ਡਾਕਟਰੀ ਸਲਾਹ ਨਹੀਂ।",
  odia: "ସଚେତନତା ପାଇଁ, ଚିକିତ୍ସା ପରାମର୍ଶ ନୁହେଁ।",
};

const words = (language: string): string[] => language.toLowerCase().match(/\p{L}+/gu) ?? [];

/** English, or not known (then English is used). */
export function isEnglish(language: string): boolean {
  const named = words(language);
  return named.length === 0 || named.includes("english") || named.includes("original");
}

/**
 * The disclaimer's lines for a video in `language`: the translation, then
 * the English sentence. Languages outside the list use `translation` when
 * one is given (the AI writes it); otherwise only English.
 */
export function disclaimerLines(language: string, translation = ""): string[] {
  if (isEnglish(language)) return [HEALTH_DISCLAIMER];
  const local = words(language).map((word) => LOCAL_DISCLAIMERS[word]).find(Boolean) ?? translation.trim();
  return local && local.toLowerCase() !== HEALTH_DISCLAIMER.toLowerCase() ? [local, HEALTH_DISCLAIMER] : [HEALTH_DISCLAIMER];
}

/** The disclaimer as one line of text, e.g. for the last line of a story. */
export function disclaimerFor(language: string, translation = ""): string {
  return disclaimerLines(language, translation).join(" ");
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Takes the disclaimer out of a text: the English sentence, the translations in the list and any `extra` ones. */
export function withoutDisclaimer(text: string, extra: string[] = []): string {
  let rest = text.replace(new RegExp(escape(HEALTH_DISCLAIMER), "gi"), " ");
  for (const sentence of [...Object.values(LOCAL_DISCLAIMERS), ...extra]) {
    if (sentence.trim()) rest = rest.split(sentence.trim()).join(" ");
  }
  return rest.replace(/\s+/g, " ").trim();
}

/** The full disclaimer a text ends with (translation included), or "" if it has none. */
export function disclaimerIn(text: string): string {
  if (!text.toLowerCase().includes(HEALTH_DISCLAIMER.toLowerCase())) return "";
  const local = Object.values(LOCAL_DISCLAIMERS).find((sentence) => text.includes(sentence));
  return local ? `${local} ${HEALTH_DISCLAIMER}` : HEALTH_DISCLAIMER;
}
