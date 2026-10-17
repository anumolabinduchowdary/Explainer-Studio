import { SpeechRequestSchema, VOICE_IDS } from "@/lib/story";
import { AppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { moderate } from "@/lib/server/openai";
import { speechPerMinute } from "@/lib/server/rateLimit";
import { isSarvamVoice } from "@/lib/sarvam";
import { sarvamSettings, speakWithSarvam } from "@/lib/server/sarvam";
import { generateSpeech } from "@/lib/server/speech";
import { speakWithSpeechgen, speechgenCredentials } from "@/lib/server/speechgen";
import { hearLine, speakAndCheck } from "@/lib/server/voiceCheck";

export const maxDuration = 60;

/** Speaks one line of a cartoon story in a character's voice. */
export const POST = createPostHandler({
  route: "api/speech",
  schema: SpeechRequestSchema,
  rateLimit: { bucket: "speech", perMinute: speechPerMinute },
  async run({ body, client, signal }) {
    // The voice says which service speaks it: Sarvam's Indian voices, SpeechGen's, or OpenAI's.
    const sarvam = isSarvamVoice(body.voice) ? sarvamSettings() : null;
    const speechgen = sarvam ? null : speechgenCredentials();
    // Lines are editable, so they are screened before they are spoken, whichever service speaks them.
    await moderate(client, [body.text, body.style ?? ""].filter(Boolean).join("\n"), signal);

    if (!sarvam && !speechgen && !(VOICE_IDS as readonly string[]).includes(body.voice)) {
      throw new AppError("voice_unavailable", 422);
    }
    const speak = (extraDirection?: string) => {
      const request = extraDirection
        ? { ...body, delivery: [body.delivery, extraDirection].filter(Boolean).join(". ").slice(0, 160) }
        : body;
      if (sarvam) return speakWithSarvam(sarvam, request, signal);
      return speechgen ? speakWithSpeechgen(speechgen, request, signal) : generateSpeech(client, request, signal);
    };
    // Every line is listened back, and recorded again if the words did not come out right.
    return speakAndCheck(speak, (audio) => hearLine(client, body.text, audio, body.language, signal));
  },
});
