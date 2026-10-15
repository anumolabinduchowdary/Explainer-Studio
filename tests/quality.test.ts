import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { disclaimerFor } from "@/lib/disclaimer";
import {
  FactCheckRequestSchema,
  TRUSTED_SOURCES,
  VOICE_MATCH_THRESHOLD,
  mainScript,
  similarity,
} from "@/lib/quality";
import { finishFactCheck, prepareFactCheck } from "@/lib/server/factCheck";
import { imagePrompt } from "@/lib/server/images";
import type { OpenAIClient } from "@/lib/server/openai";
import { checkPicture } from "@/lib/server/pictureCheck";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { FACT_CHECK_INSTRUCTIONS, factCheckInput } from "@/lib/server/systemPrompts";
import { hearLine, speakAndCheck } from "@/lib/server/voiceCheck";
import { composeDetails } from "@/lib/server/youtube";
import { STORY_LIMITS } from "@/lib/story";

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("OPENAI_TEXT_MODEL", "test-text-model");
  vi.stubEnv("OPENAI_VISION_MODEL", "");
  vi.stubEnv("OPENAI_TRANSCRIBE_MODEL", "test-transcribe-model");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the fact check", () => {
  it("never sends the fixed disclaimer, and puts it back after a fix", () => {
    const job = prepareFactCheck({
      title: "Cerebral palsy",
      "s0.l0": "Therapy will cure cerebral palsy in weeks!",
      "s3.l2": disclaimerFor("Hindi"),
      "s3.b": `Speak to your doctor. ${HEALTH_DISCLAIMER}`,
    });
    expect(job.items.map((item) => item.id)).toEqual(["title", "s0.l0", "s3.b"]);
    expect(job.items.find((item) => item.id === "s3.b")?.text).toBe("Speak to your doctor.");
    expect(job.items.find((item) => item.id === "s0.l0")?.max).toBe(STORY_LIMITS.lineText);

    const result = finishFactCheck(job, {
      fixes: [
        { id: "s0.l0", fixed: "Therapy can help children with cerebral palsy move with more ease.", reason: "Therapy does not cure cerebral palsy." },
        { id: "s3.b", fixed: "Talk to a qualified doctor.", reason: "Clearer advice." },
        { id: "nowhere", fixed: "Invented", reason: "x" },
        { id: "title", fixed: "", reason: "empty fixes are ignored" },
      ],
      sources: ["iap", "who", "iap", "unicef", "nhs"],
    });
    expect(result.texts).toEqual({
      "s0.l0": "Therapy can help children with cerebral palsy move with more ease.",
      "s3.b": `Talk to a qualified doctor. ${HEALTH_DISCLAIMER}`,
    });
    expect(result.changes.map((change) => change.key)).toEqual(["s0.l0", "s3.b"]);
    expect(result.changes[0]).toMatchObject({ before: "Therapy will cure cerebral palsy in weeks!", reason: "Therapy does not cure cerebral palsy." });
    // At most three sources, only from the app's own list, each once.
    expect(result.sources).toEqual([
      { name: "Indian Academy of Pediatrics", url: "https://iapindia.org" },
      { name: "World Health Organization", url: "https://www.who.int" },
      { name: "UNICEF", url: "https://www.unicef.org" },
    ]);
    expect(result.checked).toBe(3);
  });

  it("asks for fixes that remove or soften, never new facts, and lists only trusted organisations", () => {
    expect(FACT_CHECK_INSTRUCTIONS).toContain("Never add new facts, numbers, names or sources.");
    const input = factCheckInput("story", "Hindi", [{ id: "s0.l0", text: "Hello", max: 160 }], TRUSTED_SOURCES);
    expect(input).toContain("in Hindi");
    expect(input).toContain("[s0.l0] (at most 160 characters)\nHello");
    expect(input).toContain("iap: Indian Academy of Pediatrics");
    expect(TRUSTED_SOURCES.every((source) => source.url.startsWith("https://"))).toBe(true);
    expect(FactCheckRequestSchema.safeParse({ kind: "story", language: "", texts: {} }).success).toBe(false);
  });

  it("runs as an API route, screened first, with a strict answer format", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-0000000000000000000000000000");
    const parse = vi.fn(async () => ({
      status: "completed",
      output: [],
      output_parsed: { fixes: [{ id: "s0.l0", fixed: "Exercise helps.", reason: "Overstated." }], sources: ["who"] },
    }));
    const moderate = vi.fn(async () => ({ results: [{ flagged: false }] }));
    vi.doMock("@/lib/server/openai", async (original) => ({
      ...(await original<typeof import("@/lib/server/openai")>()),
      createClient: () => ({ responses: { parse }, moderations: { create: moderate } }) as unknown as OpenAIClient,
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/check/facts/route");
    const res = await POST(
      new Request("http://localhost:3000/api/check/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "story", language: "English", texts: { "s0.l0": "Exercise cures everything." } }),
      }),
    );
    expect(await res.json()).toEqual({
      texts: { "s0.l0": "Exercise helps." },
      changes: [{ key: "s0.l0", before: "Exercise cures everything.", after: "Exercise helps.", reason: "Overstated." }],
      sources: [{ name: "World Health Organization", url: "https://www.who.int" }],
      checked: 1,
    });
    expect(moderate).toHaveBeenCalledTimes(1);
    const [params] = parse.mock.calls[0] as unknown as [{ text: { format: { name: string; strict: boolean } } }];
    expect(params.text.format).toMatchObject({ name: "fact_check", strict: true });
    vi.doUnmock("@/lib/server/openai");
  });
});

