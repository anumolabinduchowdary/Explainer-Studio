import { createKeylessPostHandler } from "@/lib/server/handler";
import { openAiSpeaksWell } from "@/lib/languages";
import { catalogueHasLanguage, loadCatalogue, speechgenCredentials, voicesForLanguage } from "@/lib/server/speechgen";
import { OPENAI_VOICE_LIST, VoicesRequestSchema, type VoiceList } from "@/lib/voices";

export const maxDuration = 30;

/** The voices a story in a given language can use, from whichever voice service the server is set up with. */
export const POST = createKeylessPostHandler({
  route: "api/voices",
  schema: VoicesRequestSchema,
  deadlineMs: 25_000,
  async run({ body, signal }): Promise<VoiceList> {
    if (!speechgenCredentials()) return { ...OPENAI_VOICE_LIST, supported: openAiSpeaksWell(body.language) };
    const catalogue = await loadCatalogue(signal);
    return {
      provider: "speechgen",
      voices: voicesForLanguage(catalogue, body.language),
      supported: !body.language.trim() || catalogueHasLanguage(catalogue, body.language),
    };
  },
});
