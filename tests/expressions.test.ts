import { describe, expect, it } from "vitest";
import { imagePrompt } from "@/lib/server/images";
import { normalizeStory } from "@/lib/server/normalizeStory";
import { STORY_INSTRUCTIONS, storyInstructions } from "@/lib/server/systemPrompts";
import {
  DEFAULT_ART_STYLE,
  ImageRequestSchema,
  NARRATOR,
  SCENE_LEAD_SEC,
  StorySchema,
  emotionsFor,
  feelingAt,
  pictureKey,
  type LineTiming,
  type Story,
} from "@/lib/story";
import { drawStoryFrame, type CharacterSprites, type StoryRenderAssets } from "@/lib/storyRenderer";

const LINE: LineTiming = { duration: 3, speechStart: 0.1, speechEnd: 2.6 };

const story = (): Story =>
  StorySchema.parse({
    title: "Ramayan",
    aspectRatio: "9:16",
    artStyle: DEFAULT_ART_STYLE,
    narratorVoice: "sage",
    characters: [
      { id: "c1", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
      { id: "c2", name: "Ravana", look: "x", size: "large", voice: "onyx", voiceAge: "adult", voiceStyle: "" },
    ],
    locations: [{ id: "l1", name: "Lanka", look: "x" }],
    scenes: [
      {
        id: "s1",
        locationId: "l1",
        onStage: ["c1", "c2"],
        lines: [
          { speaker: "c2", text: "Sita will stay in Lanka!", emotion: "angry" },
          { speaker: "c1", text: "Please let me go home.", emotion: "sad" },
          { speaker: "c1", text: "Rama will come for me." },
          { speaker: NARRATOR, text: "Far away, Hanuman was on his way." },
        ],
      },
    ],
  });

describe("feelings on the characters' faces", () => {
  it("lists the feelings each character shows, without their usual face", () => {
    expect(emotionsFor(story(), "c1")).toEqual(["sad"]);
    expect(emotionsFor(story(), "c2")).toEqual(["angry"]);
    expect(pictureKey.expression("c1", "sad")).not.toBe(pictureKey.expressionTalking("c1", "sad"));
  });

  it("keeps a character's feeling from the writer, but never gives the narrator one", () => {
    const normalized = normalizeStory({
      title: "t",
      aspectRatio: "9:16",
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "sage",
      isHealthTopic: false,
      characters: [{ id: "c1", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" }],
      locations: [{ id: "l1", name: "Lanka", look: "x" }],
      scenes: [
        {
          id: "s1",
          locationId: "l1",
          onStage: ["c1"],
          lines: [
            { speaker: "c1", text: "I am so happy!", emotion: "happy" },
            { speaker: "c1", text: "Hello.", emotion: "neutral" },
            { speaker: NARRATOR, text: "The end.", emotion: "sad" },
          ],
        },
      ],
    });
    expect(normalized.scenes[0].lines.map((line) => line.emotion)).toEqual(["happy", undefined, undefined]);
  });

  it("draws a feeling by changing only the face of the standing picture", () => {
    const reference = "data:image/png;base64,iVBORw0KGgo=";
    const base = { kind: "expression" as const, look: "A gentle princess in a red sari.", artStyle: "", aspectRatio: "9:16" as const };
    expect(ImageRequestSchema.safeParse({ ...base, emotion: "sad", reference }).success).toBe(true);
    expect(ImageRequestSchema.safeParse({ ...base, emotion: "sad" }).success).toBe(false);
    expect(ImageRequestSchema.safeParse({ ...base, emotion: "neutral", reference }).success).toBe(false);
    const prompt = imagePrompt({ ...base, emotion: "sad", reference });
    expect(prompt).toContain("Redraw exactly the same character");
    expect(prompt).toContain("Change the face only, to a clearly sad expression");
    expect(prompt).toContain("never frightening");
    expect(imagePrompt({ ...base, emotion: "angry", reference })).toContain("cross, not scary");
  });

  it("asks the writer for a feeling on each line, and keeps Social Stories and exercises gentle", () => {
    expect(STORY_INSTRUCTIONS).toContain("emotion: the feeling on the speaker's face");
    expect(STORY_INSTRUCTIONS).toContain('Use "angry" rarely');
    // Only the people really there are on screen; an arrival or a departure starts a new scene.
    expect(STORY_INSTRUCTIONS).toContain("When someone arrives or leaves, start a new scene");
    expect(storyInstructions("social")).toContain('emotion: only "neutral" or "happy"');
    expect(storyInstructions("exercises")).toContain('emotion: only "neutral" or "happy"');
  });

  it("keeps each character's feeling while others speak, until it changes", () => {
    const sprite = (name: string) => ({ source: { name } as unknown as CanvasImageSource, width: 450, height: 1000 });
    const characters = new Map<string, CharacterSprites>([
      ["c1", { idle: sprite("sita"), expressions: new Map([["sad", { idle: sprite("sita-sad") }], ["happy", { idle: sprite("sita-happy") }]]) }],
      ["c2", { idle: sprite("ravana"), expressions: new Map([["angry", { idle: sprite("ravana-angry") }]]) }],
    ]);
    const assets: StoryRenderAssets = { characters, places: new Map(), headingFont: "sans-serif", timeLine: () => LINE };
    const subject = StorySchema.parse({
      ...story(),
      scenes: [
        {
          id: "s1",
          locationId: "l1",
          onStage: ["c1", "c2"],
          lines: [
            { speaker: "c2", text: "Who are you?" },
            { speaker: "c2", text: "How dare you advise me!", emotion: "angry" },
            { speaker: "c1", text: "Please let me go home.", emotion: "sad" },
            { speaker: "c1", text: "Rama will come for me." },
            { speaker: "c1", text: "Hanuman brought his ring!", emotion: "happy" },
          ],
        },
      ],
    });
    const drawn = (time: number) => {
      const names: string[] = [];
      const ctx = new Proxy({} as Record<string | symbol, unknown>, {
        get: (target, key) => {
          if (key in target) return target[key];
          if (key === "drawImage") return (source: { name?: string }) => source?.name && names.push(source.name);
          if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
          if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
          return () => undefined;
        },
        set: (target, key, value) => {
          target[key] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      drawStoryFrame(ctx, subject, time, assets, { settled: true });
      return names.sort();
    };
    const at = (line: number) => SCENE_LEAD_SEC + line * LINE.duration + 1;
    // An angry king is angry from the moment the scene opens, even while asking a plain question.
    expect(drawn(0.2)).toEqual(["ravana-angry", "sita-sad"]);
    expect(drawn(at(0))).toEqual(["ravana-angry", "sita-sad"]);
    // He stays angry while Sita speaks; she stays sad through a line with no feeling of its own...
    expect(drawn(at(2))).toEqual(["ravana-angry", "sita-sad"]);
    expect(drawn(at(3))).toEqual(["ravana-angry", "sita-sad"]);
    // ...until the good news.
    expect(drawn(at(4))).toEqual(["ravana-angry", "sita-happy"]);
    expect(feelingAt(subject.scenes[0], 3, "c1")).toBe("sad");
    expect(feelingAt(subject.scenes[0], 4, "c1")).toBe("happy");
    expect(feelingAt(subject.scenes[0], -1, "c2")).toBe("angry");
  });
});
