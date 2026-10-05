import { MAX_AUDIO_CHARS, TranscribeRequestSchema } from "@/lib/schemas";
import { createPostHandler } from "@/lib/server/handler";
import { requestsPerMinute } from "@/lib/server/rateLimit";
import { transcribeAudio } from "@/lib/server/transcribe";

export const maxDuration = 60;

/** Speech to text: turns a short spoken description into words for the text box. */
export const POST = createPostHandler({
  route: "api/transcribe",
  schema: TranscribeRequestSchema,
  rateLimit: { bucket: "transcribe", perMinute: requestsPerMinute },
  maxBodyChars: MAX_AUDIO_CHARS + 1_000,
  async run({ body, client, signal }) {
    // The words only go back into the text box here. They are screened by the
    // moderation check when the user presses "Build my prompt".
    const text = await transcribeAudio(client, body.audio, signal);
    return { text };
  },
});
