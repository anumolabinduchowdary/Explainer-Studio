import { z } from "zod";
import { VISUAL_IDS } from "./visuals";

export const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
/** The two sections of the app: text-and-picture explainers, and cartoon stories. */
export const VIDEO_KINDS = ["explainer", "story"] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];
export const TRANSITIONS = ["fade", "slide-left", "slide-up", "zoom"] as const;

export const LIMITS = {
  descriptionMin: 10,
  description: 1500,
  field: 1500,
  question: 200,
  answer: 300,
  title: 120,
  heading: 120,
  body: 400,
  bullet: 140,
  bullets: 5,
  scenes: 20,
  minSceneSec: 2,
  maxSceneSec: 30,
  instruction: 300,
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ------------------------------------------------------------------ */
/* The 5-step prompt                                                   */
/* ------------------------------------------------------------------ */

const requiredField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(LIMITS.field, `${label} is too long (max ${LIMITS.field} characters).`);

export const FiveStepPromptSchema = z.object({
  actAs: requiredField("Act as"),
  goal: requiredField("Goal"),
  context: requiredField("Context"),
  constraints: z
    .string()
    .trim()
    .max(LIMITS.field, `Constraints is too long (max ${LIMITS.field} characters).`),
  output: requiredField("Output"),
});
export type FiveStepPrompt = z.infer<typeof FiveStepPromptSchema>;

/* ------------------------------------------------------------------ */
/* Storyboard                                                          */
/* ------------------------------------------------------------------ */

export const SceneSchema = z.object({
  id: z.string().trim().min(1).max(40),
  // Any number is accepted and snapped to half-seconds within the allowed range.
  durationSec: z
    .number()
    .transform((n) => clamp(Math.round(n * 2) / 2, LIMITS.minSceneSec, LIMITS.maxSceneSec)),
  heading: z.string().trim().max(LIMITS.heading),
  body: z.string().trim().max(LIMITS.body),
  bullets: z.array(z.string().trim().min(1).max(LIMITS.bullet)).max(LIMITS.bullets),
  visual: z.enum(VISUAL_IDS),
  transition: z.enum(TRANSITIONS),
});
export type Scene = z.infer<typeof SceneSchema>;

export const StoryboardSchema = z.object({
  title: z.string().trim().max(LIMITS.title),
  aspectRatio: z.enum(ASPECT_RATIOS),
  scenes: z.array(SceneSchema).min(1).max(LIMITS.scenes),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;
export type AspectRatio = Storyboard["aspectRatio"];
export type Transition = Scene["transition"];

/* ------------------------------------------------------------------ */
/* "Wire" schemas: the shapes we ask OpenAI for with Structured Outputs */
/* ------------------------------------------------------------------ */
// These stay deliberately plain (every field required, no length rules) so
// they convert to a strict JSON Schema. Tighter rules are applied afterwards
// by the schemas above.

export const PromptBuildWireSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  questions: z.array(z.string()),
  actAs: z.string(),
  goal: z.string(),
  context: z.string(),
  constraints: z.string(),
  output: z.string(),
});
export type PromptBuildWire = z.infer<typeof PromptBuildWireSchema>;

export const SceneWireSchema = z.object({
  id: z.string(),
  durationSec: z.number(),
  heading: z.string(),
  body: z.string(),
  bullets: z.array(z.string()),
  visual: z.enum(VISUAL_IDS),
  transition: z.enum(TRANSITIONS),
});
export type SceneWire = z.infer<typeof SceneWireSchema>;

export const StoryboardWireSchema = z.object({
  title: z.string(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  isHealthTopic: z.boolean(),
  scenes: z.array(SceneWireSchema),
});
export type StoryboardWire = z.infer<typeof StoryboardWireSchema>;

/* ------------------------------------------------------------------ */
/* API requests and responses                                          */
/* ------------------------------------------------------------------ */

export const BuildPromptRequestSchema = z.object({
  description: z
    .string()
    .trim()
    .min(LIMITS.descriptionMin, "Please describe your video in a sentence or two.")
    .max(LIMITS.description, `Please keep the description under ${LIMITS.description} characters.`),
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(LIMITS.question),
        answer: z.string().trim().max(LIMITS.answer),
      }),
    )
    .max(3)
    .optional(),
  skipQuestions: z.boolean().optional(),
  kind: z.enum(VIDEO_KINDS).optional(),
});
export type BuildPromptRequest = z.infer<typeof BuildPromptRequestSchema>;

export const BuildPromptResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), prompt: FiveStepPromptSchema }),
  z.object({
    status: z.literal("needs_clarification"),
    questions: z.array(z.string().trim().min(1).max(LIMITS.question)).min(1).max(3),
  }),
]);
export type BuildPromptResponse = z.infer<typeof BuildPromptResponseSchema>;

export const StoryboardRequestSchema = z.object({ prompt: FiveStepPromptSchema });
export type StoryboardRequest = z.infer<typeof StoryboardRequestSchema>;

export const StoryboardResponseSchema = z.object({ storyboard: StoryboardSchema });
export type StoryboardResponse = z.infer<typeof StoryboardResponseSchema>;

export const SceneRequestSchema = z.object({
  prompt: FiveStepPromptSchema,
  storyboard: StoryboardSchema,
  sceneId: z.string().trim().min(1).max(40),
  instruction: z.string().trim().max(LIMITS.instruction).optional(),
});
export type SceneRequest = z.infer<typeof SceneRequestSchema>;

export const SceneResponseSchema = z.object({ scene: SceneSchema });
export type SceneResponse = z.infer<typeof SceneResponseSchema>;

/* ------------------------------------------------------------------ */
/* Speaking instead of typing                                          */
/* ------------------------------------------------------------------ */

/** Largest recording accepted, as a base64 data URL (about 2 MB of sound). */
export const MAX_AUDIO_CHARS = 3_000_000;

export const TranscribeRequestSchema = z.object({
  audio: z
    .string()
    .max(MAX_AUDIO_CHARS, "That recording is too long. Please keep it under a minute.")
    .regex(
      /^data:audio\/(webm|mp4|m4a|x-m4a|mpeg|wav|ogg)(;[a-z0-9=.,-]+)*;base64,[A-Za-z0-9+/=]+$/i,
      "That recording could not be read.",
    ),
});

export const TranscribeResponseSchema = z.object({ text: z.string() });
