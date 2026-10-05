import { StoryboardRequestSchema } from "@/lib/schemas";
import { StoryWireSchema } from "@/lib/story";
import { createPostHandler } from "@/lib/server/handler";
import { normalizeStory } from "@/lib/server/normalizeStory";
import { generateStructured, moderate } from "@/lib/server/openai";
import { STORY_INSTRUCTIONS, storyboardInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** 5-step prompt -> cartoon story script (characters, places, scenes and lines). */
export const POST = createPostHandler({
  route: "api/story",
  schema: StoryboardRequestSchema,
  async run({ body, client, signal }) {
    const input = storyboardInput(body.prompt);
    await moderate(client, input, signal);

    const story = await generateStructured({
      client,
      name: "cartoon_story",
      instructions: STORY_INSTRUCTIONS,
      input,
      schema: StoryWireSchema,
      refine: normalizeStory,
      maxOutputTokens: 12000,
      signal,
    });
    return { story };
  },
});
