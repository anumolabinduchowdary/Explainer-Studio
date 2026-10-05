import { ImageRequestSchema, MAX_REFERENCE_CHARS } from "@/lib/story";
import { createPostHandler } from "@/lib/server/handler";
import { generatePicture } from "@/lib/server/images";
import { moderate } from "@/lib/server/openai";
import { imagesPerMinute } from "@/lib/server/rateLimit";

// Drawing a picture can take a minute or more.
export const maxDuration = 120;

/** Draws one picture for a cartoon story: a character, its talking pose or a background. */
export const POST = createPostHandler({
  route: "api/image",
  schema: ImageRequestSchema,
  rateLimit: { bucket: "images", perMinute: imagesPerMinute },
  deadlineMs: 110_000,
  maxBodyChars: MAX_REFERENCE_CHARS + 10_000,
  async run({ body, client, signal }) {
    // Descriptions are editable, so they are screened before anything is drawn.
    await moderate(client, [body.look, body.artStyle].filter(Boolean).join("\n"), signal);
    const image = await generatePicture(client, body, signal);
    return { image };
  },
});
