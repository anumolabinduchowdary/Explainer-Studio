import { StoryboardRequestSchema, StoryboardWireSchema } from "@/lib/schemas";
import { createPostHandler } from "@/lib/server/handler";
import { normalizeStoryboard } from "@/lib/server/normalize";
import { generateStructured, moderate } from "@/lib/server/openai";
import { STORYBOARD_INSTRUCTIONS, storyboardInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** 5-step prompt -> validated storyboard JSON. */
export const POST = createPostHandler({
  route: "api/storyboard",
  schema: StoryboardRequestSchema,
  async run({ body, client, signal }) {
    const input = storyboardInput(body.prompt);
    // The prompt is editable, so it is moderated again here.
    await moderate(client, input, signal);

    const storyboard = await generateStructured({
      client,
      name: "storyboard",
      instructions: STORYBOARD_INSTRUCTIONS,
      input,
      schema: StoryboardWireSchema,
      refine: normalizeStoryboard,
      maxOutputTokens: 12000,
      signal,
    });
    return { storyboard };
  },
});
