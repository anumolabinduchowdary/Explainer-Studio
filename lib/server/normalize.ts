import { HEALTH_DISCLAIMER } from "@/lib/config";
import { disclaimerFor, disclaimerIn, withoutDisclaimer } from "@/lib/disclaimer";
import {
  FiveStepPromptSchema,
  LIMITS,
  SceneSchema,
  StoryboardSchema,
  type BuildPromptResponse,
  type PromptBuildWire,
  type Scene,
  type SceneWire,
  type Storyboard,
  type StoryboardWire,
} from "@/lib/schemas";

/**
 * These functions turn the model's raw ("wire") answers into the validated
 * shapes the app uses. They throw (usually a ZodError) when an answer breaks
 * the rules, which makes the caller retry.
 */

export function normalizePromptBuild(
  wire: PromptBuildWire,
  options: { allowQuestions: boolean },
): BuildPromptResponse {
  const questions = wire.questions
    .map((q) => q.trim().slice(0, LIMITS.question))
    .filter(Boolean)
    .slice(0, 3);

  if (options.allowQuestions && wire.status === "needs_clarification" && questions.length > 0) {
    return { status: "needs_clarification", questions };
  }

  const prompt = FiveStepPromptSchema.parse({
    actAs: wire.actAs,
    goal: wire.goal,
    context: wire.context,
    constraints: wire.constraints,
    output: wire.output,
  });
  return { status: "ready", prompt };
}

export function normalizeScene(wire: SceneWire, fallbackId: string): Scene {
  const scene = SceneSchema.parse({
    ...wire,
    id: wire.id.trim() || fallbackId,
    bullets: wire.bullets
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, LIMITS.bullets),
  });
  if (!scene.heading) throw new Error("Scene heading is empty.");
  return scene;
}

export function hasDisclaimer(scene: Scene): boolean {
  return scene.body.toLowerCase().includes(HEALTH_DISCLAIMER.toLowerCase());
}

/**
 * Makes the scene's body end with the health disclaimer, exactly once. In a
 * video in another language that is the translation followed by the English.
 */
export function ensureDisclaimer(scene: Scene, disclaimer: string = HEALTH_DISCLAIMER): Scene {
  let rest = withoutDisclaimer(scene.body, [disclaimer]);
  const room = LIMITS.body - disclaimer.length - 1;
  if (rest.length > room) rest = `${rest.slice(0, room - 1).trimEnd()}…`;
  return { ...scene, body: rest ? `${rest} ${disclaimer}` : disclaimer };
}

export function normalizeStoryboard(wire: StoryboardWire): Storyboard {
  let scenes = wire.scenes.map((scene, i) => normalizeScene(scene, `s${i + 1}`));

  const ids = new Set(scenes.map((s) => s.id));
  if (ids.size !== scenes.length) {
    scenes = scenes.map((scene, i) => ({ ...scene, id: `s${i + 1}` }));
  }

  if (wire.isHealthTopic && scenes.length > 0) {
    const last = scenes.length - 1;
    scenes[last] = ensureDisclaimer(scenes[last], disclaimerFor(wire.language, wire.disclaimer));
  }

  return StoryboardSchema.parse({
    title: wire.title.trim() || "Untitled video",
    aspectRatio: wire.aspectRatio,
    scenes,
  });
}

/** A regenerated scene keeps its id, and its disclaimer (in the same languages) if the old one had it. */
export function normalizeRegeneratedScene(wire: SceneWire, previous: Scene): Scene {
  const scene = { ...normalizeScene(wire, previous.id), id: previous.id };
  return hasDisclaimer(previous) ? ensureDisclaimer(scene, disclaimerIn(previous.body)) : scene;
}
