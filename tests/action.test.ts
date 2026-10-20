import { describe, expect, it } from "vitest";
import { FLIGHT_PASS_SEC, firstPassAt, flightAt, passMiddles } from "@/lib/flight";
import { dimensionsFor } from "@/lib/renderer";
import { imagePrompt, usesWheelchair } from "@/lib/server/images";
import { normalizeStory } from "@/lib/server/normalizeStory";
import { STORY_INSTRUCTIONS, storyInstructions } from "@/lib/server/systemPrompts";
import { planSoundBed } from "@/lib/soundBed";
import {
  DEFAULT_ART_STYLE,
  ImageRequestSchema,
  NARRATOR,
  SCENE_LEAD_SEC,
  StorySchema,
  fliesInStory,
  pictureKey,
  storyDuration,
  type LineTiming,
  type Story,
} from "@/lib/story";
import { firesFor } from "@/lib/storyAtmosphere";
import { drawStoryFrame, storyCamera, type CharacterSprites, type StoryRenderAssets } from "@/lib/storyRenderer";

const LINE: LineTiming = { duration: 3, speechStart: 0.1, speechEnd: 2.6 };

const story = (): Story =>
  StorySchema.parse({
    title: "Lanka Dahana",
    aspectRatio: "9:16",
    artStyle: DEFAULT_ART_STYLE,
    narratorVoice: "sage",
    characters: [
      { id: "c1", name: "Hanuman", look: "x", size: "large", voice: "verse", voiceAge: "adult", voiceStyle: "" },
      { id: "c2", name: "Ravana", look: "x", size: "large", voice: "onyx", voiceAge: "adult", voiceStyle: "" },
    ],
    locations: [
      { id: "l1", name: "Court", look: "A golden royal court hall." },
      { id: "l2", name: "Rooftops", look: "Golden rooftops of Lanka at dusk with orange flames." },
    ],
    scenes: [
      { id: "s1", locationId: "l1", onStage: ["c1", "c2"], lines: [{ speaker: "c2", text: "Who are you?" }] },
      {
        id: "s2",
        locationId: "l2",
        onStage: ["c1"],
        flying: ["c1"],
        lines: [
          { speaker: NARRATOR, text: "Hanuman leapt from roof to roof." },
          { speaker: "c1", text: "Jai Sri Ram!" },
          { speaker: NARRATOR, text: "And so Lanka was lit up." },
        ],
      },
    ],
  });

const sprite = (name: string, width = 450, height = 1000) => ({ source: { name } as unknown as CanvasImageSource, width, height });
const characters = new Map<string, CharacterSprites>([
  ["c1", { idle: sprite("hanuman"), flying: sprite("hanuman-flying", 1000, 450) }],
  ["c2", { idle: sprite("ravana") }],
]);
const assets: StoryRenderAssets = { characters, places: new Map(), headingFont: "sans-serif", timeLine: () => LINE };
const tall = dimensionsFor("9:16");
const sceneTwo = SCENE_LEAD_SEC + LINE.duration;

describe("a character flying through a scene", () => {
  it("swoops across the picture and comes back the other way, without jumping", () => {
    const first = flightAt(0);
    expect(first.x).toBeLessThan(0);
    expect(first.direction).toBe(1);
    const middle = flightAt(FLIGHT_PASS_SEC / 2);
    expect(middle.x).toBeCloseTo(0.5, 5);
    expect(middle.visible).toBe(true);
    // Higher (smaller y) in the middle of the leap than at its ends.
    expect(middle.y).toBeLessThan(first.y);
    expect(flightAt(FLIGHT_PASS_SEC + 0.5).direction).toBe(-1);
    // Smooth all the way: no frame moves more than a small step.
    for (let t = 0; t < 10; t += 0.04) {
      const a = flightAt(t);
      const b = flightAt(t + 0.04);
      expect(Math.abs(b.x - a.x)).toBeLessThan(0.05);
    }
  });

  it("knows when the flyer first passes each point, and when each pass crosses the middle", () => {
    for (const x of [0.1, 0.5, 0.9]) expect(flightAt(firstPassAt(x)).x).toBeCloseTo(x, 5);
    const middles = passMiddles(8);
    expect(middles[0]).toEqual({ at: FLIGHT_PASS_SEC / 2, direction: 1 });
    expect(middles[1].direction).toBe(-1);
    expect(middles.every((pass) => pass.at < 8)).toBe(true);
  });

  it("draws the flying pose instead of the standing one, and the camera follows it closer in", () => {
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
    const at = sceneTwo + FLIGHT_PASS_SEC / 2;
    drawStoryFrame(ctx, story(), at, assets, { settled: true });
    expect(names).toContain("hanuman-flying");
    expect(names).not.toContain("hanuman");
    const camera = storyCamera(story(), at, assets, tall);
    expect(camera.scale).toBeGreaterThan(1.1);
    // Later in the same pass the flyer is further right, and so is the camera.
    expect(storyCamera(story(), at + 0.5, assets, tall).cx).toBeGreaterThan(camera.cx);
    expect(fliesInStory(story(), "c1")).toBe(true);
    expect(fliesInStory(story(), "c2")).toBe(false);
  });

  it("sets fire where the flyer passes, left to right on the first pass", () => {
    const spots = firesFor(story().scenes[1], false);
    expect(spots).toHaveLength(9);
    const sorted = [...spots].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].ignite).toBeGreaterThan(sorted[i - 1].ignite);
    expect(sorted[sorted.length - 1].ignite).toBeLessThan(FLIGHT_PASS_SEC);
  });

  it("gives an action scene drums, whooshes and a boom for every fire", () => {
    const subject = story();
    const plan = planSoundBed(subject, () => LINE, storyDuration(subject, () => LINE), false);
    expect(plan.scenes[0]).toMatchObject({ flyers: 0, ignitions: [] });
    expect(plan.scenes[1].flyers).toBe(1);
    expect(plan.scenes[1].ignitions).toHaveLength(9);
    // A calm story never flies at full speed or drums.
    expect(planSoundBed({ ...subject, calm: true }, () => LINE, 20, false).scenes[1].flyers).toBe(0);
  });
});

