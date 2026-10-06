import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sampleStory from "@/examples/cerebral-palsy.story.json";
import { ERROR_COPY } from "@/lib/errors";
import {
  loadCatalogue,
  resetCatalogueCache,
  speakWithSpeechgen,
  speechgenCredentials,
  voicesForLanguage,
  type Catalogue,
} from "@/lib/server/speechgen";
import { StorySchema, VOICE_AGE_SETTINGS, type Story } from "@/lib/story";
import {
  OPENAI_VOICE_OPTIONS,
  VoicesResponseSchema,
  ageRate,
  castVoices,
  pickVoice,
  voiceMenu,
  type VoiceOption,
} from "@/lib/voices";

/** A small copy of SpeechGen's list, in its own format. */
const CATALOGUE: Catalogue = {
  "English US": [
    { voice: "Abigail", sex: "girl", type: "pro" },
    { voice: "Aldric", sex: "boy", type: "pro" },
    { voice: "Justin", sex: "boy", type: "base" },
    { voice: "Justin plus", sex: "boy", type: "pro" },
    { voice: "Blake", sex: "grandpa", type: "pro" },
    { voice: "Davis", sex: "male", type: "pro", styles: [{ value: "cheerful" }, { value: "sad" }] },
  ],
  "English (British)": [
    { voice: "Maisie", sex: "girl", type: "pro" },
    { voice: "Alfie", sex: "male", type: "pro" },
  ],
  "English (Indian)": [
    { voice: "Aditi", sex: "female", type: "base" },
    { voice: "Neerja", sex: "female", type: "pro", styles: [{ value: "cheerful" }, { value: "empathetic" }] },
    { voice: "Ananya", sex: "female", type: "pro" },
    { voice: "Prabhat", sex: "male", type: "pro" },
    { voice: "Rudra", sex: "male", type: "pro" },
  ],
  "Hindi (Indian)": [
    { voice: "Swara", sex: "female", type: "pro" },
    { voice: "Madhur", sex: "male", type: "pro" },
    { voice: "Aarav", sex: "male", type: "pro" },
  ],
  Telugu: [
    { voice: "Shruti", sex: "female", type: "pro" },
    { voice: "Mohan", sex: "male", type: "pro" },
  ],
  Spanish: [{ voice: "Elvira", sex: "female", type: "pro" }],
  "Mexican Spanish": [{ voice: "Dalia", sex: "female", type: "pro" }],
};

const ids = (voices: VoiceOption[]) => voices.map((voice) => voice.id);
const FAKE = { token: "tok-SECRET-1234567890", email: "owner@example.org" };

