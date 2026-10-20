import { describe, expect, it } from "vitest";
import { dimensionsFor } from "@/lib/renderer";
import { DEFAULT_ART_STYLE, NARRATOR, SCENE_LEAD_SEC, StorySchema, type LineTiming, type Story } from "@/lib/story";
import { drawStoryFrame, storyCamera, type CharacterSprites, type StoryRenderAssets } from "@/lib/storyRenderer";

const LINE: LineTiming = { duration: 3, speechStart: 0.1, speechEnd: 2.6 };

const story = (changes: Partial<Story> = {}, card = false): Story =>
  StorySchema.parse({
    title: "Ramayan",
    aspectRatio: "9:16",
    artStyle: DEFAULT_ART_STYLE,
    narratorVoice: "sage",
    characters: [
      { id: "c1", name: "Rama", look: "x", size: "large", voice: "cedar", voiceAge: "adult", voiceStyle: "" },
      { id: "c2", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
      { id: "c3", name: "Hanuman", look: "x", size: "large", voice: "verse", voiceAge: "adult", voiceStyle: "" },
    ],
    locations: [{ id: "l1", name: "Forest", look: "x" }],
    scenes: [
      {
        id: "s1",
        locationId: "l1",
        onStage: ["c1", "c2", "c3"],
        lines: [
          { speaker: "c1", text: "Sita, this forest feels like home." },
          { speaker: "c2", text: "It does, Rama." },
          { speaker: NARRATOR, text: "They lived happily." },
        ],
      },
      {
        id: "s2",
        locationId: "l1",
        onStage: ["c3"],
        lines: [{ speaker: "c3", text: "I will find her." }],
        ...(card ? { card: { title: "Bridge", dose: "10 times", look: "A mat" } } : {}),
      },
    ],
    ...changes,
  });

const sprites = new Map<string, CharacterSprites>(
  ["Rama", "Sita", "Hanuman"].map((name, i) => [`c${i + 1}`, { idle: { source: { name } as unknown as CanvasImageSource, width: 450, height: 1000 } }]),
);
const assets: StoryRenderAssets = { characters: sprites, places: new Map(), headingFont: "sans-serif", timeLine: () => LINE };
const tall = dimensionsFor("9:16");
/** The start of line `l` in scene 0, in seconds. */
const lineStart = (l: number) => SCENE_LEAD_SEC + l * LINE.duration;

describe("the camera", () => {
  it("is wide while a scene begins, and glides in on the speaker as they start talking", () => {
    const subject = story();
    expect(storyCamera(subject, 0.2, assets, tall)).toEqual({ scale: 1, cx: tall.width / 2, cy: tall.height / 2 });
    const start = storyCamera(subject, lineStart(0) + 0.01, assets, tall);
    const half = storyCamera(subject, lineStart(0) + 0.35, assets, tall);
    const close = storyCamera(subject, lineStart(0) + 1.5, assets, tall);
    expect(start.scale).toBeLessThan(1.02);
    expect(half.scale).toBeGreaterThan(1.05);
    expect(half.scale).toBeLessThan(1.3);
    expect(close.scale).toBeCloseTo(1.3, 5);
    // Rama stands on the left: the camera moves left, framing his head and shoulders.
    expect(close.cx).toBeLessThan(tall.width / 2);
    expect(close.cy).toBeLessThan(tall.height * 0.84);
  });

  it("moves across to the next speaker, and back out for the narrator", () => {
    const subject = story();
    const rama = storyCamera(subject, lineStart(0) + 2, assets, tall);
    const sita = storyCamera(subject, lineStart(1) + 2, assets, tall);
    expect(sita.scale).toBeCloseTo(rama.scale, 5);
    expect(sita.cx).toBeGreaterThan(rama.cx);
    const between = storyCamera(subject, lineStart(1) + 0.35, assets, tall);
    expect(between.cx).toBeGreaterThan(rama.cx);
    expect(between.cx).toBeLessThan(sita.cx);
    expect(storyCamera(subject, lineStart(2) + 2, assets, tall).scale).toBe(1);
  });

  it("never shows past the edge of the picture", () => {
    for (const ratio of ["9:16", "16:9", "1:1"] as const) {
      const dims = dimensionsFor(ratio);
      const subject = story({ aspectRatio: ratio });
      for (const at of [lineStart(0) + 2, lineStart(1) + 2]) {
        const shot = storyCamera(subject, at, assets, dims);
        expect(shot.cx - dims.width / (2 * shot.scale)).toBeGreaterThanOrEqual(-1e-6);
        expect(shot.cx + dims.width / (2 * shot.scale)).toBeLessThanOrEqual(dims.width + 1e-6);
        expect(shot.cy - dims.height / (2 * shot.scale)).toBeGreaterThanOrEqual(-1e-6);
        expect(shot.cy + dims.height / (2 * shot.scale)).toBeLessThanOrEqual(dims.height + 1e-6);
      }
    }
  });

  it("zooms less in a calm story, stays wide over an exercise card, and holds still when paused", () => {
    expect(storyCamera(story({ calm: true }), lineStart(0) + 2, assets, tall).scale).toBeCloseTo(1.15, 5);
    const withCard = story({}, true);
    const sceneTwo = SCENE_LEAD_SEC * 2 + LINE.duration * 3 + 1.5;
    expect(storyCamera(withCard, sceneTwo, assets, tall).scale).toBe(1);
    // Paused at the very start of a line, the picture shows where the camera is going.
    expect(storyCamera(story(), lineStart(0) + 0.01, assets, tall, true).scale).toBeCloseTo(1.3, 5);
  });
});

describe("each character keeps their side of the screen", () => {
  it("stands in the same place in every scene, however the scene lists who is on stage", () => {
    const subject = story();
    // Scene two lists Sita first, as a story often does when she speaks first.
    subject.scenes[1] = { ...subject.scenes[1], onStage: ["c2", "c1"], lines: [{ speaker: "c2", text: "Hello." }] };
    subject.scenes[0] = { ...subject.scenes[0], onStage: ["c1", "c2"] };
    const xs: Array<Record<string, number>> = [];
    let lastX = 0;
    let current: Record<string, number> = {};
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "translate") return (x: number) => (lastX = x);
        if (key === "drawImage") return (source: { name?: string }) => source?.name && (current[source.name] = lastX);
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
        if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
        return () => undefined;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    for (const time of [0.3, SCENE_LEAD_SEC * 2 + LINE.duration * 3 + 0.2]) {
      current = {};
      drawStoryFrame(ctx, subject, time, assets, { settled: true });
      xs.push(current);
    }
    expect(xs[0].Rama).toBeLessThan(xs[0].Sita);
    expect(xs[1].Rama).toBeCloseTo(xs[0].Rama, 6);
    expect(xs[1].Sita).toBeCloseTo(xs[0].Sita, 6);
  });
});

