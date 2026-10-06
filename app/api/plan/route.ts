import { PlanBuildWireSchema, PlanRequestSchema } from "@/lib/plan";
import { createPostHandler } from "@/lib/server/handler";
import { normalizePlanBuild } from "@/lib/server/normalizePlan";
import { generateStructured, moderate } from "@/lib/server/openai";
import { PLAN_INSTRUCTIONS, allowsQuestions, planInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** Description -> story plan (characters, places, message, details), or up to 3 clarifying questions. */
export const POST = createPostHandler({
  route: "api/plan",
  schema: PlanRequestSchema,
  async run({ body, client, signal }) {
    const userText = [body.description, ...(body.answers ?? []).map((qa) => qa.answer)]
      .filter(Boolean)
      .join("\n");
    await moderate(client, userText, signal);

    const allowQuestions = allowsQuestions(body);
    return generateStructured({
      client,
      name: "story_plan",
      instructions: PLAN_INSTRUCTIONS,
      input: planInput(body),
      schema: PlanBuildWireSchema,
      refine: (wire) => normalizePlanBuild(wire, { allowQuestions }),
      maxOutputTokens: 6000,
      signal,
    });
  },
});
