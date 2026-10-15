import { z } from "zod";
import { LANGUAGE_MAX } from "./languages";

/**
 * Automatic quality checks, so a finished video can be posted without
 * anyone having to edit it: the facts are checked and fixed, every drawing
 * is compared with its description, and every recorded line is listened back.
 */

/**
 * Organisations a video may point viewers to. The AI only chooses from this
 * list, so it can never invent a source or a link. Each address was checked
 * to be the organisation's own website.
 */
export const TRUSTED_SOURCES = [
  { id: "who", name: "World Health Organization", url: "https://www.who.int" },
  { id: "unicef", name: "UNICEF", url: "https://www.unicef.org" },
  { id: "iap", name: "Indian Academy of Pediatrics", url: "https://iapindia.org" },
  { id: "mohfw", name: "Ministry of Health and Family Welfare, Government of India", url: "https://mohfw.gov.in" },
  { id: "nhm", name: "National Health Mission, India", url: "https://nhm.gov.in" },
  { id: "icmr", name: "Indian Council of Medical Research", url: "https://www.icmr.gov.in" },
  { id: "aiims", name: "All India Institute of Medical Sciences, New Delhi", url: "https://www.aiims.edu" },
  { id: "nimhans", name: "NIMHANS (National Institute of Mental Health and Neurosciences)", url: "https://nimhans.ac.in" },
  { id: "rci", name: "Rehabilitation Council of India", url: "https://rehabcouncil.nic.in" },
  { id: "depwd", name: "Department of Empowerment of Persons with Disabilities, Government of India", url: "https://depwd.gov.in" },
  { id: "niepid", name: "National Institute for the Empowerment of Persons with Intellectual Disabilities", url: "https://niepid.nic.in" },
  { id: "afa", name: "Action For Autism", url: "https://www.autism-india.org" },
  { id: "isha", name: "Indian Speech and Hearing Association", url: "https://ishaindia.org.in" },
  { id: "iaphysio", name: "Indian Association of Physiotherapists", url: "https://www.physiotherapyindia.org" },
  { id: "aiota", name: "All India Occupational Therapists' Association", url: "https://www.aiota.org" },
  { id: "cdc", name: "U.S. Centers for Disease Control and Prevention", url: "https://www.cdc.gov" },
  { id: "nhs", name: "NHS (UK National Health Service)", url: "https://www.nhs.uk" },
  { id: "nichd", name: "U.S. National Institute of Child Health and Human Development", url: "https://www.nichd.nih.gov" },
] as const;
export type SourceId = (typeof TRUSTED_SOURCES)[number]["id"];
export const SOURCE_IDS = TRUSTED_SOURCES.map((source) => source.id) as [SourceId, ...SourceId[]];

export const SourceSchema = z.object({ name: z.string().max(120), url: z.string().url().max(200) });
export type Source = z.infer<typeof SourceSchema>;

/** The words of a video, keyed by where they belong (see lib/translate.ts). */
const TextsSchema = z.record(z.string().regex(/^(title|s\d{1,2}\.(l\d{1,2}|h|b|p\d))$/), z.string().max(400));

export const FactCheckRequestSchema = z.object({
  kind: z.enum(["explainer", "story"]),
  language: z.string().trim().max(LANGUAGE_MAX),
  texts: TextsSchema.refine((texts) => Object.keys(texts).length > 0, "There is nothing to check."),
});
export type FactCheckRequest = z.infer<typeof FactCheckRequestSchema>;

export const FactChangeSchema = z.object({
  key: z.string(),
  before: z.string(),
  after: z.string(),
  /** Why it was changed, in plain words. */
  reason: z.string(),
});
export type FactChange = z.infer<typeof FactChangeSchema>;

export const FactCheckResponseSchema = z.object({
  /** The corrected texts (only the ones that changed). */
  texts: z.record(z.string(), z.string()),
  changes: z.array(FactChangeSchema),
  sources: z.array(SourceSchema),
  /** How many texts were checked. */
  checked: z.number().int().nonnegative(),
});
export type FactCheckResult = z.infer<typeof FactCheckResponseSchema>;

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

export const MAX_CHECK_IMAGE_CHARS = 3_500_000;

export const PictureCheckRequestSchema = z.object({
  kind: z.enum(["character", "background", "exercise"]),
  look: z.string().trim().min(3).max(400),
  image: z
    .string()
    .max(MAX_CHECK_IMAGE_CHARS, "That picture is too large to check.")
    .regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/, "That picture could not be read."),
});
export const PictureCheckResponseSchema = z.object({
  matches: z.boolean(),
  /** What is wrong, written as instructions for a redraw. Empty when it matches. */
  problems: z.array(z.string().max(200)).max(5),
});
export type PictureCheck = z.infer<typeof PictureCheckResponseSchema>;

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

export const VoiceCheckSchema = z.object({
  /** "ok": the words were heard as written; "unclear": they were not, even after a second try; "skipped": not checked. */
  result: z.enum(["ok", "unclear", "skipped"]),
  /** How closely the recording matched the words, 0 to 1. */
  score: z.number().min(0).max(1).optional(),
  /** True when the line was recorded a second time because the first was unclear. */
  retried: z.boolean(),
});
export type VoiceCheck = z.infer<typeof VoiceCheckSchema>;

/* ------------------------------------------------------------------ */
/* Comparing what was meant to be said with what was heard             */
/* ------------------------------------------------------------------ */

function normalise(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The writing system most of the letters are in, e.g. "Latin" or "Devanagari". */
export function mainScript(text: string): string {
  const scripts = ["Latin", "Devanagari", "Telugu", "Tamil", "Kannada", "Malayalam", "Bengali", "Gujarati", "Gurmukhi", "Oriya", "Arabic"];
  let best = "Other";
  let most = 0;
  for (const script of scripts) {
    const count = (text.match(new RegExp(`\\p{Script=${script}}`, "gu")) ?? []).length;
    if (count > most) {
      most = count;
      best = script;
    }
  }
  return best;
}

/** How alike two texts are, from 0 (nothing alike) to 1 (the same), ignoring punctuation and case. */
export function similarity(expected: string, heard: string): number {
  const a = [...normalise(expected).replace(/ /g, "")];
  const b = [...normalise(heard).replace(/ /g, "")];
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

/** Below this, a line is recorded again. */
export const VOICE_MATCH_THRESHOLD = 0.6;