describe("no jumping", () => {
  /** Where each character is placed (the y of the move before their picture is drawn), frame by frame. */
  function heights(subject: Story, times: number[]) {
    const frames: Array<Map<string, number>> = [];
    let lastY = 0;
    let current = new Map<string, number>();
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "translate") return (_x: number, y: number) => (lastY = y);
        if (key === "drawImage") return (source: { name?: string }) => source?.name && current.set(source.name, lastY);
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
        if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
        if (key === "getContext") return () => null;
        return () => undefined;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    for (const time of times) {
      current = new Map();
      drawStoryFrame(ctx, subject, time, assets, { settled: false });
      frames.push(current);
    }
    return frames;
  }

  it("keeps the speaker standing still on the ground while they talk", () => {
    const times = Array.from({ length: 20 }, (_, i) => lineStart(0) + 0.15 + i * 0.12);
    const rama = heights(story(), times).map((frame) => frame.get("Rama"));
    expect(rama.every((y) => y !== undefined)).toBe(true);
    expect(new Set(rama.map((y) => y!.toFixed(3))).size).toBe(1);
  });

  it("lets characters fade in where they stand, without rising into place", () => {
    const arriving = heights(story(), [0.05, 0.2, 0.4]).map((frame) => frame.get("Sita"));
    expect(new Set(arriving.map((y) => y!.toFixed(3))).size).toBe(1);
  });

  it("keeps everyone perfectly still: nobody breathes, nods, leans or pops, speaker or listener", () => {
    const moves: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "rotate") return (angle: number) => moves.push(`rotate ${angle.toFixed(4)}`);
        // Mirroring a picture to face the other way is fine; stretching it is not.
        if (key === "scale") return (x: number, y: number) => (Math.abs(Math.abs(x) - 1) > 1e-9 || y !== 1) && moves.push(`scale ${x} ${y}`);
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
        if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
        if (key === "getContext") return () => null;
        return () => undefined;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const subject = story();
    const times = Array.from({ length: 60 }, (_, i) => lineStart(0) + 0.05 + i * 0.1);
    for (const time of times) drawStoryFrame(ctx, subject, time, assets, { settled: false });
    expect(moves).toEqual([]);
    // Sita and Hanuman listen while Rama speaks, and stand at one height the whole time.
    for (const name of ["Sita", "Hanuman"]) {
      const ys = heights(subject, times.slice(0, 25)).map((frame) => frame.get(name));
      expect(new Set(ys.map((y) => y!.toFixed(3))).size).toBe(1);
    }
  });
});
