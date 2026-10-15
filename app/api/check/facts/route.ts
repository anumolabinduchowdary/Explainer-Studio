import { FactCheckRequestSchema, TRUSTED_SOURCES } from "@/lib/quality";
import { finishFactCheck, FactCheckWireSchema, prepareFactCheck } from "@/lib/server/factCheck";
import { createPostHandler } from "@/lib/server/handler";
import { generateStructured, moderate } from "@/lib/server/openai";
import { FACT_CHECK_INSTRUCTIONS, factCheckInput } from "@/lib/server/systemPrompts";

export const maxDuration = 60;

/** Checks a script's health facts and wording, fixes what needs fixing, and suggests where to learn more. */
export const POST = createPostHandler({
  route: "api/check/facts",
  schema: FactCheckRequestSchema,
  async run({ body, client, signal }) {
    const job = prepareFactCheck(body.texts);
    if (job.items.length === 0) return { texts: {}, changes: [], sources: [], checked: 0 };
    // Lines can be edited by hand, so they are screened like everything else.
    await moderate(client, job.items.map((item) => item.text).join("\n"), signal);
    return generateStructured({
      client,
      name: "fact_check",
      instructions: FACT_CHECK_INSTRUCTIONS,
      input: factCheckInput(body.kind, body.language, job.items, TRUSTED_SOURCES),
      schema: FactCheckWireSchema,
      refine: (wire) => finishFactCheck(job, wire),
      maxOutputTokens: 8000,
      signal,
    });
  },
});
