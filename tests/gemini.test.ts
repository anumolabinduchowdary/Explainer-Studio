import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEMINI_VOICE_OPTIONS, isGeminiVoice } from "@/lib/gemini";
import { geminiDirection, geminiSettings, speakWithGemini } from "@/lib/server/gemini";
import { AppError } from "@/lib/server/appError";
import { speakAndCheck } from "@/lib/server/voiceCheck";
import { DEFAULT_ART_STYLE, SpeechResponseSchema, StorySchema } from "@/lib/story";
import { OPENAI_VOICE_OPTIONS, castVoices } from "@/lib/voices";

const KEY = "test-gemini-key-SECRET-1234567890";
const SETTINGS = { key: KEY, model: "gemini-3.8-flash-tts", baseUrl: "https://generativelanguage.googleapis.com" };
const WAV = Buffer.concat([Buffer.from("RIFF$\u0000\u0000\u0000WAVEfmt ", "latin1"), Buffer.alloc(32)]);
const REPLY = { id: "i1", steps: [{ type: "model_output", content: [{ type: "audio", data: WAV.toString("base64") }] }] };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GEMINI_TTS_MODEL", "");
  vi.stubEnv("GEMINI_API_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeGemini(reply: () => Response = () => Response.json(REPLY)) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "{}")) });
      return reply();
    }),
  );
  return calls;
}

describe("switching Gemini on", () => {
  it("is off without a key; the model and address can be changed", () => {
    expect(geminiSettings()).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", ` ${KEY} `);
    expect(geminiSettings()).toEqual(SETTINGS);
    vi.stubEnv("GEMINI_TTS_MODEL", "gemini-2.5-pro-preview-tts");
    vi.stubEnv("GEMINI_API_URL", "http://127.0.0.1:4010/gemini/");
    expect(geminiSettings()).toEqual({ key: KEY, model: "gemini-2.5-pro-preview-tts", baseUrl: "http://127.0.0.1:4010/gemini" });
  });
});

describe("Gemini's voices", () => {
  it("lists the 30 voices, women's then men's, none sharing a name with another service", () => {
    expect(GEMINI_VOICE_OPTIONS).toHaveLength(30);
    expect(GEMINI_VOICE_OPTIONS.filter((voice) => voice.gender === "female")).toHaveLength(14);
    expect(GEMINI_VOICE_OPTIONS.filter((voice) => voice.gender === "male")).toHaveLength(16);
    expect(GEMINI_VOICE_OPTIONS[0]).toMatchObject({ id: "Sulafat", label: "Sulafat (female, warm)" });
    expect(OPENAI_VOICE_OPTIONS.some((voice) => isGeminiVoice(voice.id))).toBe(false);
  });

  it("casts each character with the Gemini voice closest to the writer's choice", () => {
    const story = StorySchema.parse({
      title: "రామాయణం",
      aspectRatio: "9:16",
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "marin",
      characters: [
        { id: "c1", name: "Rama", look: "x", size: "large", voice: "cedar", voiceAge: "adult", voiceStyle: "" },
        { id: "c2", name: "Sita", look: "x", size: "large", voice: "sage", voiceAge: "adult", voiceStyle: "" },
        { id: "c3", name: "Ravana", look: "x", size: "large", voice: "onyx", voiceAge: "adult", voiceStyle: "" },
        { id: "c4", name: "Hanuman", look: "x", size: "large", voice: "verse", voiceAge: "adult", voiceStyle: "" },
        { id: "c5", name: "Lava", look: "x", size: "small", voice: "nova", voiceAge: "child", voiceStyle: "" },
      ],
      locations: [{ id: "l1", name: "Forest", look: "x" }],
      scenes: [{ id: "s1", locationId: "l1", onStage: ["c1", "c2", "c3", "c4", "c5"], lines: [{ speaker: "c1", text: "సీతా" }] }],
    });
    const cast = castVoices(story, GEMINI_VOICE_OPTIONS);
    expect(cast.characters.map((character) => character.voice)).toEqual(["Algieba", "Vindemiatrix", "Algenib", "Puck", "Laomedeia"]);
    expect(cast.narratorVoice).toBe("Sulafat");
  });
});

