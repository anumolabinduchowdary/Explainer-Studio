import { BuildPromptRequestSchema, PromptBuildWireSchema } from "@/lib/schemas";
import { createPostHandler } from "@/lib/server/handler";
import { normalizePromptBuild } from "@/lib/server/normalize";
import { generateStructured, moderate } from "@/lib/server/openai";
import {
  allowsQuestions,
  buildPromptInput,
  promptBuilderInstructions,
} from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** Description -> 5-step prompt, or up to 3 clarifying questions. */
export const POST = createPostHandler({
  route: "api/prompt",
  schema: BuildPromptRequestSchema,
  async run({ body, client, signal }) {
    const userText = [body.description, ...(body.answers ?? []).map((qa) => qa.answer)]
      .filter(Boolean)
      .join("\n");
    await moderate(client, userText, signal);

    const allowQuestions = allowsQuestions(body);
    return generateStructured({
      client,
      name: "five_step_prompt",
      instructions: promptBuilderInstructions(body.kind),
      input: buildPromptInput(body),
      schema: PromptBuildWireSchema,
      refine: (wire) => normalizePromptBuild(wire, { allowQuestions }),
      maxOutputTokens: 6000,
      signal,
    });
  },
});