describe("listening back to a recorded line", () => {
  it("measures how alike the words are, in any script", () => {
    expect(similarity("Good morning, team!", "good morning team")).toBe(1);
    expect(similarity("नमस्ते दोस्तों", "नमस्ते दोस्तो")).toBeGreaterThan(0.85);
    expect(similarity("Ready to move today?", "completely different words")).toBeLessThan(VOICE_MATCH_THRESHOLD);
    expect(mainScript("నమస్కారం స్నేహితులారా")).toBe("Telugu");
    expect(mainScript("Hello there")).toBe("Latin");
  });

  it("keeps a clear line, and records an unclear one again, keeping the better", async () => {
    const speak = vi.fn(async (extra?: string) => (extra ? "second" : "first"));
    expect(await speakAndCheck(speak, async () => 0.95)).toEqual({ audio: "first", check: { result: "ok", score: 0.95, retried: false } });
    expect(speak).toHaveBeenCalledTimes(1);

    speak.mockClear();
    const scores = { first: 0.3, second: 0.9 } as Record<string, number>;
    const better = await speakAndCheck(speak, async (audio) => scores[audio]);
    expect(better).toEqual({ audio: "second", check: { result: "ok", score: 0.9, retried: true } });
    expect(speak.mock.calls[1][0]).toContain("Say every word clearly");

    const worse = await speakAndCheck(speak, async (audio) => (audio === "first" ? 0.4 : 0.2));
    expect(worse).toEqual({ audio: "first", check: { result: "unclear", score: 0.4, retried: true } });
    expect(await speakAndCheck(speak, async () => null)).toEqual({ audio: "first", check: { result: "skipped", retried: false } });
  });

  it("is skipped when speech-to-text is not set up, or writes another script", async () => {
    const create = vi.fn(async () => ({ text: "namaste doston" }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAIClient;
    const audio = `data:audio/mpeg;base64,${Buffer.from([1, 2, 3]).toString("base64")}`;
    expect(await hearLine(client, "नमस्ते दोस्तों", audio, "Hindi")).toBeNull();
    const params = (create.mock.calls[0] as unknown as [{ language?: string }])[0];
    expect(params.language).toBe("hi");
    create.mockResolvedValueOnce({ text: "नमस्ते दोस्तों" });
    expect(await hearLine(client, "नमस्ते दोस्तों", audio, "Hindi")).toBe(1);
    vi.stubEnv("OPENAI_TRANSCRIBE_MODEL", "");
    expect(await hearLine(client, "Hello", audio, undefined)).toBeNull();
  });
});

describe("checking a drawing", () => {
  it("shows the picture to the model with its description, and reads the answer", async () => {
    vi.stubEnv("OPENAI_VISION_MODEL", "test-vision-model");
    const parse = vi.fn(async () => ({
      status: "completed",
      output: [],
      output_parsed: { matches: false, problems: ["Give the wheelchair two large back wheels."] },
    }));
    const client = { responses: { parse } } as unknown as OpenAIClient;
    const image = "data:image/webp;base64,AAAA";
    expect(await checkPicture(client, { kind: "character", look: "A girl in a purple wheelchair.", image })).toEqual({
      matches: false,
      problems: ["Give the wheelchair two large back wheels."],
    });
    const [params] = parse.mock.calls[0] as unknown as [
      { model: string; input: Array<{ content: Array<{ type: string; image_url?: string; detail?: string; text?: string }> }> },
    ];
    expect(params.model).toBe("test-vision-model");
    expect(params.input[0].content).toEqual([
      { type: "input_text", text: 'Description:\n"""\nA girl in a purple wheelchair.\n"""' },
      { type: "input_image", image_url: image, detail: "low" },
    ]);
    // A "no" with nothing to fix cannot guide a redraw, so it counts as a match.
    parse.mockResolvedValueOnce({ status: "completed", output: [], output_parsed: { matches: false, problems: [] } });
    expect(await checkPicture(client, { kind: "background", look: "A park.", image })).toEqual({ matches: true, problems: [] });
  });

  it("draws exercise pictures clearly, and checks them as exercises", async () => {
    const prompt = imagePrompt({ kind: "exercise", look: "A boy on a mat lifting his hips", artStyle: "", aspectRatio: "9:16" });
    expect(prompt).toContain("instruction picture for a home exercise: A boy on a mat lifting his hips");
    expect(prompt).toContain("natural, safe posture");
    const parse = vi.fn(async () => ({ status: "completed", output: [], output_parsed: { matches: true, problems: [] } }));
    await checkPicture({ responses: { parse } } as unknown as OpenAIClient, { kind: "exercise", look: "x y z", image: "data:image/webp;base64,AAAA" });
    const [params] = parse.mock.calls[0] as unknown as [{ instructions: string }];
    expect(params.instructions).toContain("instruction picture made for a home exercise programme");
  });

  it("tells a redraw what to correct", () => {
    const request = { kind: "character" as const, look: "A girl in a purple wheelchair.", artStyle: "", aspectRatio: "9:16" as const };
    expect(imagePrompt(request)).not.toContain("last attempt");
    expect(imagePrompt({ ...request, fix: "Give the wheelchair two large back wheels." })).toContain(
      "Important, the last attempt got this wrong, so make sure: Give the wheelchair two large back wheels.",
    );
  });
});

describe("sources in the YouTube description", () => {
  it("lists trusted organisations under Learn more, and nothing else", () => {
    const details = composeDetails(
      { title: "T", summary: "S", points: [], hashtags: [], tags: [] },
      {
        fallbackTitle: "x",
        health: true,
        aiVoices: false,
        sources: [
          { name: "World Health Organization", url: "https://www.who.int" },
          { name: "A made-up site", url: "https://example.org/fake" },
        ],
      },
    );
    expect(details.description).toContain("Learn more:\nWorld Health Organization: https://www.who.int");
    expect(details.description).not.toContain("example.org");
  });
});