beforeEach(() => {
  resetCatalogueCache();
  vi.stubEnv("SPEECHGEN_API_TOKEN", "");
  vi.stubEnv("SPEECHGEN_EMAIL", "");
  vi.stubEnv("SPEECHGEN_API_URL", "");
  vi.stubEnv("SPEECHGEN_ACCENT", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("choosing the voice service", () => {
  it("uses OpenAI's voices unless SpeechGen is set up", () => {
    expect(speechgenCredentials()).toBeNull();
    vi.stubEnv("SPEECHGEN_API_TOKEN", FAKE.token);
    vi.stubEnv("SPEECHGEN_EMAIL", ` ${FAKE.email} `);
    expect(speechgenCredentials()).toEqual(FAKE);
  });

  it("reports half a setup by naming the missing setting, never the token", () => {
    vi.stubEnv("SPEECHGEN_API_TOKEN", FAKE.token);
    expect(() => speechgenCredentials()).toThrow(/SPEECHGEN_EMAIL/);
    expect(() => speechgenCredentials()).not.toThrow(new RegExp(FAKE.token));
    vi.stubEnv("SPEECHGEN_API_TOKEN", "");
    vi.stubEnv("SPEECHGEN_EMAIL", FAKE.email);
    expect(() => speechgenCredentials()).toThrow(/SPEECHGEN_API_TOKEN/);
  });

  it("has plain-language messages for every voice problem", () => {
    for (const code of ["voice_key_invalid", "voice_credit", "voice_unavailable", "voice_busy"] as const) {
      expect(ERROR_COPY[code].title.length).toBeGreaterThan(5);
    }
  });
});

describe("voices offered for a language", () => {
  it("offers the Indian accent of English first, then real children's and older voices", () => {
    const voices = voicesForLanguage(CATALOGUE, "English", "Indian");
    // Better-quality voices first; the Indian accent comes before any other.
    expect(ids(voices).slice(0, 5)).toEqual(["Neerja", "Ananya", "Prabhat", "Rudra", "Aditi"]);
    expect(voices.filter((voice) => voice.age === "child").map((voice) => voice.label)).toEqual([
      "Abigail (English US)",
      "Aldric (English US)",
      "Justin plus (English US)",
      "Justin (English US)",
      "Maisie (English (British))",
    ]);
    expect(voices.find((voice) => voice.id === "Blake")).toMatchObject({ gender: "male", age: "older" });
    // Adults of other accents are left out, to keep the menu short.
    expect(ids(voices)).not.toContain("Davis");
    expect(VoicesResponseSchema.safeParse({ provider: "speechgen", voices }).success).toBe(true);
  });

  it("matches languages however people write them", () => {
    expect(ids(voicesForLanguage(CATALOGUE, "Hindi", "Indian"))).toEqual(["Swara", "Madhur", "Aarav"]);
    expect(ids(voicesForLanguage(CATALOGUE, "simple telugu", "Indian"))).toEqual(["Shruti", "Mohan"]);
    expect(ids(voicesForLanguage(CATALOGUE, "British English", "Indian"))[0]).toBe("Maisie");
    expect(ids(voicesForLanguage(CATALOGUE, "American English", "Indian"))[0]).toBe("Abigail");
    expect(ids(voicesForLanguage(CATALOGUE, "Spanish", "Indian"))).toEqual(["Elvira"]);
  });

  it("falls back to English when the language is unknown or empty", () => {
    expect(ids(voicesForLanguage(CATALOGUE, "Klingon", "Indian"))[0]).toBe("Neerja");
    expect(ids(voicesForLanguage(CATALOGUE, "", "Indian"))[0]).toBe("Neerja");
  });

  it("follows the accent setting", () => {
    expect(ids(voicesForLanguage(CATALOGUE, "English", "British"))[0]).toBe("Maisie");
    vi.stubEnv("SPEECHGEN_ACCENT", "US");
    expect(ids(voicesForLanguage(CATALOGUE, "English"))[0]).toBe("Abigail");
  });
});

describe("casting", () => {
  const english = voicesForLanguage(CATALOGUE, "English", "Indian");
  const story = (characters: Array<[voice: string, age: Story["characters"][number]["voiceAge"]]>): Story => ({
    ...StorySchema.parse(sampleStory),
    narratorVoice: "alloy",
    characters: characters.map(([voice, voiceAge], i) => ({
      id: `c${i + 1}`,
      name: `Person ${i + 1}`,
      look: "A person.",
      size: "large",
      voice,
      voiceAge,
      voiceStyle: "",
    })),
  });

  it("gives children real children's voices and adults the story's accent", () => {
    // A physiotherapist (woman), two boys and two girls, as the story writer casts them.
    const cast = castVoices(
      story([
        ["sage", "adult"],
        ["verse", "child"],
        ["echo", "child"],
        ["coral", "child"],
        ["nova", "child"],
      ]),
      english,
    );
    expect(cast.characters.map((c) => c.voice)).toEqual(["Neerja", "Aldric", "Justin plus", "Abigail", "Maisie"]);
    // Everyone sounds different, and the narrator does not reuse a character's voice.
    const all = [cast.narratorVoice, ...cast.characters.map((c) => c.voice)];
    expect(new Set(all).size).toBe(all.length);
    expect(english.find((voice) => voice.id === cast.narratorVoice)?.age).toBe("adult");
  });

  it("falls back to an adult voice of the right gender when the children's voices run out", () => {
    const cast = castVoices(
      story([
        ["verse", "child"],
        ["echo", "child"],
        ["ash", "child"],
      ]),
      english,
    );
    // "Justin" and "Justin plus" are one voice, so the third boy gets a man's voice, pitched up later.
    expect(cast.characters.map((c) => c.voice)).toEqual(["Aldric", "Justin plus", "Prabhat"]);
  });

  it("uses adult voices where a language has no children's voices, and an older voice for a grandfather", () => {
    const hindi = castVoices(story([["coral", "child"], ["onyx", "adult"]]), voicesForLanguage(CATALOGUE, "Hindi", "Indian"));
    expect(hindi.characters.map((c) => c.voice)).toEqual(["Swara", "Madhur"]);
    expect(castVoices(story([["onyx", "older"]]), english).characters[0].voice).toBe("Blake");
  });

  it("leaves a story alone when its voices already belong to the list", () => {
    const openai = story([["sage", "adult"]]);
    expect(castVoices(openai, OPENAI_VOICE_OPTIONS)).toBe(openai);
    const once = castVoices(openai, english);
    expect(castVoices(once, english)).toBe(once);
    // A voice the user picked by hand is kept; only the others are recast.
    const mixed = { ...once, characters: [{ ...once.characters[0], voice: "Rudra" }], narratorVoice: "alloy" };
    const recast = castVoices(mixed, english);
    expect(recast.characters[0].voice).toBe("Rudra");
    expect(recast.narratorVoice).not.toBe("alloy");
  });

  it("only shifts the pitch of adult voices", () => {
    const child = english.find((voice) => voice.id === "Abigail");
    const adult = english.find((voice) => voice.id === "Neerja");
    expect(ageRate("child", child)).toBe(1);
    expect(ageRate("child", adult)).toBe(VOICE_AGE_SETTINGS.child.rate);
    expect(ageRate("older", english.find((voice) => voice.id === "Blake"))).toBe(1);
    expect(ageRate("teen", undefined)).toBe(VOICE_AGE_SETTINGS.teen.rate);
    expect(ageRate("adult", adult)).toBe(1);
  });

  it("sorts the menu into children, women, men and older voices", () => {
    expect(voiceMenu(english).map((group) => group.label)).toEqual([
      "Children's voices",
      "Women's voices",
      "Men's voices",
      "Older voices",
    ]);
    expect(voiceMenu(OPENAI_VOICE_OPTIONS).map((group) => group.label)).toEqual([
      "Women's voices",
      "Men's voices",
      "Neutral voices",
    ]);
    expect(pickVoice([], { gender: "female", age: "adult" })).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe("speaking a line with SpeechGen", () => {
  type Call = { url: string; method: string; fields: Record<string, string> };
  const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);

  function fakeService(replies: Array<Record<string, unknown>>, file: () => Response = () => new Response(MP3)) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const fields = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
      calls.push({ url, method: init?.method ?? "GET", fields });
      if (url.endsWith("api/voices")) return Response.json(CATALOGUE);
      if (url.includes("api/text") || url.includes("api/result")) return Response.json(replies.shift() ?? { status: -1 });
      return file();
    });
    vi.stubGlobal("fetch", fetchMock);
    return { calls, fetchMock };
  }
  const ready = { id: "42", status: 1, file: "https://files.speechgen.io/out/42.mp3", error: "" };

  it("sends the token in the body of a POST, never in the address, and returns the audio", async () => {
    const { calls } = fakeService([ready]);
    const audio = await speakWithSpeechgen(FAKE, { text: "Hello there!", voice: "Neerja", age: "adult" });
    expect(audio).toBe(`data:audio/mpeg;base64,${Buffer.from(MP3).toString("base64")}`);

    const speak = calls.find((call) => call.url.includes("api/text"));
    expect(speak?.url).toBe("https://speechgen.io/index.php?r=api/text");
    expect(speak?.method).toBe("POST");
    expect(speak?.fields).toEqual({
      token: FAKE.token,
      email: FAKE.email,
      voice: "Neerja",
      text: "Hello there!",
      format: "mp3",
      speed: "1.00",
    });
    for (const call of calls) expect(call.url).not.toContain(FAKE.token);
    // The public voice list is read without the account details.
    expect(calls.find((call) => call.url.endsWith("api/voices"))?.fields).toEqual({});
    expect(calls.at(-1)?.url).toBe(ready.file);
  });

  it("slows an adult voice that plays a child, but not a real child's voice", async () => {
    const { calls } = fakeService([ready, ready]);
    await speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja", age: "child" });
    await speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Abigail", age: "child" });
    const speeds = calls.filter((call) => call.url.includes("api/text")).map((call) => call.fields.speed);
    expect(speeds).toEqual([VOICE_AGE_SETTINGS.child.pace.toFixed(2), "1.00"]);
  });

  it("uses a speaking style only when the voice has it", async () => {
    const { calls } = fakeService([ready, ready]);
    await speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja", style: "Cheerful, quick and proud" });
    await speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Prabhat", style: "Cheerful, quick and proud" });
    const [withStyle, without] = calls.filter((call) => call.url.includes("api/text"));
    expect(withStyle.fields.style).toBe("cheerful");
    expect(without.fields).not.toHaveProperty("style");
  });

  it("refuses a voice SpeechGen does not have, without calling it", async () => {
    const { calls } = fakeService([ready]);
    await expect(speakWithSpeechgen(FAKE, { text: "Hi!", voice: "sage" })).rejects.toMatchObject({
      code: "voice_unavailable",
    });
    expect(calls.some((call) => call.url.includes("api/text"))).toBe(false);
  });

  it("waits for a line that is not ready at once", async () => {
    vi.useFakeTimers();
    try {
      const { calls } = fakeService([{ id: 7, status: 0 }, { id: 7, status: 0 }, ready]);
      const pending = speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja" });
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toContain("data:audio/mpeg;base64,");
      const polls = calls.filter((call) => call.url.includes("api/result"));
      expect(polls).toHaveLength(2);
      expect(polls[0].fields).toEqual({ token: FAKE.token, email: FAKE.email, id: "7" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns SpeechGen's failures into plain errors that never repeat its message", async () => {
    const cases: Array<[string, string]> = [
      ["Wrong token or email", "voice_key_invalid"],
      ["Not enough balance", "voice_credit"],
      ["Voice not found", "voice_unavailable"],
      ["Something else broke", "voice_busy"],
    ];
    for (const [error, code] of cases) {
      fakeService([{ status: -1, error: `${error} ${FAKE.token}` }]);
      const failure = await speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja" }).catch((err) => err);
      expect(failure).toMatchObject({ code });
      expect(String(failure.message)).not.toContain(FAKE.token);
      expect(String(failure.message)).not.toContain(error);
    }
  });

  it("only downloads the recording from a public HTTPS address", async () => {
    for (const file of ["http://files.speechgen.io/a.mp3", "https://localhost/a.mp3", "https://10.0.0.5/a.mp3", "file:///etc/passwd", "nonsense"]) {
      const { calls } = fakeService([{ ...ready, file }]);
      await expect(speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja" })).rejects.toMatchObject({
        code: "voice_busy",
      });
      expect(calls.some((call) => call.url === file)).toBe(false);
    }
  });

  it("rejects an empty recording and survives a service that is down", async () => {
    fakeService([ready], () => new Response(new Uint8Array()));
    await expect(speakWithSpeechgen(FAKE, { text: "Hi!", voice: "Neerja" })).rejects.toMatchObject({
      code: "bad_model_output",
    });

    resetCatalogueCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(loadCatalogue()).rejects.toMatchObject({ code: "voice_busy" });
  });

  it("keeps using the last voice list it read if a refresh fails", async () => {
    fakeService([]);
    const first = await loadCatalogue();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await loadCatalogue()).toBe(first);
  });
});
