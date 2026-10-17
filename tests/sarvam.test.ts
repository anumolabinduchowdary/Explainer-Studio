import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SARVAM_VOICE_OPTIONS, isSarvamVoice, sarvamLanguage, sarvamSpeaks } from "@/lib/sarvam";
import { sarvamSettings, speakWithSarvam } from "@/lib/server/sarvam";
import { DEFAULT_ART_STYLE, StorySchema, VOICE_AGE_SETTINGS } from "@/lib/story";
import { OPENAI_VOICE_OPTIONS, castVoices } from "@/lib/voices";

const KEY = "sk_sarvam-SECRET-1234567890";
const SETTINGS = { key: KEY, baseUrl: "https://api.sarvam.ai" };
const MP3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);
const WAV = Buffer.from("RIFF$\u0000\u0000\u0000WAVEfmt ", "latin1");

beforeEach(() => {
  vi.stubEnv("SARVAM_API_KEY", "");
  vi.stubEnv("SARVAM_API_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeSarvam(reply: () => Response = () => Response.json({ request_id: "r1", audios: [MP3.toString("base64")] })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return reply();
    }),
  );
  return calls;
}

describe("switching Sarvam AI on", () => {
  it("is off without a key, and the key is only read from the server's settings", () => {
    expect(sarvamSettings()).toBeNull();
    vi.stubEnv("SARVAM_API_KEY", ` ${KEY} `);
    expect(sarvamSettings()).toEqual(SETTINGS);
    vi.stubEnv("SARVAM_API_URL", "http://127.0.0.1:4010/sarvam/");
    expect(sarvamSettings()?.baseUrl).toBe("http://127.0.0.1:4010/sarvam");
  });
});

