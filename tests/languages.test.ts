import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sampleStory from "@/examples/cerebral-palsy.story.json";
import sampleStoryboard from "@/examples/cerebral-palsy.storyboard.json";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { VIDEO_LANGUAGES, languageLabel, openAiSpeaksWell } from "@/lib/languages";
import { BuildPromptRequestSchema, LIMITS, StoryboardSchema } from "@/lib/schemas";
import type { OpenAIClient } from "@/lib/server/openai";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { buildPromptInput, translateInput } from "@/lib/server/systemPrompts";
import { normalizeRegeneratedScene, normalizeStoryboard } from "@/lib/server/normalize";
import { finishTranslation, prepareTranslation } from "@/lib/server/translate";
import { disclaimerFor, disclaimerIn, disclaimerLines, withoutDisclaimer } from "@/lib/disclaimer";
import { STORY_LIMITS, StorySchema } from "@/lib/story";
import {
  TranslateRequestSchema,
  storyTexts,
  storyboardTexts,
  textLimit,
  withStoryTexts,
  withStoryboardTexts,
} from "@/lib/translate";

const story = StorySchema.parse(sampleStory);
const storyboard = StoryboardSchema.parse(sampleStoryboard);

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("OPENAI_TEXT_MODEL", "test-model");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-0000000000000000000000000000");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the language list", () => {
  it("names each language in its own script as well as in English", () => {
    expect(languageLabel("Hindi")).toBe("हिन्दी (Hindi)");
    expect(languageLabel("telugu")).toBe("తెలుగు (Telugu)");
    expect(languageLabel("English")).toBe("English");
    expect(languageLabel(" Swahili ")).toBe("Swahili");
    expect(new Set(VIDEO_LANGUAGES.map((language) => language.name)).size).toBe(VIDEO_LANGUAGES.length);
  });

  it("knows which languages OpenAI's voices speak well, from its documentation", () => {
    for (const language of ["English", "Hindi", "Tamil", "Kannada", "Marathi", "Urdu", "", "Indian English"]) {
      expect(openAiSpeaksWell(language)).toBe(true);
    }
    for (const language of ["Telugu", "Malayalam", "Bengali", "Gujarati", "Punjabi", "Odia"]) {
      expect(openAiSpeaksWell(language)).toBe(false);
    }
  });

  it("is passed to the AI when the person picks one", () => {
    const chosen = BuildPromptRequestSchema.parse({ description: "A video about tummy time for parents.", language: " Telugu " });
    expect(chosen.language).toBe("Telugu");
    const input = buildPromptInput(chosen);
    expect(input).toContain("The video must be in Telugu.");
    expect(buildPromptInput({ description: "A video about tummy time for parents." })).not.toContain("must be in");
    expect(BuildPromptRequestSchema.safeParse({ description: "A video about tummy time.", language: "x".repeat(61) }).success).toBe(false);
  });
});

describe("texts of a finished video", () => {
  it("lists a story's title and lines, and puts translations back in the same places", () => {
    const texts = storyTexts(story);
    expect(texts.title).toBe(story.title);
    expect(texts["s0.l0"]).toBe(story.scenes[0].lines[0].text);
    const lines = story.scenes.reduce((sum, scene) => sum + scene.lines.length, 0);
    expect(Object.keys(texts)).toHaveLength(lines + 1);

    const translated = withStoryTexts(story, { title: "सेरेब्रल पाल्सी", "s0.l0": "नमस्ते!" });
    expect(translated.title).toBe("सेरेब्रल पाल्सी");
    expect(translated.scenes[0].lines[0]).toMatchObject({ text: "नमस्ते!", speaker: story.scenes[0].lines[0].speaker });
    // Everything else, including the cast and places the pictures belong to, is untouched.
    expect(translated.scenes[0].lines[1]).toEqual(story.scenes[0].lines[1]);
    expect(translated.characters).toEqual(story.characters);
    expect(translated.locations).toEqual(story.locations);
    expect(StorySchema.safeParse(translated).success).toBe(true);
  });

  it("lists an explainer's headings, bodies and bullet points", () => {
    const texts = storyboardTexts(storyboard);
    const withBullets = storyboard.scenes.findIndex((scene) => scene.bullets.length > 0);
    expect(texts[`s${withBullets}.p0`]).toBe(storyboard.scenes[withBullets].bullets[0]);
    expect(texts["s0.h"]).toBe(storyboard.scenes[0].heading);
    const back = withStoryboardTexts(storyboard, { "s0.h": "शीर्षक", [`s${withBullets}.p0`]: "पहला" });
    expect(back.scenes[0].heading).toBe("शीर्षक");
    expect(back.scenes[withBullets].bullets[0]).toBe("पहला");
    expect(back.scenes[0].visual).toBe(storyboard.scenes[0].visual);
    expect(withStoryboardTexts(storyboard, storyboardTexts(storyboard))).toEqual(storyboard);
  });

  it("accepts only texts that belong somewhere, within size limits", () => {
    const ok = { language: "Hindi", kind: "story", texts: storyTexts(story) };
    expect(TranslateRequestSchema.safeParse(ok).success).toBe(true);
    expect(TranslateRequestSchema.safeParse({ ...ok, texts: { "__proto__x": "hi" } }).success).toBe(false);
    expect(TranslateRequestSchema.safeParse({ ...ok, texts: {} }).success).toBe(false);
    expect(TranslateRequestSchema.safeParse({ ...ok, language: "" }).success).toBe(false);
    expect(textLimit("s1.l3")).toBe(STORY_LIMITS.lineText);
    expect(textLimit("s1.b")).toBe(LIMITS.body);
    expect(textLimit("s1.p2")).toBe(LIMITS.bullet);
  });
});

