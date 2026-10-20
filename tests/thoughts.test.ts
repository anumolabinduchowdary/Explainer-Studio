import { describe, expect, it } from "vitest";
import { normalizeStory } from "@/lib/server/normalizeStory";
import { STORY_INSTRUCTIONS } from "@/lib/server/systemPrompts";
import { DEFAULT_ART_STYLE, NARRATOR, SCENE_LEAD_SEC, StorySchema, clipKey, lineVoice, type LineTiming, type Story } from "@/lib/story";
import { describeStoryMoment, drawStoryFrame, type CharacterSprites, type StoryRenderAssets } from "@/lib/storyRenderer";

const LINE: LineTiming = { duration: 3, speechStart: 0.1, speechEnd: 2.8 };

const story = (): Story =>
  StorySchema.parse({
    title: "Karthi",
    aspectRatio: "9:16",
    artStyle: DEFAULT_ART_STYLE,
    narratorVoice: "sage",
    characters: [
      { id: "c1", name: "Karthi", look: "x", size: "small", voice: "verse", voiceAge: "child", voiceStyle: "" },
      { id: "c2", name: "Amma", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
    ],
    locations: [{ id: "l1", name: "Room", look: "A bright child's bedroom." }],
    scenes: [
      {
        id: "s1",
        locationId: "l1",
        onStage: ["c1", "c2"],
        lines: [
          { speaker: "c1", text: "My legs feel heavy today.", thought: true },
          { speaker: "c1", text: "Amma!" },
        ],
      },
    ],
  });

const sprite = (name: string) => ({ source: { name } as unknown as CanvasImageSource, width: 450, height: 1000 });
const characters = new Map<string, CharacterSprites>([
  ["c1", { idle: sprite("karthi"), talk: sprite("karthi-talking") }],
  ["c2", { idle: sprite("amma"), talk: sprite("amma-talking") }],
]);
const assets: StoryRenderAssets = { characters, places: new Map(), headingFont: "sans-serif", timeLine: () => LINE };

/** Draws a frame and records the pictures drawn and the caption's colour. */
function frame(time: number) {
  const names: string[] = [];
  const captions: Array<{ text: string; colour: unknown }> = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (key === "drawImage") return (source: { name?: string }) => source?.name && names.push(source.name);
      if (key === "fillText") return (text: string) => captions.push({ text, colour: target.fillStyle });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
      if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
      return () => undefined;
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  drawStoryFrame(ctx, story(), time, assets, { settled: false });
  return { names, captions };
}

describe("thought lines", () => {
  it("keeps the mouth closed while a character thinks, and moves it when they speak", () => {
    const during = (line: number) =>
      Array.from({ length: 20 }, (_, i) => frame(SCENE_LEAD_SEC + line * LINE.duration + 0.15 + i * 0.12).names).flat();
    expect(during(0)).not.toContain("karthi-talking");
    expect(during(1)).toContain("karthi-talking");
  });

  it("shows a thought's caption in its own soft pink, and says so to screen readers", () => {
    const thinking = frame(SCENE_LEAD_SEC + 1).captions;
    expect(thinking.some((caption) => caption.colour === "#FFD3EE")).toBe(true);
    const speaking = frame(SCENE_LEAD_SEC + LINE.duration + 1).captions;
    expect(speaking.some((caption) => caption.colour === "#FFD3EE")).toBe(false);
    expect(describeStoryMoment(story(), 1).text).toContain("Karthi (thinking): My legs feel heavy today.");
  });

  it("asks the voice for an inner voice, so a thought is recorded apart from the same words said aloud", () => {
    const subject = story();
    const thought = subject.scenes[0].lines[0];
    expect(lineVoice(subject, thought).delivery).toContain("inner thought");
    expect(clipKey(subject, thought)).not.toBe(clipKey(subject, { ...thought, thought: undefined }));
  });

  it("lets characters think, never the narrator, and tells the story writer about thoughts", () => {
    const normalized = normalizeStory({
      title: "t",
      aspectRatio: "9:16",
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "sage",
      isHealthTopic: false,
      characters: [{ id: "c1", name: "Karthi", look: "x", size: "small", voice: "verse", voiceAge: "child", voiceStyle: "" }],
      locations: [{ id: "l1", name: "Room", look: "x" }],
      scenes: [
        {
          id: "s1",
          locationId: "l1",
          onStage: ["c1"],
          lines: [
            { speaker: "c1", text: "I can do it.", thought: true },
            { speaker: "c1", text: "Amma!", thought: false },
            { speaker: NARRATOR, text: "And he did.", thought: true },
          ],
        },
      ],
    });
    expect(normalized.scenes[0].lines.map((line) => line.thought)).toEqual([true, undefined, undefined]);
    expect(STORY_INSTRUCTIONS).toContain("thought: true when the line is the speaker's inner thought");
  });
});
