import { TranslateRequestSchema } from "@/lib/translate";
import { createPostHandler } from "@/lib/server/handler";
import { generateStructured, moderate } from "@/lib/server/openai";
import { TRANSLATE_INSTRUCTIONS, translateInput } from "@/lib/server/systemPrompts";
import { TranslationWireSchema, finishTranslation, prepareTranslation } from "@/lib/server/translate";

export const maxDuration = 60;

/** The words of a finished video, in another language. Pictures and timing are untouched. */
export const POST = createPostHandler({
  route: "api/translate",
  schema: TranslateRequestSchema,
  async run({ body, client, signal }) {
    const job = prepareTranslation(body.texts, body.language);
    if (job.items.length === 0) return { texts: finishTranslation(job, { items: [] }) };
    // The words may have been edited by hand, so they are screened before anything is written from them.
    await moderate(client, [body.language, ...job.items.map((item) => item.text)].join("\n"), signal);

    const texts = await generateStructured({
      client,
      name: "translation",
      instructions: TRANSLATE_INSTRUCTIONS,
      input: translateInput(body.language, job.items),
      schema: TranslationWireSchema,
      refine: (wire) => finishTranslation(job, wire),
      maxOutputTokens: 16000,
      signal,
    });
    return { texts };
  },
});
