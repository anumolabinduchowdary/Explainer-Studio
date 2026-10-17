import { createKeylessPostHandler } from "@/lib/server/handler";
import { openAiSpeaksWell } from "@/lib/languages";
import { GEMINI_VOICE_OPTIONS } from "@/lib/gemini";
import { sarvamSpeaks, sarvamVoicesFor } from "@/lib/sarvam";
import { geminiSettings } from "@/lib/server/gemini";
import { sarvamSettings } from "@/lib/server/sarvam";
import { catalogueHasLanguage, loadCatalogue, speechgenCredentials, voicesForLanguage } from "@/lib/server/speechgen";
import { OPENAI_VOICE_LIST, VoicesRequestSchema, type VoiceList } from "@/lib/voices";

export const maxDuration = 30;

/** The voices a story in a given language can use, from whichever voice service the server is set up with. */
export const POST = createKeylessPostHandler({
  route: "api/voices",
  schema: VoicesRequestSchema,
  deadlineMs: 25_000,
  async run({ body, signal }): Promise<VoiceList> {
    // Gemini's acted voices come first: they speak every language the app offers, with an Indian accent.
    if (geminiSettings()) return { provider: "gemini", voices: GEMINI_VOICE_OPTIONS, supported: true };
    // Then Sarvam's Indian voices, for every language they speak.
    if (sarvamSettings() && sarvamSpeaks(body.language)) {
      return { provider: "sarvam", voices: sarvamVoicesFor(body.language), supported: true };
    }
    if (!speechgenCredentials()) return { ...OPENAI_VOICE_LIST, supported: openAiSpeaksWell(body.language) };
    const catalogue = await loadCatalogue(signal);
    return {
      provider: "speechgen",
      voices: voicesForLanguage(catalogue, body.language),
      supported: !body.language.trim() || catalogueHasLanguage(catalogue, body.language),
    };
  },
});
