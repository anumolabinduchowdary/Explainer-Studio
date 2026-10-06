import {
  PLAN_LIMITS,
  StoryPlanSchema,
  sizeForAge,
  type PlanBuildWire,
  type PlanResponse,
  type StoryFromPlanWire,
  type StoryPlan,
} from "@/lib/plan";
import { STORY_LIMITS, VOICE_IDS, type Story, type StoryWire } from "@/lib/story";
import { normalizeStory } from "./normalizeStory";

const clip = (text: string, max: number) => text.trim().slice(0, max);

/**
 * Turns the model's raw plan into the validated one. Throws when the plan is
 * unusable (no characters, no place, no message), which makes the caller retry.
 */
export function normalizePlanBuild(
  wire: PlanBuildWire,
  options: { allowQuestions: boolean },
): PlanResponse {
  const questions = wire.questions
    .map((q) => q.trim().slice(0, PLAN_LIMITS.question))
    .filter(Boolean)
    .slice(0, 3);
  if (options.allowQuestions && wire.status === "needs_clarification" && questions.length > 0) {
    return { status: "needs_clarification", questions };
  }

  const plan = StoryPlanSchema.parse({
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
    artStyle: wire.artStyle,
    narratorVoice: wire.narratorVoice,
    isHealthTopic: wire.isHealthTopic,
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
    scenes: wire.scenes.map((scene, i) => ({ id: `s${i + 1}`, ...scene })),
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