describe("Sarvam's voices and languages", () => {
  it("lists all 37 Bulbul v3 voices, women's then men's, best first", () => {
    expect(SARVAM_VOICE_OPTIONS).toHaveLength(37);
    expect(new Set(SARVAM_VOICE_OPTIONS.map((voice) => voice.id)).size).toBe(37);
    expect(SARVAM_VOICE_OPTIONS.filter((voice) => voice.gender === "female")).toHaveLength(14);
    expect(SARVAM_VOICE_OPTIONS.filter((voice) => voice.gender === "male")).toHaveLength(23);
    expect(SARVAM_VOICE_OPTIONS.every((voice) => voice.age === "adult" && voice.id === voice.id.toLowerCase())).toBe(true);
    expect(SARVAM_VOICE_OPTIONS[0]).toMatchObject({ id: "ishita", label: "Ishita (female, recommended)" });
    expect(SARVAM_VOICE_OPTIONS.find((voice) => voice.gender === "male")?.id).toBe("shubh");
    // No Sarvam voice shares a name with an OpenAI voice, so the voice says which service speaks it.
    expect(OPENAI_VOICE_OPTIONS.some((voice) => isSarvamVoice(voice.id))).toBe(false);
    expect(isSarvamVoice("shubh") && !isSarvamVoice("marin")).toBe(true);
  });

  it("speaks Indian English and the ten Indian languages, by name or by script", () => {
    expect(sarvamLanguage("English", "Sita, we will bring you home.")).toBe("en-IN");
    expect(sarvamLanguage("", "Hello, Priya!")).toBe("en-IN");
    expect(sarvamLanguage("Original", "राम वन में रहते हैं।")).toBe("hi-IN");
    expect(sarvamLanguage("Hindi", "राम")).toBe("hi-IN");
    expect(sarvamLanguage("Marathi", "राम")).toBe("mr-IN");
    expect(sarvamLanguage("Telugu", "రాముడు")).toBe("te-IN");
    expect(sarvamLanguage(undefined, "రాముడు")).toBe("te-IN");
    expect(sarvamLanguage("Odia", "ରାମ")).toBe("od-IN");
    expect(sarvamLanguage("Hinglish", "Chalo, let's go!")).toBe("en-IN");
    expect(sarvamLanguage("French", "Bonjour")).toBeNull();
    for (const language of ["", "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia"]) {
      expect(sarvamSpeaks(language)).toBe(true);
    }
    expect(sarvamSpeaks("French")).toBe(false);
    expect(sarvamSpeaks("Spanish")).toBe(false);
  });

  it("recasts a story with Indian voices of the same gender, and back again", () => {
    const story = StorySchema.parse({
      title: "Ramayan",
      aspectRatio: "9:16",
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "sage",
      characters: [
        { id: "c1", name: "Rama", look: "x", size: "large", voice: "cedar", voiceAge: "adult", voiceStyle: "" },
        { id: "c2", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
        { id: "c3", name: "Lava", look: "x", size: "small", voice: "verse", voiceAge: "child", voiceStyle: "" },
      ],
      locations: [{ id: "l1", name: "Forest", look: "x" }],
      scenes: [{ id: "s1", locationId: "l1", onStage: ["c1", "c2", "c3"], lines: [{ speaker: "c1", text: "Hello." }] }],
    });
    const indian = castVoices(story, SARVAM_VOICE_OPTIONS);
    expect(indian.characters.map((character) => character.voice)).toEqual(["shubh", "ishita", "aditya"]);
    expect(indian.narratorVoice).toBe("priya");
    // A story in a language Sarvam does not speak goes back to OpenAI's voices, keeping each gender.
    const back = castVoices(indian, OPENAI_VOICE_OPTIONS);
    const gender = (id: string) => OPENAI_VOICE_OPTIONS.find((voice) => voice.id === id)?.gender;
    expect(back.characters.map((character) => gender(character.voice))).toEqual(["male", "female", "male"]);
    expect(gender(back.narratorVoice)).toBe("female");
  });
});

describe("speaking a line with Sarvam", () => {
  it("sends the key in a header, never in the address or body, and returns the audio", async () => {
    const calls = fakeSarvam();
    const audio = await speakWithSarvam(SETTINGS, { text: "Sita, we will bring you home.", voice: "shubh", language: "English" });
    expect(audio).toBe(`data:audio/mpeg;base64,${MP3.toString("base64")}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.sarvam.ai/text-to-speech", method: "POST" });
    expect(calls[0].headers["api-subscription-key"]).toBe(KEY);
    expect(calls[0].body).toEqual({
      text: "Sita, we will bring you home.",
      language_code: "en-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      pace: 1,
      speech_sample_rate: 24000,
      output_audio_codec: "mp3",
    });
    expect(calls[0].url).not.toContain(KEY);
    expect(JSON.stringify(calls[0].body)).not.toContain(KEY);
  });

  it("speaks a child's line a little slower, since the browser raises its pitch", async () => {
    const calls = fakeSarvam();
    await speakWithSarvam(SETTINGS, { text: "నమస్కారం", voice: "ishita", age: "child", language: "Telugu" });
    expect(calls[0].body).toMatchObject({ language_code: "te-IN", pace: VOICE_AGE_SETTINGS.child.pace });
  });

  it("labels a WAV reply as WAV", async () => {
    fakeSarvam(() => Response.json({ audios: [WAV.toString("base64")] }));
    expect(await speakWithSarvam(SETTINGS, { text: "Hi", voice: "shubh" })).toMatch(/^data:audio\/wav;base64,/);
  });

  it("refuses a language it does not speak without calling Sarvam", async () => {
    const calls = fakeSarvam();
    await expect(speakWithSarvam(SETTINGS, { text: "Bonjour", voice: "shubh", language: "French" })).rejects.toMatchObject({
      code: "voice_unavailable",
    });
    expect(calls).toHaveLength(0);
  });

  it("turns Sarvam's failures into plain errors that never repeat its message", async () => {
    const failing = (status: number, code: string, message = "secret upstream detail", headers: HeadersInit = {}) => () =>
      new Response(JSON.stringify({ error: { request_id: "x", code, message } }), { status, headers });
    const cases: Array<[() => Response, string]> = [
      [failing(403, "invalid_api_key_error"), "voice_key_invalid"],
      [failing(429, "insufficient_quota_error"), "voice_credit"],
      [failing(429, "rate_limit_exceeded_error", "slow down", { "retry-after": "7" }), "voice_busy"],
      [failing(400, "invalid_request_error", "Speaker xyz is not supported"), "voice_unavailable"],
      [failing(500, "internal_server_error"), "voice_busy"],
      [() => Response.json({ audios: ["bm90IGF1ZGlv"] }), "voice_busy"],
      [() => new Response("not json", { status: 200 }), "voice_busy"],
    ];
    for (const [reply, code] of cases) {
      fakeSarvam(reply);
      const error = await speakWithSarvam(SETTINGS, { text: "Hi", voice: "shubh" }).catch((err: unknown) => err);
      expect(error).toMatchObject({ code });
      expect(String((error as Error).message)).not.toMatch(/secret upstream detail|slow down/);
    }
    fakeSarvam(failing(403, "invalid_api_key_error"));
    await expect(speakWithSarvam(SETTINGS, { text: "Hi", voice: "shubh" })).rejects.toThrow(/SARVAM_API_KEY/);
    fakeSarvam(failing(429, "rate_limit_exceeded_error", "slow down", { "retry-after": "7" }));
    await expect(speakWithSarvam(SETTINGS, { text: "Hi", voice: "shubh" })).rejects.toMatchObject({ retryAfterSec: 7 });
  });

  it("survives a service that is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(speakWithSarvam(SETTINGS, { text: "Hi", voice: "shubh" })).rejects.toMatchObject({ code: "voice_busy" });
  });
});