describe("translating", () => {
  it("puts the disclaimer back in the new language, then in English", () => {
    const hindi = "जागरूकता के लिए, चिकित्सीय सलाह नहीं।";
    const job = prepareTranslation(
      { title: "Cerebral palsy", "s4.l3": HEALTH_DISCLAIMER, "s9.b": `Speak to your doctor. ${HEALTH_DISCLAIMER}` },
      "Hindi",
    );
    // The disclaimer is not sent: the app's own translation is used.
    expect(job.items.map((item) => [item.id, item.text])).toEqual([
      ["title", "Cerebral palsy"],
      ["s9.b", "Speak to your doctor."],
    ]);
    const texts = finishTranslation(job, {
      items: [
        { id: "title", text: "सेरेब्रल पाल्सी" },
        { id: "s9.b", text: "अपने डॉक्टर से बात करें।" },
      ],
    });
    expect(texts).toEqual({
      title: "सेरेब्रल पाल्सी",
      "s4.l3": `${hindi} ${HEALTH_DISCLAIMER}`,
      "s9.b": `अपने डॉक्टर से बात करें। ${hindi} ${HEALTH_DISCLAIMER}`,
    });
    expect(texts["s9.b"].length).toBeLessThanOrEqual(LIMITS.body);

    // Back to English: only the English sentence, the earlier translation removed.
    const back = prepareTranslation({ "s4.l3": `${hindi} ${HEALTH_DISCLAIMER}`, title: "सेरेब्रल पाल्सी" }, "English");
    expect(finishTranslation(back, { items: [{ id: "title", text: "Cerebral palsy" }] })).toEqual({
      title: "Cerebral palsy",
      "s4.l3": HEALTH_DISCLAIMER,
    });
  });

  it("asks the AI to translate the disclaimer for a language the app has no translation for", () => {
    const job = prepareTranslation({ title: "Playtime", "s1.l0": HEALTH_DISCLAIMER }, "Swahili");
    expect(job.items.map((item) => item.id)).toEqual(["title", "disclaimer"]);
    const texts = finishTranslation(job, {
      items: [
        { id: "title", text: "Wakati wa kucheza" },
        { id: "disclaimer", text: "Kwa uhamasishaji, si ushauri wa matibabu." },
      ],
    });
    expect(texts).toEqual({ title: "Wakati wa kucheza", "s1.l0": `Kwa uhamasishaji, si ushauri wa matibabu. ${HEALTH_DISCLAIMER}` });
  });

  it("asks again when an item is missing, and trims one that is too long", () => {
    const job = prepareTranslation({ "s0.l0": "Hello there, how are you today?" });
    expect(() => finishTranslation(job, { items: [] })).toThrow();
    expect(() => finishTranslation(job, { items: [{ id: "s0.l0", text: "  " }] })).toThrow();
    const long = finishTranslation(job, { items: [{ id: "s0.l0", text: "शब्द ".repeat(80) }] });
    expect(long["s0.l0"].length).toBeLessThanOrEqual(STORY_LIMITS.lineText);
  });

  it("tells the model each item's id and limit", () => {
    const input = translateInput("Tamil", [{ id: "s0.l0", text: "Hi!", max: 160 }]);
    expect(input).toContain("Translate into: Tamil");
    expect(input).toContain("[s0.l0] (at most 160 characters)\nHi!");
  });

  it("runs as an API route: moderated, strict schema, and the text comes back in place", async () => {
    const parse = vi.fn(async () => ({
      status: "completed",
      output: [],
      output_parsed: { items: [{ id: "title", text: "పిల్లల ఆట" }, { id: "s0.l0", text: "నమస్కారం!" }] },
    }));
    const moderate = vi.fn(async () => ({ results: [{ flagged: false }] }));
    vi.doMock("@/lib/server/openai", async (original) => ({
      ...(await original<typeof import("@/lib/server/openai")>()),
      createClient: () => ({ responses: { parse }, moderations: { create: moderate } }) as unknown as OpenAIClient,
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/translate/route");
    const res = await POST(
      new Request("http://localhost:3000/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "Telugu", kind: "story", texts: { title: "Playtime", "s0.l0": "Hello!", "s1.l0": HEALTH_DISCLAIMER } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      texts: { title: "పిల్లల ఆట", "s0.l0": "నమస్కారం!", "s1.l0": `అవగాహన కోసం, వైద్య సలహా కాదు. ${HEALTH_DISCLAIMER}` },
    });
    expect(moderate).toHaveBeenCalledTimes(1);
    const [params] = parse.mock.calls[0] as unknown as [{ input: string; text: { format: { name: string; strict: boolean } } }];
    expect(params.text.format).toMatchObject({ name: "translation", strict: true });
    expect(params.input).not.toContain(HEALTH_DISCLAIMER);
    vi.doUnmock("@/lib/server/openai");
  });
});

describe("the disclaimer in other languages", () => {
  it("comes in the video's language first, then in English", () => {
    expect(disclaimerLines("Hindi")).toEqual(["जागरूकता के लिए, चिकित्सीय सलाह नहीं।", HEALTH_DISCLAIMER]);
    expect(disclaimerFor("Telugu")).toBe(`అవగాహన కోసం, వైద్య సలహా కాదు. ${HEALTH_DISCLAIMER}`);
    expect(disclaimerLines("English")).toEqual([HEALTH_DISCLAIMER]);
    expect(disclaimerLines("")).toEqual([HEALTH_DISCLAIMER]);
    expect(disclaimerLines("Swahili")).toEqual([HEALTH_DISCLAIMER]);
    expect(disclaimerLines("Swahili", "Kwa uhamasishaji.")).toEqual(["Kwa uhamasishaji.", HEALTH_DISCLAIMER]);
    // The app's own translation wins over one the AI wrote.
    expect(disclaimerLines("Tamil", "something else")[0]).toBe("விழிப்புணர்வுக்காக, மருத்துவ ஆலோசனை அல்ல.");
    for (const language of VIDEO_LANGUAGES.filter((item) => item.name !== "English")) {
      expect(disclaimerLines(language.name)).toHaveLength(2);
    }
  });

  it("can be found in, and taken out of, a text", () => {
    const text = `Talk to a therapist. ${disclaimerFor("Kannada")}`;
    expect(withoutDisclaimer(text)).toBe("Talk to a therapist.");
    expect(disclaimerIn(text)).toBe(disclaimerFor("Kannada"));
    expect(disclaimerIn("No disclaimer here.")).toBe("");
  });

  it("ends new explainer videos in the video's language and English", () => {
    const wire = {
      title: "Tummy time",
      aspectRatio: "9:16" as const,
      isHealthTopic: true,
      language: "Marathi",
      disclaimer: "",
      specialParenting: false,
      scenes: [{ id: "s1", durationSec: 6, heading: "शीर्षक", body: `मजकूर. ${HEALTH_DISCLAIMER}`, bullets: [], visual: "family" as const, transition: "fade" as const }],
    };
    const board = normalizeStoryboard(wire);
    expect(board.scenes[0].body).toBe(`मजकूर. ${disclaimerFor("Marathi")}`);
    // A rewritten scene keeps the same two-language ending.
    const again = normalizeRegeneratedScene({ ...wire.scenes[0], body: "नवीन मजकूर." }, board.scenes[0]);
    expect(again.body).toBe(`नवीन मजकूर. ${disclaimerFor("Marathi")}`);
    expect(normalizeStoryboard({ ...wire, language: "Spanish", disclaimer: "Para concienciar, no es consejo médico." }).scenes[0].body).toBe(
      `मजकूर. Para concienciar, no es consejo médico. ${HEALTH_DISCLAIMER}`,
    );
    expect(normalizeStoryboard({ ...wire, language: "English" }).scenes[0].body).toBe(`मजकूर. ${HEALTH_DISCLAIMER}`);
  });
});

