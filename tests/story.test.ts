import { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import sampleStory from "@/examples/cerebral-palsy.story.json";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { toAppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { generatePicture, imagePrompt } from "@/lib/server/images";
import { normalizeStory } from "@/lib/server/normalizeStory";
import type { OpenAIClient } from "@/lib/server/openai";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { generateSpeech, speechInstructions } from "@/lib/server/speech";
import {
  DEFAULT_ART_STYLE,
  ImageRequestSchema,
  NARRATOR,
  SCENE_LEAD_SEC,
  SpeechRequestSchema,
  StorySchema,
  StoryWireSchema,
  VOICES,
  VOICE_AGES,
  VOICE_AGE_SETTINGS,
  VOICE_GROUPS,
  VOICE_IDS,
  captionChunks,
  clipKey,
  estimateLine,
  lineDuration,
  lineStarts,
  lineVoice,
  locateStory,
  sceneDuration,
  storyDuration,
  type ImageRequest,
  type StoryWire,
  type TimeLine,
} from "@/lib/story";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("OPENAI_IMAGE_MODEL", "test-image-model");
  vi.stubEnv("OPENAI_IMAGE_EDIT_MODEL", "");
  vi.stubEnv("OPENAI_IMAGE_QUALITY", "");
  vi.stubEnv("OPENAI_SPEECH_MODEL", "test-speech-model");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("example story", () => {
  const story = StorySchema.parse(sampleStory);

  it("is valid and ends with the health disclaimer", () => {
    expect(story.characters).toHaveLength(3);
    expect(story.locations).toHaveLength(3);
    const lastLine = story.scenes.at(-1)?.lines.at(-1);
    expect(lastLine).toEqual({ speaker: NARRATOR, text: HEALTH_DISCLAIMER });
  });

  it("only refers to characters and places that exist, and speakers are on screen", () => {
    const characters = new Set(story.characters.map((c) => c.id));
    const places = new Set(story.locations.map((l) => l.id));
    for (const scene of story.scenes) {
      expect(places.has(scene.locationId)).toBe(true);
      for (const id of scene.onStage) expect(characters.has(id)).toBe(true);
      for (const line of scene.lines) {
        if (line.speaker !== NARRATOR) expect(scene.onStage).toContain(line.speaker);
      }
    }
  });

  it("runs for roughly the length asked for", () => {
    const seconds = storyDuration(story);
    expect(seconds).toBeGreaterThan(40);
    expect(seconds).toBeLessThan(70);
  });
});

describe("timing", () => {
  const story = StorySchema.parse(sampleStory);

  it("gives every line time to be read", () => {
    expect(lineDuration("Hi")).toBe(1.4);
    expect(lineDuration("one two three four five six seven eight nine ten eleven twelve thirteen")).toBeCloseTo(5.45, 2);
  });

  it("finds the scene and line for a moment in time", () => {
    expect(locateStory(story, 0)).toMatchObject({ sceneIndex: 0, lineIndex: -1 });
    expect(locateStory(story, SCENE_LEAD_SEC + 0.1)).toMatchObject({ sceneIndex: 0, lineIndex: 0 });
    const secondScene = sceneDuration(story.scenes[0]) + SCENE_LEAD_SEC + 0.1;
    expect(locateStory(story, secondScene)).toMatchObject({ sceneIndex: 1, lineIndex: 0 });
    const end = locateStory(story, 9999);
    expect(end.sceneIndex).toBe(story.scenes.length - 1);
    expect(end.lineIndex).toBe(story.scenes.at(-1)!.lines.length - 1);
  });

  it("breaks a line into short caption chunks that keep every word", () => {
    const text = "It is nobody's fault, and it is not contagious.";
    const chunks = captionChunks(text);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
    expect(chunks.reduce((sum, c) => sum + c.words, 0)).toBe(9);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(16);
    expect(captionChunks("   ")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

const wire = (overrides: Partial<StoryWire> = {}): StoryWire => ({
  title: "A story",
  aspectRatio: "9:16",
  artStyle: "",
  narratorVoice: "alloy",
  isHealthTopic: false,
  characters: [
    { id: "doc", name: "Dr. Asha", look: "A friendly doctor.", size: "large", voice: "sage", voiceAge: "adult", voiceStyle: "calm" },
    { id: "kid", name: "Aarav", look: "A cheerful boy.", size: "small", voice: "verse", voiceAge: "child", voiceStyle: "proud" },
  ],
  locations: [{ id: "clinic", name: "Clinic", look: "A bright clinic room." }],
  scenes: [
    {
      id: "one",
      locationId: "clinic",
      onStage: ["doc"],
      lines: [
        { speaker: "doc", text: "Hello!" },
        { speaker: "kid", text: "Hi!" },
        { speaker: "stranger", text: "Who am I?" },
        { speaker: "narrator", text: "  " },
      ],
    },
  ],
  ...overrides,
});

describe("normalizeStory", () => {
  it("tidies ids, fixes references and puts every speaker on screen", () => {
    const story = normalizeStory(wire({ scenes: [{ ...wire().scenes[0], locationId: "nowhere" }] }));
    expect(story.characters.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(story.locations[0].id).toBe("l1");
    const [scene] = story.scenes;
    expect(scene.id).toBe("s1");
    expect(scene.locationId).toBe("l1");
    expect(scene.onStage).toEqual(["c1", "c2"]);
    expect(scene.lines).toEqual([
      { speaker: "c1", text: "Hello!" },
      { speaker: "c2", text: "Hi!" },
      { speaker: NARRATOR, text: "Who am I?" },
    ]);
    expect(story.artStyle).toBe(DEFAULT_ART_STYLE);
    expect(story.narratorVoice).toBe("alloy");
    expect(story.characters.map((c) => [c.voice, c.voiceAge, c.voiceStyle])).toEqual([
      ["sage", "adult", "calm"],
      ["verse", "child", "proud"],
    ]);
  });

  it("keeps at most five characters on screen and hands extra lines to the narrator", () => {
    const characters = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      id,
      name: id,
      look: `Character ${id}`,
      size: "large" as const,
      voice: "alloy" as const,
      voiceAge: "adult" as const,
      voiceStyle: "",
    }));
    const story = normalizeStory(
      wire({
        characters,
        scenes: [
          {
            id: "s",
            locationId: "clinic",
            onStage: characters.map((c) => c.id),
            lines: characters.map((c) => ({ speaker: c.id, text: `I am ${c.id}` })),
          },
        ],
      }),
    );
    expect(story.characters).toHaveLength(6);
    expect(story.scenes[0].onStage).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(story.scenes[0].lines.at(-1)).toEqual({ speaker: NARRATOR, text: "I am f" });
  });

  it("ends a health story with the disclaimer, exactly once, spoken by the narrator", () => {
    const story = normalizeStory(
      wire({
        isHealthTopic: true,
        scenes: [
          {
            id: "s",
            locationId: "clinic",
            onStage: ["doc"],
            lines: [
              { speaker: "doc", text: `Take care. ${HEALTH_DISCLAIMER.toLowerCase()}` },
              { speaker: "doc", text: HEALTH_DISCLAIMER },
            ],
          },
        ],
      }),
    );
    const lines = story.scenes[0].lines;
    expect(lines).toEqual([
      { speaker: "c1", text: "Take care." },
      { speaker: NARRATOR, text: HEALTH_DISCLAIMER },
    ]);
  });

  it("does not add the disclaimer to other stories", () => {
    const text = JSON.stringify(normalizeStory(wire()));
    expect(text).not.toContain(HEALTH_DISCLAIMER);
  });

  it("rejects stories with no characters, no places or no lines", () => {
    expect(() => normalizeStory(wire({ characters: [] }))).toThrow();
    expect(() => normalizeStory(wire({ locations: [] }))).toThrow();
    expect(() => normalizeStory(wire({ scenes: [] }))).toThrow();
    expect(() =>
      normalizeStory(wire({ scenes: [{ id: "s", locationId: "clinic", onStage: [], lines: [{ speaker: "doc", text: " " }] }] })),
    ).toThrow();
  });

  it("converts to strict JSON Schema for Structured Outputs", () => {
    const format = zodTextFormat(StoryWireSchema, "cartoon_story");
    expect(format.strict).toBe(true);
    const schema = format.schema as { required: string[]; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(
      ["artStyle", "aspectRatio", "characters", "isHealthTopic", "locations", "narratorVoice", "scenes", "title"].sort(),
    );
  });
});

/* ------------------------------------------------------------------ */

const request = (overrides: Partial<ImageRequest> = {}): ImageRequest => ({
  kind: "character",
  look: "A cheerful boy with a blue walker.",
  artStyle: "flat cartoon",
  aspectRatio: "9:16",
  ...overrides,
});

function fakeImages(result: unknown = { data: [{ b64_json: "QUJD" }] }) {
  const generate = vi.fn(async () => result);
  const edit = vi.fn(async () => result);
  const moderations = { create: vi.fn(async () => ({ results: [{ flagged: false }] })) };
  const client = { images: { generate, edit }, moderations } as unknown as OpenAIClient;
  return { client, generate, edit };
}

const firstCall = (mock: ReturnType<typeof vi.fn>) =>
  (mock.mock.calls[0] as unknown as [Record<string, unknown>])[0];

describe("picture requests", () => {
  it("needs a reference picture for the talking pose", () => {
    expect(ImageRequestSchema.safeParse(request()).success).toBe(true);
    expect(ImageRequestSchema.safeParse(request({ kind: "talking" })).success).toBe(false);
    expect(ImageRequestSchema.safeParse(request({ kind: "talking", reference: PNG })).success).toBe(true);
    expect(
      ImageRequestSchema.safeParse(request({ kind: "talking", reference: "https://example.org/a.png" })).success,
    ).toBe(false);
    expect(ImageRequestSchema.safeParse(request({ look: " " })).success).toBe(false);
  });

  it("writes prompts that carry the description and the shared style", () => {
    const character = imagePrompt(request());
    expect(character).toContain("A cheerful boy with a blue walker.");
    expect(character).toContain("flat cartoon");
    expect(character).toContain("Transparent background");
    const background = imagePrompt(request({ kind: "background", look: "A sunny park." }));
    expect(background).toContain("A sunny park.");
    expect(background).toContain("no people");
    expect(imagePrompt(request({ artStyle: "" }))).toContain(DEFAULT_ART_STYLE);
  });

  it("draws characters as tall, transparent WebP cut-outs", async () => {
    const { client, generate, edit } = fakeImages();
    await expect(generatePicture(client, request())).resolves.toBe("data:image/webp;base64,QUJD");
    expect(edit).not.toHaveBeenCalled();
    const params = firstCall(generate);
    expect(params).toMatchObject({
      model: "test-image-model",
      size: "1024x1536",
      background: "transparent",
      output_format: "webp",
      n: 1,
    });
    expect(params).not.toHaveProperty("quality");
  });

  it("draws backgrounds opaque, in the shape of the video", async () => {
    vi.stubEnv("OPENAI_IMAGE_QUALITY", "low");
    const { client, generate } = fakeImages();
    await generatePicture(client, request({ kind: "background", aspectRatio: "16:9" }));
    expect(firstCall(generate)).toMatchObject({ size: "1536x1024", background: "opaque", quality: "low" });
  });

  it("redraws the talking pose from the reference picture, with the edit model if one is set", async () => {
    vi.stubEnv("OPENAI_IMAGE_EDIT_MODEL", "test-edit-model");
    const { client, generate, edit } = fakeImages();
    await generatePicture(client, request({ kind: "talking", reference: PNG }));
    expect(generate).not.toHaveBeenCalled();
    const params = firstCall(edit);
    expect(params).toMatchObject({ model: "test-edit-model", background: "transparent", size: "1024x1536" });
    expect(params.image).toBeInstanceOf(File);
    expect((params.image as File).type).toBe("image/png");
  });

  it("fails clearly when the image model is not set or returns nothing", async () => {
    const empty = fakeImages({ data: [] });
    await expect(generatePicture(empty.client, request())).rejects.toMatchObject({ code: "bad_model_output" });

    vi.stubEnv("OPENAI_IMAGE_MODEL", "");
    const { client, generate } = fakeImages();
    await expect(generatePicture(client, request())).rejects.toMatchObject({
      code: "server_misconfigured",
      message: expect.stringContaining("OPENAI_IMAGE_MODEL"),
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("treats a picture refused by OpenAI's content rules as a moderation block", () => {
    const blocked = APIError.generate(400, { error: { code: "moderation_blocked" } }, "blocked", new Headers());
    expect(toAppError(blocked)).toMatchObject({ code: "moderation_flagged", status: 422 });
  });
});

describe("rate limits", () => {
  it("counts pictures separately from text requests", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-0000000000000000000000000000");
    const { client } = fakeImages();
    const make = (bucket?: string) =>
      createPostHandler({
        route: "test",
        schema: z.object({}),
        run: async () => ({ ok: true }),
        clientFactory: () => client,
        ...(bucket ? { rateLimit: { bucket, perMinute: () => 1 } } : {}),
      });
    const post = (handler: (req: Request) => Promise<Response>) =>
      handler(new Request("http://localhost/api/test", { method: "POST", body: "{}" }));

    const images = make("images");
    const text = make();
    expect((await post(images)).status).toBe(200);
    expect((await post(images)).status).toBe(429);
    // The text allowance is untouched by picture requests.
    expect((await post(text)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */

describe("voices", () => {
  const story = StorySchema.parse(sampleStory);
  const [firstScene] = story.scenes;

  it("gives every character in the example a voice from OpenAI's list", () => {
    expect(VOICE_IDS).toContain(story.narratorVoice);
    for (const character of story.characters) expect(VOICE_IDS).toContain(character.voice);
    expect(new Set([story.narratorVoice, ...story.characters.map((c) => c.voice)]).size).toBe(4);
  });

  it("picks the voice by who is speaking", () => {
    expect(lineVoice(story, firstScene.lines[0])).toMatchObject({ voice: story.narratorVoice, age: "adult" });
    const meera = story.characters[1];
    expect(lineVoice(story, firstScene.lines[1])).toEqual({
      voice: meera.voice,
      age: meera.voiceAge,
      style: meera.voiceStyle,
    });
  });

  it("keeps a clip when a line moves, and asks for a new one when the words or voice change", () => {
    const line = firstScene.lines[1];
    const key = clipKey(story, line);
    expect(clipKey(story, { ...line })).toBe(key);
    expect(clipKey(story, { ...line, text: "Something else" })).not.toBe(key);
    const revoiced = {
      ...story,
      characters: story.characters.map((c) => (c.id === line.speaker ? { ...c, voice: "nova" as const } : c)),
    };
    expect(clipKey(revoiced, line)).not.toBe(key);
    const aged = {
      ...story,
      characters: story.characters.map((c) => (c.id === line.speaker ? { ...c, voiceAge: "older" as const } : c)),
    };
    expect(clipKey(aged, line)).not.toBe(key);
  });

  it("offers every age, grouped voices for women and men, and a child in the example", () => {
    expect(Object.keys(VOICE_AGE_SETTINGS)).toEqual([...VOICE_AGES]);
    // A child is pitched up, an older person down, an adult left alone.
    expect(VOICE_AGE_SETTINGS.child.rate).toBeGreaterThan(VOICE_AGE_SETTINGS.teen.rate);
    expect(VOICE_AGE_SETTINGS.teen.rate).toBeGreaterThan(1);
    expect(VOICE_AGE_SETTINGS.adult.rate).toBe(1);
    expect(VOICE_AGE_SETTINGS.older.rate).toBeLessThan(1);
    for (const group of ["women", "men"]) {
      expect(VOICES.filter((voice) => voice.group === group).length).toBeGreaterThanOrEqual(5);
    }
    expect(VOICES.every((voice) => VOICE_GROUPS.some((group) => group.id === voice.group))).toBe(true);
    expect(story.characters.map((c) => c.voiceAge)).toEqual(["adult", "adult", "child"]);
  });

  it("asks the voice to act the character's age", () => {
    expect(speechInstructions("proud", "child")).toContain("young child");
    expect(speechInstructions("gentle", "older")).toContain("elderly");
    expect(speechInstructions("calm", "adult")).not.toMatch(/child|elderly|teenager/);
    expect(SpeechRequestSchema.safeParse({ text: "Hi", voice: "sage", age: "child" }).success).toBe(true);
    expect(SpeechRequestSchema.safeParse({ text: "Hi", voice: "sage", age: "baby" }).success).toBe(false);
  });

  it("uses real clip lengths for timing once they exist", () => {
    const fixed: TimeLine = () => ({ duration: 2, speechStart: 0.1, speechEnd: 1.6 });
    const lines = story.scenes.reduce((sum, scene) => sum + scene.lines.length, 0);
    expect(storyDuration(story, fixed)).toBeCloseTo(story.scenes.length * SCENE_LEAD_SEC + lines * 2, 5);
    expect(storyDuration(story, estimateLine)).toBe(storyDuration(story));

    const starts = lineStarts(story, fixed);
    expect(starts).toHaveLength(lines);
    expect(starts[0].at).toBe(SCENE_LEAD_SEC);
    expect(starts[1].at).toBe(SCENE_LEAD_SEC + 2);
    expect(starts[firstScene.lines.length].at).toBeCloseTo(2 * SCENE_LEAD_SEC + firstScene.lines.length * 2, 5);

    expect(locateStory(story, SCENE_LEAD_SEC + 2.5, fixed)).toMatchObject({ sceneIndex: 0, lineIndex: 1 });
  });

  it("validates speech requests", () => {
    expect(SpeechRequestSchema.safeParse({ text: "Hello!", voice: "sage" }).success).toBe(true);
    expect(SpeechRequestSchema.safeParse({ text: "  ", voice: "sage" }).success).toBe(false);
    // Voice names depend on the voice service, so the server checks them when the line is spoken.
    expect(SpeechRequestSchema.safeParse({ text: "Hello!", voice: "Neerja" }).success).toBe(true);
    expect(SpeechRequestSchema.safeParse({ text: "Hello!", voice: "" }).success).toBe(false);
    expect(SpeechRequestSchema.safeParse({ text: "Hello!", voice: "x".repeat(81) }).success).toBe(false);
  });

  function fakeSpeech(bytes = new Uint8Array([1, 2, 3])) {
    const create = vi.fn(async () => new Response(bytes));
    const client = { audio: { speech: { create } } } as unknown as OpenAIClient;
    return { client, create };
  }

  it("speaks a line as MP3 in the chosen voice and manner", async () => {
    const { client, create } = fakeSpeech();
    const audio = await generateSpeech(client, {
      text: "Hello!",
      voice: "verse",
      style: "a cheerful boy",
      age: "child",
    });
    expect(audio).toBe("data:audio/mpeg;base64,AQID");
    const params = firstCall(create);
    expect(params).toMatchObject({
      model: "test-speech-model",
      voice: "verse",
      input: "Hello!",
      response_format: "mp3",
    });
    expect(params.instructions).toContain("a cheerful boy");
    expect(params.instructions).toContain("young child");
    expect(speechInstructions(undefined)).not.toContain("sounds like this");
  });

  it("leaves out instructions for the older models that cannot take them", async () => {
    vi.stubEnv("OPENAI_SPEECH_MODEL", "tts-1-hd");
    const { client, create } = fakeSpeech();
    await generateSpeech(client, { text: "Hello!", voice: "sage", style: "calm" });
    expect(firstCall(create)).not.toHaveProperty("instructions");
  });

  it("fails clearly when the speech model is not set or returns nothing", async () => {
    const silent = fakeSpeech(new Uint8Array());
    await expect(generateSpeech(silent.client, { text: "Hello!", voice: "sage" })).rejects.toMatchObject({
      code: "bad_model_output",
    });
    vi.stubEnv("OPENAI_SPEECH_MODEL", "");
    const { client, create } = fakeSpeech();
    await expect(generateSpeech(client, { text: "Hello!", voice: "sage" })).rejects.toMatchObject({
      code: "server_misconfigured",
      message: expect.stringContaining("OPENAI_SPEECH_MODEL"),
    });
    expect(create).not.toHaveBeenCalled();
  });
});
