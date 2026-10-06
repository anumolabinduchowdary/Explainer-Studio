import { z } from "zod";
import { ASPECT_RATIOS, BuildPromptRequestSchema } from "./schemas";
import {
  CHARACTER_SIZES,
  STORY_LIMITS,
  VOICE_AGES,
  VOICE_AGE_SETTINGS,
  VOICE_IDS,
  type VoiceAge,
} from "./story";

/**
 * The story plan: what a cartoon story will contain, in a form people can
 * read and change before anything is written or drawn.
 *
 * It takes the place of the five-part prompt for cartoon stories. The cast
 * and the places are held as lists, not sentences, so "4 children and a
 * physiotherapist in a physiotherapy centre" becomes exactly five characters
 * and one place, and stays that way through every later step.
 */

export const PLAN_LIMITS = {
  characters: STORY_LIMITS.characters,
  places: 3,
  name: STORY_LIMITS.name,
  role: 80,
  look: STORY_LIMITS.look,
  message: 600,
  language: 60,
  tone: 120,
  notes: 400,
  minSeconds: 15,
  maxSeconds: 180,
  question: 200,
} as const;

/** Lengths offered in the plan, in seconds. */
export const PLAN_LENGTHS = [20, 30, 45, 60, 90, 120, 180] as const;

const id = z.string().trim().min(1).max(40);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const PlanCharacterSchema = z.object({
  id,
  name: z.string().trim().min(1, "Every character needs a name.").max(PLAN_LIMITS.name),
  /** Who they are in the story, e.g. "physiotherapist". */
  role: z.string().trim().max(PLAN_LIMITS.role),
  age: z.enum(VOICE_AGES),
  /** What the artist should draw. */
  look: z
    .string()
    .trim()
    .min(3, "Describe what each character looks like, so they can be drawn.")
    .max(PLAN_LIMITS.look),
});
export type PlanCharacter = z.infer<typeof PlanCharacterSchema>;

export const PlanPlaceSchema = z.object({
  id,
  name: z.string().trim().min(1, "Every place needs a name.").max(PLAN_LIMITS.name),
  look: z
    .string()
    .trim()
    .min(3, "Describe what each place looks like, so it can be drawn.")
    .max(PLAN_LIMITS.look),
});
export type PlanPlace = z.infer<typeof PlanPlaceSchema>;

export const StoryPlanSchema = z.object({
  /** What the video should teach or make people feel. */
  message: z
    .string()
    .trim()
    .min(1, "Say what the video should teach or make people feel.")
    .max(PLAN_LIMITS.message),
  characters: z
    .array(PlanCharacterSchema)
    .min(1, "Add at least one character.")
    .max(PLAN_LIMITS.characters, `A story can have up to ${PLAN_LIMITS.characters} characters.`),
  places: z
    .array(PlanPlaceSchema)
    .min(1, "Add at least one place.")
    .max(PLAN_LIMITS.places, `A story can have up to ${PLAN_LIMITS.places} places.`),
  lengthSec: z
    .number()
    .transform((n) => clamp(Math.round(n), PLAN_LIMITS.minSeconds, PLAN_LIMITS.maxSeconds)),
  aspectRatio: z.enum(ASPECT_RATIOS),
  language: z.string().trim().max(PLAN_LIMITS.language),
  tone: z.string().trim().max(PLAN_LIMITS.tone),
  /** Anything else to include or avoid. */
  notes: z.string().trim().max(PLAN_LIMITS.notes),
});
export type StoryPlan = z.infer<typeof StoryPlanSchema>;

/* ------------------------------------------------------------------ */
/* What we ask OpenAI for (plain shapes, see the note in schemas.ts)   */
/* ------------------------------------------------------------------ */

export const PlanBuildWireSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  questions: z.array(z.string()),
  message: z.string(),
  characters: z.array(
    z.object({ name: z.string(), role: z.string(), age: z.enum(VOICE_AGES), look: z.string() }),
  ),
  places: z.array(z.object({ name: z.string(), look: z.string() })),
  lengthSec: z.number(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  language: z.string(),
  tone: z.string(),
  notes: z.string(),
});
export type PlanBuildWire = z.infer<typeof PlanBuildWireSchema>;

/**
 * The story writer is not asked for the cast or the places: those come from
 * the plan. It only supplies the script and a voice for each character.
 */
export const StoryFromPlanWireSchema = z.object({
  title: z.string(),
  artStyle: z.string(),
  narratorVoice: z.enum(VOICE_IDS),
  isHealthTopic: z.boolean(),
  voices: z.array(
    z.object({ characterId: z.string(), voice: z.enum(VOICE_IDS), voiceStyle: z.string() }),
  ),
  scenes: z.array(
    z.object({
      locationId: z.string(),
      onStage: z.array(z.string()),
      lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
    }),
  ),
});
export type StoryFromPlanWire = z.infer<typeof StoryFromPlanWireSchema>;

/* ------------------------------------------------------------------ */
/* API shapes                                                          */
/* ------------------------------------------------------------------ */

/** Description (plus answers to any questions) -> plan. Same request as the prompt builder. */
export const PlanRequestSchema = BuildPromptRequestSchema;

export const PlanResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), plan: StoryPlanSchema }),
  z.object({
    status: z.literal("needs_clarification"),
    questions: z.array(z.string().trim().min(1).max(PLAN_LIMITS.question)).min(1).max(3),
  }),
]);
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const StoryFromPlanRequestSchema = z.object({ plan: StoryPlanSchema });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** How big a character stands on screen, from their age. */
export function sizeForAge(age: VoiceAge): (typeof CHARACTER_SIZES)[number] {
  if (age === "child") return "small";
  if (age === "teen") return "medium";
  return "large";
}

/** The next unused id, e.g. "c4". */
export function nextId(prefix: string, used: ReadonlyArray<{ id: string }>): string {
  const taken = new Set(used.map((item) => item.id));
  let n = used.length + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Drawings a plan needs: 4 per character (standing and gesturing, each with the mouth closed and open), 1 per place. */
export function picturesNeeded(plan: StoryPlan): number {
  return plan.characters.length * 4 + plan.places.length;
}

/** A plain-text version of the plan, for the .txt download and for the story writer. */
export function assemblePlan(plan: StoryPlan): string {
  const cast = plan.characters.map((c) => {
    const who = [c.role.trim(), VOICE_AGE_SETTINGS[c.age].label.toLowerCase()].filter(Boolean).join(", ");
    return `- ${c.id}: ${c.name.trim()} (${who}). Looks like: ${c.look.trim()}`;
  });
  const places = plan.places.map((p) => `- ${p.id}: ${p.name.trim()}. Looks like: ${p.look.trim()}`);
  const details = [
    `Length: about ${plan.lengthSec} seconds`,
    `Shape: ${plan.aspectRatio}`,
    plan.language.trim() ? `Language: ${plan.language.trim()}` : "",
    plan.tone.trim() ? `Tone: ${plan.tone.trim()}` : "",
  ].filter(Boolean);

  return [
    `MESSAGE\n${plan.message.trim()}`,
    `CHARACTERS (${plan.characters.length})\n${cast.join("\n")}`,
    `PLACES (${plan.places.length})\n${places.join("\n")}`,
    `DETAILS\n${details.join("\n")}`,
    plan.notes.trim() ? `NOTES\n${plan.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
