import { SpeechRequestSchema, VOICE_IDS } from "@/lib/story";
import { AppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { moderate } from "@/lib/server/openai";
import { speechPerMinute } from "@/lib/server/rateLimit";
import { generateSpeech } from "@/lib/server/speech";
import { speakWithSpeechgen, speechgenCredentials } from "@/lib/server/speechgen";

export const maxDuration = 60;

/** Speaks one line of a cartoon story in a character's voice. */
export const POST = createPostHandler({
  route: "api/speech",
  schema: SpeechRequestSchema,
  rateLimit: { bucket: "speech", perMinute: speechPerMinute },
  async run({ body, client, signal }) {
    const speechgen = speechgenCredentials();
    // Lines are editable, so they are screened before they are spoken, whichever service speaks them.
    await moderate(client, [body.text, body.style ?? ""].filter(Boolean).join("\n"), signal);

    if (speechgen) return { audio: await speakWithSpeechgen(speechgen, body, signal) };
    if (!(VOICE_IDS as readonly string[]).includes(body.voice)) throw new AppError("voice_unavailable", 422);
    return { audio: await generateSpeech(client, body, signal) };
  },
});