describe("speaking a line with Gemini", () => {
  it("sends the key in a header, acts the line from a direction, and returns WAV audio", async () => {
    const calls = fakeGemini();
    const request = {
      text: "సీతమ్మా, భయపడకు తల్లీ.",
      voice: "Puck",
      age: "adult" as const,
      style: "devoted and reassuring",
      delivery: "warm, like a son to his mother",
      language: "Telugu",
    };
    const audio = await speakWithGemini(SETTINGS, request);
    expect(audio).toBe(`data:audio/wav;base64,${WAV.toString("base64")}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(calls[0].headers["x-goog-api-key"]).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    expect(JSON.stringify(calls[0].body)).not.toContain(KEY);
    expect(calls[0].body).toMatchObject({
      model: "gemini-3.8-flash-tts",
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: "Puck" }] },
    });
    const content = (calls[0].body.input as Array<{ content: Array<{ text: string; annotations: Array<{ style: string }> }> }>)[0].content[0];
    // The words are spoken exactly as written; the direction carries the manner, the line's note and the accent.
    expect(content.text).toBe(request.text);
    const style = content.annotations[0].style;
    expect(style).toBe(geminiDirection(request));
    expect(style).toContain("devoted and reassuring");
    expect(style).toContain("warm, like a son to his mother");
    expect(style).toContain("native speaker of Telugu from India");
  });

  it("hands the WAV recording to the browser like any other", () => {
    expect(SpeechResponseSchema.safeParse({ audio: `data:audio/wav;base64,${WAV.toString("base64")}` }).success).toBe(true);
    expect(SpeechResponseSchema.safeParse({ audio: "data:audio/mpeg;base64,AAAA" }).success).toBe(true);
    expect(SpeechResponseSchema.safeParse({ audio: "data:text/html;base64,AAAA" }).success).toBe(false);
  });

  it("asks for an Indian English accent for English lines", () => {
    expect(geminiDirection({ text: "Sita, we will bring you home.", voice: "Algieba", language: "English" })).toContain("Indian English accent");
  });

  it("turns Google's failures into plain errors that never repeat its message", async () => {
    const failing = (status: number, message: string, state = "") => () =>
      new Response(JSON.stringify({ error: { code: status, message, status: state } }), { status });
    const cases: Array<[() => Response, string]> = [
      [failing(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"), "voice_key_invalid"],
      [failing(403, "secret upstream detail", "PERMISSION_DENIED"), "voice_key_invalid"],
      [failing(429, "Rate limit exceeded (limit: 3 requests per minute). Please retry in 17s.", "RESOURCE_EXHAUSTED"), "voice_busy"],
      [failing(400, "Voice Nobody is not supported"), "voice_unavailable"],
      [failing(500, "secret upstream detail"), "voice_busy"],
      [() => Response.json({ steps: [] }), "voice_busy"],
      [() => Response.json({ steps: [{ content: [{ type: "audio", data: Buffer.from("not audio").toString("base64") }] }] }), "voice_busy"],
    ];
    for (const [reply, code] of cases) {
      fakeGemini(reply);
      const error = await speakWithGemini(SETTINGS, { text: "Hi", voice: "Puck" }).catch((err: unknown) => err);
      expect(error).toMatchObject({ code });
      expect(String((error as Error).message)).not.toMatch(/secret upstream detail|Please pass/);
    }
    fakeGemini(failing(400, "API key not valid.", "INVALID_ARGUMENT"));
    await expect(speakWithGemini(SETTINGS, { text: "Hi", voice: "Puck" })).rejects.toThrow(/GEMINI_API_KEY/);
    // Google says how long to wait; the app waits that long before trying again.
    fakeGemini(failing(429, "Please retry in 17s.", "RESOURCE_EXHAUSTED"));
    await expect(speakWithGemini(SETTINGS, { text: "Hi", voice: "Puck" })).rejects.toMatchObject({ retryAfterSec: 18 });
  });

  it("survives a service that is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(speakWithGemini(SETTINGS, { text: "Hi", voice: "Puck" })).rejects.toMatchObject({ code: "voice_busy" });
  });
});

describe("checking a line when the voice service is busy", () => {
  it("keeps the first take when the second cannot be recorded", async () => {
    let takes = 0;
    const result = await speakAndCheck(
      async () => {
        takes += 1;
        if (takes > 1) throw new Error("busy");
        return "data:audio/wav;base64,AAAA";
      },
      async () => 0.3,
    );
    expect(result).toEqual({ audio: "data:audio/wav;base64,AAAA", check: { result: "unclear", score: 0.3, retried: false } });
  });

  it("waits a short while when the service asks, then records the clearer take", async () => {
    let takes = 0;
    const scores = [0.3, 0.95];
    const result = await speakAndCheck(
      async () => {
        takes += 1;
        if (takes === 2) throw new AppError("voice_busy", 429, { retryAfterSec: 1 });
        return `data:audio/wav;base64,take${takes}`;
      },
      async () => scores.shift() ?? 0,
    );
    expect(takes).toBe(3);
    expect(result).toEqual({ audio: "data:audio/wav;base64,take3", check: { result: "ok", score: 0.95, retried: true } });
  });
});