describe("asking for flight", () => {
  it("keeps flyers who are in the scene, and drops anyone who is not", () => {
    const normalized = normalizeStory({
      title: "t",
      aspectRatio: "9:16",
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "sage",
      isHealthTopic: false,
      characters: [
        { id: "c1", name: "Hanuman", look: "x", size: "large", voice: "verse", voiceAge: "adult", voiceStyle: "" },
        { id: "c2", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
      ],
      locations: [{ id: "l1", name: "Sea", look: "x" }],
      scenes: [
        { id: "s1", locationId: "l1", onStage: ["c1"], flying: ["c1", "c2", "nobody"], lines: [{ speaker: "c1", text: "Here I go!" }] },
        { id: "s2", locationId: "l1", onStage: ["c2"], flying: [], lines: [{ speaker: "c2", text: "Hello." }] },
      ],
    });
    expect(normalized.scenes[0].flying).toEqual(["c1"]);
    expect(normalized.scenes[1].flying).toBeUndefined();
  });

  it("tells the story writer when to use flight, and never in Social Stories or exercises", () => {
    expect(STORY_INSTRUCTIONS).toContain("flying: the ids of characters from onStage who fly or leap");
    expect(storyInstructions("social")).toContain("flying: always an empty list");
    expect(storyInstructions("exercises")).toContain("flying: always an empty list");
  });

  it("draws a flying pose from the standing picture, level and heading right", () => {
    const reference = "data:image/png;base64,iVBORw0KGgo=";
    const base = { kind: "flying" as const, look: "A monkey hero in an orange dhoti.", artStyle: "", aspectRatio: "9:16" as const };
    expect(ImageRequestSchema.safeParse(base).success).toBe(false);
    expect(ImageRequestSchema.safeParse({ ...base, reference }).success).toBe(true);
    const prompt = imagePrompt({ ...base, reference });
    expect(prompt).toContain("flying through the air");
    expect(prompt).toContain("heading to the right");
    expect(pictureKey.flying("c1")).toBe("flying:c1");
  });

  it("keeps a wheelchair user sitting in their chair in every picture, and flies the chair like a chariot", () => {
    const reference = "data:image/png;base64,iVBORw0KGgo=";
    const look = "A cheerful seven-year-old boy with curly black hair in a black wheelchair, wearing a red vest.";
    const base = { look, artStyle: "", aspectRatio: "9:16" as const };
    expect(usesWheelchair(look)).toBe(true);
    expect(usesWheelchair("A girl in a yellow dress.")).toBe(false);
    const standing = imagePrompt({ ...base, kind: "character" });
    expect(standing).toContain("sitting comfortably in it with both wheels on the ground");
    expect(standing).not.toContain("standing upright");
    expect(imagePrompt({ ...base, kind: "gesture", reference })).toContain("sitting in the same wheelchair");
    expect(imagePrompt({ ...base, kind: "expression", emotion: "happy", reference })).toContain("sitting in the same wheelchair");
    expect(imagePrompt({ ...base, kind: "flying", reference })).toContain("soars through the air like a chariot");
    expect(imagePrompt({ ...base, look: "A girl in a yellow dress.", kind: "character" })).toContain("standing upright");
  });
});
