import { assemblePrompt } from "@/lib/prompt";
import { SceneRequestSchema, SceneWireSchema } from "@/lib/schemas";
import { AppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { normalizeRegeneratedScene } from "@/lib/server/normalize";
import { generateStructured, moderate } from "@/lib/server/openai";
import { SCENE_INSTRUCTIONS, sceneInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** Regenerates a single scene of an existing storyboard. */
export const POST = createPostHandler({
  route: "api/scene",
  schema: SceneRequestSchema,
  async run({ body, client, signal }) {
    const { prompt, storyboard, sceneId, instruction } = body;
    const previous = storyboard.scenes.find((scene) => scene.id === sceneId);
    if (!previous) {
      throw new AppError("invalid_input", 400, { message: "That scene no longer exists." });
    }

    const sceneText = storyboard.scenes
      .flatMap((scene) => [scene.heading, scene.body, ...scene.bullets])
      .join("\n");
    await moderate(
      client,
      [assemblePrompt(prompt), sceneText, instruction ?? ""].filter(Boolean).join("\n\n"),
      signal,
    );

    const scene = await generateStructured({
      client,
      name: "scene",
      instructions: SCENE_INSTRUCTIONS,
      input: sceneInput(prompt, storyboard, sceneId, instruction),
      schema: SceneWireSchema,
      refine: (wire) => normalizeRegeneratedScene(wire, previous),
      maxOutputTokens: 4000,
      signal,
    });
    return { scene };
  },
});
