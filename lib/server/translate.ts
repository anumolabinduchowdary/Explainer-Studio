import "server-only";
import { z } from "zod";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { disclaimerFor, disclaimerLines, isEnglish, withoutDisclaimer } from "@/lib/disclaimer";
import { textLimit, type Texts } from "@/lib/translate";

/** What the model returns: one translation per item, with the item's id. */
export const TranslationWireSchema = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type TranslationWire = z.infer<typeof TranslationWireSchema>;

export type TranslationJob = {
  /** What is sent to be translated. */
  items: Array<{ id: string; text: string; max: number }>;
  /** Texts kept as they are. */
  kept: Texts;
  /** Items that end with the health disclaimer, which is put back after translating. */
  withDisclaimer: Set<string>;
  /** Lines that are only the health disclaimer. */
  disclaimerOnly: Set<string>;
  /** The language being translated into. */
  language: string;
};

/** The extra item asking the AI to translate the disclaimer, for languages the app has no translation for. */
const DISCLAIMER_ITEM = "disclaimer";

/**
 * Prepares texts for translation. The health disclaimer is taken out first
 * and put back afterwards in the new language followed by the English
 * sentence, using the app's own translation where it has one.
 */
export function prepareTranslation(texts: Texts, language = ""): TranslationJob {
  const items: TranslationJob["items"] = [];
  const kept: Texts = {};
  const withDisclaimer = new Set<string>();
  const disclaimerOnly = new Set<string>();
  for (const [id, text] of Object.entries(texts)) {
    const trimmed = text.trim();
    if (!trimmed) {
      kept[id] = text;
      continue;
    }
    if (!hasHealthDisclaimer(trimmed)) {
      items.push({ id, text: trimmed, max: textLimit(id) });
      continue;
    }
    const rest = withoutDisclaimer(trimmed);
    if (!rest) {
      disclaimerOnly.add(id);
      continue;
    }
    withDisclaimer.add(id);
    // Room is left for the longest disclaimer: a translation plus the English sentence.
    items.push({ id, text: rest, max: textLimit(id) - DISCLAIMER_ROOM });
  }
  const needsDisclaimer = withDisclaimer.size + disclaimerOnly.size > 0;
  const known = disclaimerLines(language).length > 1 || isEnglish(language);
  if (needsDisclaimer && !known && items.length > 0) {
    items.push({ id: DISCLAIMER_ITEM, text: HEALTH_DISCLAIMER, max: 120 });
  }
  return { items, kept, withDisclaimer, disclaimerOnly, language };
}

/** Space kept for the disclaimer at the end of a text. */
const DISCLAIMER_ROOM = HEALTH_DISCLAIMER.length + 80;

const hasHealthDisclaimer = (text: string) => text.toLowerCase().includes(HEALTH_DISCLAIMER.toLowerCase());

/** Shortens text to `max` characters, at a word boundary where there is one. */
function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Checks the model's answer and builds the translated texts. Throws when an
 * item is missing or empty, which makes the caller ask again.
 */
export function finishTranslation(job: TranslationJob, wire: TranslationWire): Texts {
  const answers = new Map(wire.items.map((item) => [item.id.trim(), item.text]));
  const disclaimer = disclaimerFor(job.language, answers.get(DISCLAIMER_ITEM)?.trim() ?? "");
  const texts: Texts = { ...job.kept };
  for (const item of job.items) {
    if (item.id === DISCLAIMER_ITEM) continue;
    const answer = answers.get(item.id)?.trim();
    if (!answer) throw new Error(`The translation left out ${item.id}.`);
    const translated = fit(answer, item.max);
    texts[item.id] = job.withDisclaimer.has(item.id) ? `${translated} ${disclaimer}` : translated;
  }
  for (const id of job.disclaimerOnly) texts[id] = disclaimer;
  return texts;
}
