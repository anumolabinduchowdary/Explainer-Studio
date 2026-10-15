import {
  MAX_EXERCISES,
  PLAN_LIMITS,
  StoryPlanSchema,
  type StoryKind,
  sizeForAge,
  type PlanBuildWire,
  type PlanResponse,
  type StoryFromPlanWire,
  type StoryPlan,
} from "@/lib/plan";
import { DEFAULT_ART_STYLE, STORY_LIMITS, VOICE_IDS, type Story, type StoryWire } from "@/lib/story";
import { disclaimerFor } from "@/lib/disclaimer";
import { normalizeStory } from "./normalizeStory";

type WireScene = StoryFromPlanWire["scenes"][number];

/**
 * In a home exercise programme every exercise gets its own scene with its
 * card, in the therapist's order. Exercises the writer left out are added as
 * a simple scene where the therapist reads the steps, so none is ever lost.
 */
function scenesWithCards(plan: StoryPlan, scenes: WireScene[]): StoryWire["scenes"] {
  const exercises = plan.kind === "exercises" ? plan.exercises : [];
  const card = (index: number) => {
    const exercise = exercises[index];
    return exercise
      ? {
          card: {
            title: exercise.name,
            dose: exercise.dose,
            look: exercise.look,
            ...(exercise.caution ? { caution: exercise.caution } : {}),
          },
        }
      : {};
  };
  const shown = new Set<number>();
  const result: StoryWire["scenes"] = scenes.map(({ exercise, ...scene }, i) => {
    const index = Number.isInteger(exercise) && !shown.has(exercise) ? exercise : -1;
    if (index >= 0 && index < exercises.length) shown.add(index);
    return { id: `s${i + 1}`, ...scene, ...card(index) };
  });
  const therapist = plan.characters.find((character) => character.age !== "child") ?? plan.characters[0];
  exercises.forEach((exercise, index) => {
    if (shown.has(index)) return;
    // Put it before the closing scene, in order.
    const at = Math.max(0, result.length - 1);
    result.splice(at, 0, {
      id: `x${index + 1}`,
      locationId: plan.places[0].id,
      onStage: [therapist.id],
      lines: [
        { speaker: therapist.id, text: `${exercise.name}. ${exercise.steps}`.slice(0, 160), how: "clear and encouraging" },
        ...(exercise.dose ? [{ speaker: therapist.id, text: exercise.dose, how: "clear and encouraging" }] : []),
      ],
      ...card(index),
    });
  });
  return result;
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

/**
 * Turns the model's raw plan into the validated one. Throws when the plan is
 * unusable (no characters, no place, no message), which makes the caller retry.
 */
export function normalizePlanBuild(
  wire: PlanBuildWire,
  options: { allowQuestions: boolean; kind?: StoryKind },
): PlanResponse {
  const kind = options.kind ?? "story";
  const questions = wire.questions
    .map((q) => q.trim().slice(0, PLAN_LIMITS.question))
    .filter(Boolean)
    .slice(0, 3);
  if (options.allowQuestions && wire.status === "needs_clarification" && questions.length > 0) {
    return { status: "needs_clarification", questions };
  }

  const exercises =
    kind === "exercises"
      ? wire.exercises
          .filter((exercise) => exercise.name.trim() && exercise.steps.trim())
          .slice(0, MAX_EXERCISES)
          .map((exercise, i) => ({
            id: `e${i + 1}`,
            name: clip(exercise.name, 60),
            steps: clip(exercise.steps, 300),
            dose: clip(exercise.dose, 80),
            look: clip(exercise.look, PLAN_LIMITS.look) || clip(exercise.steps, PLAN_LIMITS.look),
            caution: clip(exercise.caution, 160),
          }))
      : [];
  if (kind === "exercises" && exercises.length === 0) throw new Error("The programme has no exercises.");

  const plan = StoryPlanSchema.parse({
    kind,
    // Social Stories are always calm; the person can switch it on for any story on the plan.
    calm: kind === "social",
    exercises,
    message: clip(wire.message, PLAN_LIMITS.message),
    // Characters and places keep the order the model listed them in; nothing is merged.
    characters: wire.characters
      .filter((c) => c.name.trim() || c.look.trim())
      .slice(0, PLAN_LIMITS.characters)
      .map((c, i) => ({
        id: `c${i + 1}`,
        name: clip(c.name, PLAN_LIMITS.name) || `Character ${i + 1}`,
        role: clip(c.role, PLAN_LIMITS.role),
        age: c.age,
        look: clip(c.look, PLAN_LIMITS.look),
      })),
    places: wire.places
      .filter((p) => p.name.trim() || p.look.trim())
      .slice(0, PLAN_LIMITS.places)
      .map((p, i) => ({
        id: `l${i + 1}`,
        name: clip(p.name, PLAN_LIMITS.name) || `Place ${i + 1}`,
        look: clip(p.look, PLAN_LIMITS.look),
      })),
    lengthSec: wire.lengthSec > 0 ? wire.lengthSec : 45,
    aspectRatio: wire.aspectRatio,
    language: clip(wire.language, PLAN_LIMITS.language),
    tone: clip(wire.tone, PLAN_LIMITS.tone),
    notes: clip(wire.notes, PLAN_LIMITS.notes),
    style: clip(wire.style, STORY_LIMITS.artStyle),
  });
  return { status: "ready", plan };
}

/**
 * Builds the finished story from the plan and the writer's script.
 *
 * The cast and the places are copied from the plan, never from the model, so
 * a story always has exactly the characters and places the user agreed to.
 * The model contributes the title, the lines and a voice for each character.
 */
export function buildStoryFromPlan(plan: StoryPlan, wire: StoryFromPlanWire): Story {
  const voices = new Map(wire.voices.map((v) => [v.characterId.trim(), v]));
  const taken = new Set<string>([wire.narratorVoice, ...wire.voices.map((v) => v.voice)]);
  const spare = VOICE_IDS.filter((voice) => !taken.has(voice));

  const draft: StoryWire = {
    title: wire.title,
    aspectRatio: plan.aspectRatio,
    // Every picture follows the plan's drawing style, which comes from the person's own description.
    artStyle: plan.style.trim() || DEFAULT_ART_STYLE,
    narratorVoice: wire.narratorVoice,
    isHealthTopic: wire.isHealthTopic,
    disclaimer: disclaimerFor(plan.language, wire.disclaimer),
    characters: plan.characters.map((character, i) => {
      const chosen = voices.get(character.id);
      return {
        id: character.id,
        name: character.name,
        look: character.look,
        size: sizeForAge(character.age),
        // A character the writer forgot still gets a voice of their own.
        voice: chosen?.voice ?? spare[i % Math.max(1, spare.length)] ?? VOICE_IDS[i % VOICE_IDS.length],
        voiceAge: character.age,
        voiceStyle: chosen?.voiceStyle ?? "",
      };
    }),
    locations: plan.places.map((place) => ({ id: place.id, name: place.name, look: place.look })),
    calm: plan.calm,
    scenes: scenesWithCards(plan, wire.scenes),
  };

  const story = normalizeStory(draft);
  if (story.characters.length !== plan.characters.length) {
    throw new Error("The story lost a character from the plan.");
  }

  // Everyone in the plan must be seen at least once: put anyone left out into the emptiest scene.
  for (const character of story.characters) {
    if (story.scenes.some((scene) => scene.onStage.includes(character.id))) continue;
    const scene = [...story.scenes].sort((a, b) => a.onStage.length - b.onStage.length)[0];
    if (scene.onStage.length < STORY_LIMITS.onStage) scene.onStage.push(character.id);
  }
  return story;
}
