import { z } from "zod";
import { languageCode } from "@/lib/languages";
import { AppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { generateStructured, moderate } from "@/lib/server/openai";
import { YOUTUBE_DETAILS_INSTRUCTIONS, youtubeDetailsInput } from "@/lib/server/systemPrompts";
import { composeDetails, youtubeConfig } from "@/lib/server/youtube";
import { DetailsRequestSchema } from "@/lib/youtube";

export const maxDuration = 60;

const DraftWireSchema = z.object({
  title: z.string(),
  summary: z.string(),
  points: z.array(z.string()),
  hashtags: z.array(z.string()),
  tags: z.array(z.string()),
});

/** Writes the YouTube title, description and tags for a finished video. */
export const POST = createPostHandler({
  route: "api/youtube/details",
  schema: DetailsRequestSchema,
  async run({ body, client, signal }) {
    if (!youtubeConfig()) {
      throw new AppError("invalid_input", 404, { message: "YouTube uploads are not switched on for this app." });
    }
    await moderate(client, `${body.title}\n${body.script}`, signal);
    const draft = await generateStructured({
      client,
      name: "youtube_details",
      instructions: YOUTUBE_DETAILS_INSTRUCTIONS,
      input: youtubeDetailsInput(body),
      schema: DraftWireSchema,
      refine: (wire) => {
        if (!wire.title.trim() || !wire.summary.trim()) throw new Error("The title or summary is empty.");
        return wire;
      },
      maxOutputTokens: 4000,
      signal,
    });
    const details = composeDetails(draft, {
      fallbackTitle: body.title,
      health: body.health,
      aiVoices: body.aiVoices,
      language: languageCode(body.language),
      languageName: body.language,
      sources: body.sources,
    });
    return { details };
  },
});
