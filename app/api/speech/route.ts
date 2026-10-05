import { SpeechRequestSchema } from "@/lib/story";
import { createPostHandler } from "@/lib/server/handler";
import { moderate } from "@/lib/server/openai";
import { speechPerMinute } from "@/lib/server/rateLimit";
import { generateSpeech } from "@/lib/server/speech";

export const maxDuration = 60;

/** Speaks one line of a cartoon story in a character's voice. */
export const POST = createPostHandler({
  route: "api/speech",
  schema: SpeechRequestSchema,
  rateLimit: { bucket: "speech", perMinute: speechPerMinute },
  async run({ body, client, signal }) {
    // Lines are editable, so they are screened before they are spoken.
    await moderate(client, [body.text, body.style ?? ""].filter(Boolean).join("\n"), signal);
    const audio = await generateSpeech(client, body, signal);
    return { audio };
  },
});
