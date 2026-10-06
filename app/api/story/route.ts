import { StoryFromPlanRequestSchema, StoryFromPlanWireSchema } from "@/lib/plan";
import { createPostHandler } from "@/lib/server/handler";
import { buildStoryFromPlan } from "@/lib/server/normalizePlan";
import { generateStructured, moderate } from "@/lib/server/openai";
import { STORY_INSTRUCTIONS, storyInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** Story plan -> cartoon story script. The cast and places come from the plan; the model writes the lines. */
export const POST = createPostHandler({
  route: "api/story",
  schema: StoryFromPlanRequestSchema,
  async run({ body, client, signal }) {
    const input = storyInput(body.plan);
    // The plan is edited by the user, so it is checked again before anything is written from it.
    await moderate(client, input, signal);

    const story = await generateStructured({
      client,
      name: "cartoon_story",
      instructions: STORY_INSTRUCTIONS,
      input,
      schema: StoryFromPlanWireSchema,
      refine: (wire) => buildStoryFromPlan(body.plan, wire),
      maxOutputTokens: 12000,
      signal,
    });
    return { story };
  },
});
