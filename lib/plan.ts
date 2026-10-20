import { z } from "zod";
import { ASPECT_RATIOS, BuildPromptRequestSchema } from "./schemas";
import {
  CHARACTER_SIZES,
  STORY_LIMITS,
  VOICE_AGES,
  VOICE_AGE_SETTINGS,
  EMOTIONS,
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

/** The kinds of cartoon video. */
export const STORY_KINDS = ["story", "social", "exercises"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];
export const STORY_KIND_LABELS: Record<StoryKind, string> = {
  story: "Cartoon story",
  social: "Social Story",
  exercises: "Home exercise programme",
};
export const THERAPY_TYPES = ["Physiotherapy", "Occupational therapy", "Speech therapy"] as const;
export const MAX_EXERCISES = 8;

/** One exercise in a home programme, as the therapist set it. */
export const PlanExerciseSchema = z.object({
  id,
  name: z.string().trim().min(1, "Every exercise needs a name.").max(60),
  /** How to do it, in one to three plain sentences. */
  steps: z.string().trim().min(3, "Say how to do the exercise.").max(300),
  /** How much, e.g. "10 times, 2 rounds" or "Hold for 5 seconds, 3 times". */
  dose: z.string().trim().max(80),
  /** What the instruction picture shows. */
  look: z.string().trim().min(3, "Describe the picture of the exercise.").max(PLAN_LIMITS.look),
  /** A safety note, if the therapist gave one. */
  caution: z.string().trim().max(160).default(""),
});
export type PlanExercise = z.infer<typeof PlanExerciseSchema>;

export const StoryPlanSchema = z.object({
  /** What kind of video: a story, a Social Story for an autistic child, or a home exercise programme. */
  kind: z.enum(STORY_KINDS).default("story"),
  /** Sensory-friendly playback: no flashes, gentler movement, more time between lines. */
  calm: z.boolean().default(false),
  /** Home exercise programmes: the exercises, in order. */
  exercises: z.array(PlanExerciseSchema).max(MAX_EXERCISES).default([]),
  /** About special parenting: the video ends with the Special Parenting QR card. */
  specialParenting: z.boolean().default(false),
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
  /**
   * How the pictures should look, in plain words, as the description asked
   * (e.g. "soft watercolour cartoon with pastel colours"). Empty means the
   * app's standard friendly 2D cartoon style.
   */
  style: z.string().trim().max(STORY_LIMITS.artStyle).default(""),
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
  style: z.string(),
  exercises: z.array(
    z.object({ name: z.string(), steps: z.string(), dose: z.string(), look: z.string(), caution: z.string() }),
  ),
  specialParenting: z.boolean(),
});
export type PlanBuildWire = z.infer<typeof PlanBuildWireSchema>;

/**
 * The story writer is not asked for the cast or the places: those come from
 * the plan. It only supplies the script and a voice for each character.
 */
export const StoryFromPlanWireSchema = z.object({
  title: z.string(),
  narratorVoice: z.enum(VOICE_IDS),
  isHealthTopic: z.boolean(),
  /** The health disclaimer in the plan's language, for languages the app has no translation for. */
  disclaimer: z.string(),
  voices: z.array(
    z.object({ characterId: z.string(), voice: z.enum(VOICE_IDS), voiceStyle: z.string() }),
  ),
  scenes: z.array(
    z.object({
      locationId: z.string(),
      /** Home exercise programmes: which exercise this scene shows (0 for the first), or -1 for none. */
      exercise: z.number(),
      onStage: z.array(z.string()),
      /** Characters (from onStage) who fly through the scene; usually none. */
      flying: z.array(z.string()),
      lines: z.array(
        z.object({ speaker: z.string(), text: z.string(), how: z.string(), emotion: z.enum(EMOTIONS), thought: z.boolean() }),
      ),
    }),
  ),
});
export type StoryFromPlanWire = z.infer<typeof StoryFromPlanWireSchema>;

/* ------------------------------------------------------------------ */
/* API shapes                                                          */
/* ------------------------------------------------------------------ */

/** Description (plus answers to any questions) -> plan, with the details each kind of video needs. */
export const PlanRequestSchema = BuildPromptRequestSchema.extend({
  kind: z.enum(STORY_KINDS).optional(),
  /** Social Stories: the child the story is for. Only a first name is needed, and no photo. */
  child: z
    .object({
      name: z.string().trim().max(40),
      age: z.string().trim().max(20),
      look: z.string().trim().max(300),
      helps: z.string().trim().max(300),
    })
    .optional(),
  /** Home exercise programmes: the therapy and the exercises, as the therapist wrote them. */
  therapy: z
    .object({
      type: z.string().trim().max(40),
      who: z.string().trim().max(80),
      exercises: z.string().trim().max(3000),
    })
    .optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

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

/**
 * Drawings a plan needs: 6 per character (standing, a hand raised and both
 * hands open, each with the mouth closed and open), 1 per place and 1 per exercise.
 */
export function picturesNeeded(plan: StoryPlan): number {
  return plan.characters.length * 6 + plan.places.length + plan.exercises.length;
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
    `Drawing style: ${plan.style.trim() || "the standard friendly 2D cartoon style"}`,
  ].filter(Boolean);

  const exercises = plan.exercises.map(
    (exercise, i) =>
      `- Exercise ${i}: ${exercise.name.trim()}. How: ${exercise.steps.trim()} How much: ${exercise.dose.trim() || "as shown"}.${
        exercise.caution.trim() ? ` Caution: ${exercise.caution.trim()}` : ""
      } Picture: ${exercise.look.trim()}`,
  );
  return [
    `KIND\n${STORY_KIND_LABELS[plan.kind]}${plan.calm ? " (calm, sensory-friendly)" : ""}`,
    `MESSAGE\n${plan.message.trim()}`,
    `CHARACTERS (${plan.characters.length})\n${cast.join("\n")}`,
    `PLACES (${plan.places.length})\n${places.join("\n")}`,
    `DETAILS\n${details.join("\n")}`,
    plan.notes.trim() ? `NOTES\n${plan.notes.trim()}` : "",
    exercises.length ? `EXERCISES (${exercises.length}, in this order)\n${exercises.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
