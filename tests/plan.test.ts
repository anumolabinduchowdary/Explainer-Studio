import { describe, expect, it } from "vitest";
import samplePlan from "@/examples/cerebral-palsy.plan.json";
import sampleStory from "@/examples/cerebral-palsy.story.json";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import {
  PLAN_LIMITS,
  PlanBuildWireSchema,
  StoryFromPlanRequestSchema,
  StoryPlanSchema,
  assemblePlan,
  nextId,
  picturesNeeded,
  sizeForAge,
  type PlanBuildWire,
  type StoryFromPlanWire,
  type StoryPlan,
} from "@/lib/plan";
import { dimensionsFor } from "@/lib/renderer";
import { buildStoryFromPlan, normalizePlanBuild } from "@/lib/server/normalizePlan";
import {
  PLAN_INSTRUCTIONS,
  STORYBOARD_INSTRUCTIONS,
  STORY_INSTRUCTIONS,
  planInput,
  planInstructions,
  storyInput,
  storyInstructions,
} from "@/lib/server/systemPrompts";
import { DEFAULT_ART_STYLE, NARRATOR, STORY_LIMITS, StorySchema, storySceneStart, type Story } from "@/lib/story";
import { arrangeStage, drawStoryFrame, storyCharacterScale, type CharacterSprites } from "@/lib/storyRenderer";

/** What the planner should return for "4 children in a physiotherapy centre with a physiotherapist". */
const physioWire = (changes: Partial<PlanBuildWire> = {}): PlanBuildWire => ({
  status: "ready",
  questions: [],
  message: "Physiotherapy exercises help children move with more ease, and they can be fun.",
  characters: [
    { name: "Ms. Kavya", role: "physiotherapist", age: "adult", look: "A woman in her thirties in a teal tunic." },
    { name: "Aarav", role: "boy who uses a walker", age: "child", look: "A six-year-old boy in a red T-shirt with a blue walker." },
    { name: "Diya", role: "girl who uses a wheelchair", age: "child", look: "A seven-year-old girl with two plaits in a purple wheelchair." },
    { name: "Kabir", role: "boy with leg braces", age: "child", look: "An eight-year-old boy with curly hair and leg braces." },
    { name: "Sara", role: "girl", age: "child", look: "A five-year-old girl with a bob in green dungarees." },
  ],
  places: [{ name: "Physiotherapy centre", look: "A bright therapy room with soft mats and parallel bars." }],
  lengthSec: 60,
  aspectRatio: "9:16",
  language: "English",
  tone: "Playful and encouraging",
  notes: "",
  style: "",
  exercises: [],
  specialParenting: true,
  ...changes,
});

const physioPlan = (): StoryPlan => {
  const result = normalizePlanBuild(physioWire(), { allowQuestions: true });
  if (result.status !== "ready") throw new Error("expected a plan");
  return result.plan;
};

const script = (changes: Partial<StoryFromPlanWire> = {}): StoryFromPlanWire => ({
  title: "Fun at Physiotherapy",
  narratorVoice: "alloy",
  isHealthTopic: false,
  disclaimer: "",
  voices: [
    { characterId: "c1", voice: "sage", voiceStyle: "calm and encouraging" },
    { characterId: "c2", voice: "verse", voiceStyle: "eager" },
    { characterId: "c3", voice: "coral", voiceStyle: "bright" },
    { characterId: "c4", voice: "echo", voiceStyle: "cheeky" },
    { characterId: "c5", voice: "shimmer", voiceStyle: "shy" },
  ],
  scenes: [
    {
      locationId: "l1", exercise: -1, flying: [],
      onStage: ["c1", "c2", "c3", "c4", "c5"],
      lines: [
        { speaker: "c1", text: "Good morning, team! Ready to move?", how: "", emotion: "neutral", thought: false },
        { speaker: "c2", text: "Ready!", how: "", emotion: "neutral", thought: false },
        { speaker: "c3", text: "Me too!", how: "", emotion: "neutral", thought: false },
      ],
    },
    {
      locationId: "l1", exercise: -1, flying: [],
      onStage: ["c1", "c4", "c5"],
      lines: [
        { speaker: "c4", text: "Watch me stretch!", how: "", emotion: "neutral", thought: false },
        { speaker: "c5", text: "I can balance now.", how: "", emotion: "neutral", thought: false },
      ],
    },
  ],
  ...changes,
});

/* ------------------------------------------------------------------ */

describe("example plan", () => {
  it("is valid and lists the same characters and places as the example story", () => {
    const plan = StoryPlanSchema.parse(samplePlan);
    const story = StorySchema.parse(sampleStory);
    expect(plan.characters.map((c) => [c.id, c.name, c.look])).toEqual(
      story.characters.map((c) => [c.id, c.name, c.look]),
    );
    expect(plan.places.map((p) => [p.id, p.name])).toEqual(story.locations.map((l) => [l.id, l.name]));
    expect(plan.characters.map((c) => c.age)).toEqual(story.characters.map((c) => c.voiceAge));
  });
});

describe("the plan", () => {
  it("turns '4 children and a physiotherapist' into five separate characters and one place", () => {
    const plan = physioPlan();
    expect(plan.characters.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(plan.characters.map((c) => c.age)).toEqual(["adult", "child", "child", "child", "child"]);
    expect(new Set(plan.characters.map((c) => c.name)).size).toBe(5);
    expect(plan.places).toEqual([
      { id: "l1", name: "Physiotherapy centre", look: "A bright therapy room with soft mats and parallel bars." },
    ]);
    expect(plan.lengthSec).toBe(60);
  });

  it("is what the planner is asked for, as a strict schema with no optional parts", () => {
    expect(PlanBuildWireSchema.safeParse(physioWire()).success).toBe(true);
    expect(PLAN_INSTRUCTIONS).toContain("Create exactly the people the user describes");
    expect(PLAN_INSTRUCTIONS).toContain(`at most ${PLAN_LIMITS.characters} characters`);
    expect(PLAN_INSTRUCTIONS).toContain("Never base a character on a real person");
    // Descriptions for the illustrator stay in English, whatever language the video is in.
    expect(PLAN_INSTRUCTIONS).toContain("Always write look in English");
    expect(PLAN_INSTRUCTIONS).toContain("look and style are always in English");
    expect(planInput({ description: "Ramayan", language: "Telugu" } as Parameters<typeof planInput>[0])).toContain(
      "always written in English",
    );
  });

  it("asks questions only when they are allowed", () => {
    const vague = physioWire({ status: "needs_clarification", questions: [" Who is it for? ", "", "a", "b", "c"] });
    expect(normalizePlanBuild(vague, { allowQuestions: true })).toEqual({
      status: "needs_clarification",
      questions: ["Who is it for?", "a", "b"],
    });
    expect(normalizePlanBuild(vague, { allowQuestions: false }).status).toBe("ready");
  });

  it("keeps the cast within the limit, tidies text and repairs the length", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      name: `  Child ${i + 1} `,
      role: "",
      age: "child" as const,
      look: "A child in a bright T-shirt.",
    }));
    const result = normalizePlanBuild(physioWire({ characters: eight, lengthSec: 0 }), { allowQuestions: false });
    if (result.status !== "ready") throw new Error("expected a plan");
    expect(result.plan.characters).toHaveLength(PLAN_LIMITS.characters);
    expect(result.plan.characters[0].name).toBe("Child 1");
    expect(result.plan.lengthSec).toBe(45);

    const long = normalizePlanBuild(physioWire({ lengthSec: 900 }), { allowQuestions: false });
    expect(long.status === "ready" && long.plan.lengthSec).toBe(PLAN_LIMITS.maxSeconds);
  });

  it("is rejected when it has nobody in it, nowhere to be or nothing to say", () => {
    expect(() => normalizePlanBuild(physioWire({ characters: [] }), { allowQuestions: false })).toThrow();
    expect(() => normalizePlanBuild(physioWire({ places: [] }), { allowQuestions: false })).toThrow();
    expect(() => normalizePlanBuild(physioWire({ message: "  " }), { allowQuestions: false })).toThrow();
  });

  it("refuses more characters or places than the app can show", () => {
    const plan = physioPlan();
    const extra = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...plan.characters[0], id: `x${i}` }));
    expect(StoryPlanSchema.safeParse({ ...plan, characters: extra(PLAN_LIMITS.characters) }).success).toBe(true);
    expect(StoryPlanSchema.safeParse({ ...plan, characters: extra(PLAN_LIMITS.characters + 1) }).success).toBe(false);
    expect(
      StoryFromPlanRequestSchema.safeParse({ plan: { ...plan, characters: [{ ...plan.characters[0], look: "" }] } })
        .success,
    ).toBe(false);
  });

  it("reads as plain text for the writer and the download", () => {
    const text = assemblePlan(physioPlan());
    expect(text).toContain("CHARACTERS (5)");
    expect(text).toContain("- c1: Ms. Kavya (physiotherapist, adult).");
    expect(text).toContain("- c5: Sara (girl, child).");
    expect(text).toContain("PLACES (1)\n- l1: Physiotherapy centre.");
    expect(text).toContain("Length: about 60 seconds");
    expect(text).not.toContain("NOTES");
    expect(storyInput(physioPlan())).toContain(text);
  });

  it("keeps the drawing style the description asked for, and draws every picture in it", () => {
    const styled = normalizePlanBuild(physioWire({ style: "  soft watercolour cartoon with pastel colours " }), { allowQuestions: false });
    if (styled.status !== "ready") throw new Error("expected a plan");
    expect(styled.plan.style).toBe("soft watercolour cartoon with pastel colours");
    expect(assemblePlan(styled.plan)).toContain("Drawing style: soft watercolour cartoon with pastel colours");
    expect(buildStoryFromPlan(styled.plan, script()).artStyle).toBe("soft watercolour cartoon with pastel colours");

    // Nothing asked for: the standard cartoon style.
    const plain = physioPlan();
    expect(plain.style).toBe("");
    expect(buildStoryFromPlan(plain, script()).artStyle).toBe(DEFAULT_ART_STYLE);
    expect(assemblePlan(plain)).toContain("Drawing style: the standard friendly 2D cartoon style");
    expect(PLAN_INSTRUCTIONS).toContain("never a photograph or photorealistic");
    expect(PLAN_INSTRUCTIONS).toContain("Never name an artist, studio");
    // Plans saved before the style existed still open.
    const { style, ...older } = plain;
    void style;
    expect(StoryPlanSchema.parse(older).style).toBe("");
  });

  it("has small helpers for sizes, ids and the number of pictures", () => {
    expect([sizeForAge("child"), sizeForAge("teen"), sizeForAge("adult"), sizeForAge("older")]).toEqual([
      "small",
      "medium",
      "large",
      "large",
    ]);
    expect(nextId("c", [{ id: "c1" }, { id: "c3" }])).toBe("c4");
    expect(nextId("c", [{ id: "c1" }, { id: "c2" }])).toBe("c3");
    // 6 drawings for each of the 5 characters, and 1 for the place.
    expect(picturesNeeded(physioPlan())).toBe(31);
  });
});

/* ------------------------------------------------------------------ */

describe("story from a plan", () => {
  it("uses exactly the plan's cast and places, with sizes and voice ages from each age", () => {
    const plan = physioPlan();
    const story = buildStoryFromPlan(plan, script());
    expect(story.characters.map((c) => [c.id, c.name, c.look])).toEqual(
      plan.characters.map((c) => [c.id, c.name, c.look]),
    );
    expect(story.characters.map((c) => [c.size, c.voiceAge])).toEqual([
      ["large", "adult"],
      ["small", "child"],
      ["small", "child"],
      ["small", "child"],
      ["small", "child"],
    ]);
    expect(story.characters.map((c) => c.voice)).toEqual(["sage", "verse", "coral", "echo", "shimmer"]);
    expect(story.locations).toEqual(plan.places);
    expect(story.aspectRatio).toBe(plan.aspectRatio);
    expect(story.scenes[0].onStage).toHaveLength(5);
  });

  it("cannot gain, lose or rename characters, whatever the writer returns", () => {
    const plan = physioPlan();
    const story = buildStoryFromPlan(
      plan,
      script({
        voices: [{ characterId: "c1", voice: "sage", voiceStyle: "calm" }],
        scenes: [
          {
            locationId: "somewhere else", exercise: -1, flying: [],
            onStage: ["c1", "c9", "A new nurse"],
            lines: [
              { speaker: "c1", text: "Hello everyone.", how: "", emotion: "neutral", thought: false },
              { speaker: "A new nurse", text: "I was never in the plan.", how: "", emotion: "neutral", thought: false },
            ],
          },
        ],
      }),
    );
    expect(story.characters.map((c) => c.name)).toEqual(plan.characters.map((c) => c.name));
    // The invented speaker's line is read by the narrator, and the unknown place falls back to the plan's.
    expect(story.scenes[0].lines[1].speaker).toBe(NARRATOR);
    expect(story.scenes[0].locationId).toBe("l1");
    // Everyone in the plan is seen, even though the writer only used one of them.
    expect([...story.scenes[0].onStage].sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    // Characters the writer gave no voice still get one each, and no two share it.
    const voices = story.characters.map((c) => c.voice);
    expect(new Set(voices).size).toBe(5);
    expect(voices).not.toContain(story.narratorVoice);
  });

  it("keeps ids in step when the user removed someone from the middle of the plan", () => {
    const plan = physioPlan();
    const trimmed = { ...plan, characters: plan.characters.filter((c) => c.id !== "c2") };
    const story = buildStoryFromPlan(
      trimmed,
      script({
        voices: [{ characterId: "c5", voice: "shimmer", voiceStyle: "shy" }],
        scenes: [{ locationId: "l1", exercise: -1, flying: [], onStage: ["c1", "c5"], lines: [{ speaker: "c5", text: "Hello!", how: "", emotion: "neutral", thought: false }] }],
      }),
    );
    expect(story.characters.map((c) => c.name)).toEqual(["Ms. Kavya", "Diya", "Kabir", "Sara"]);
    const sara = story.characters.find((c) => c.name === "Sara");
    expect(sara?.voice).toBe("shimmer");
    expect(story.scenes[0].lines[0].speaker).toBe(sara?.id);
  });

  it("ends a health story with the disclaimer, in the plan's language and then English", () => {
    const story = buildStoryFromPlan(physioPlan(), script({ isHealthTopic: true }));
    expect(story.scenes.at(-1)?.lines.at(-1)).toEqual({ speaker: NARRATOR, text: HEALTH_DISCLAIMER });
    const telugu = buildStoryFromPlan({ ...physioPlan(), language: "Telugu" }, script({ isHealthTopic: true }));
    expect(telugu.scenes.at(-1)?.lines.at(-1)).toEqual({ speaker: NARRATOR, text: `అవగాహన కోసం, వైద్య సలహా కాదు. ${HEALTH_DISCLAIMER}` });
    const spanish = buildStoryFromPlan(
      { ...physioPlan(), language: "Spanish" },
      script({ isHealthTopic: true, disclaimer: "Para concienciar, no es consejo médico." }),
    );
    expect(spanish.scenes.at(-1)?.lines.at(-1)?.text).toBe(`Para concienciar, no es consejo médico. ${HEALTH_DISCLAIMER}`);
  });

  it("is rejected when the script has no usable scenes", () => {
    expect(() => buildStoryFromPlan(physioPlan(), script({ scenes: [] }))).toThrow();
  });

  it("tells the writer the cast is fixed", () => {
    expect(STORY_INSTRUCTIONS).toContain("Do not add, remove, merge or rename");
    expect(STORY_INSTRUCTIONS).toContain(`at most ${STORY_LIMITS.onStage}`);
    expect(STORY_INSTRUCTIONS).toContain(HEALTH_DISCLAIMER);
  });
});

/* ------------------------------------------------------------------ */

describe("characters keep one size for the whole story", () => {
  // A Ramayan-like cast: five adults, one of them (Hanuman, with his tail) drawn wider.
  const cast = ["Rama", "Sita", "Lakshmana", "Hanuman", "Ravana"];
  const story = (aspectRatio: "9:16" | "16:9" | "1:1", withCard = false): Story =>
    StorySchema.parse({
      title: "Ramayan",
      aspectRatio,
      artStyle: DEFAULT_ART_STYLE,
      narratorVoice: "sage",
      characters: cast.map((name, i) => ({
        id: `c${i + 1}`, name, look: name, size: "large", voice: "cedar", voiceAge: "adult", voiceStyle: "",
      })),
      locations: [{ id: "l1", name: "Forest", look: "A forest" }],
      scenes: [
        { id: "s1", locationId: "l1", onStage: ["c1", "c2"], lines: [{ speaker: "c1", text: "We live in the forest." }] },
        { id: "s2", locationId: "l1", onStage: ["c1", "c2", "c3", "c4", "c5"], lines: [{ speaker: "c4", text: "I found her!" }] },
        { id: "s3", locationId: "l1", onStage: ["c1"], lines: [{ speaker: "c1", text: "We are home." }], ...(withCard ? { card: { title: "Bridge", dose: "10 times", look: "A mat" } } : {}) },
      ],
    });
  const sprites = new Map<string, CharacterSprites>(
    cast.map((name, i) => [`c${i + 1}`, { idle: { source: { name } as unknown as CanvasImageSource, width: name === "Hanuman" ? 700 : 450, height: 1000 } }]),
  );
  /** Draws a still of each scene and returns how tall each character was drawn in it. */
  const drawnHeights = (subject: Story) => {
    const heights: Array<Map<string, number>> = [];
    let current = new Map<string, number>();
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "drawImage") return (source: { name?: string }, ...box: number[]) => source?.name && current.set(source.name, box[3]);
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
        if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
        return () => undefined;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    subject.scenes.forEach((_, index) => {
      current = new Map();
      drawStoryFrame(ctx, subject, storySceneStart(subject, index) + 0.3, { characters: sprites, places: new Map(), headingFont: "sans-serif" }, { settled: true });
      heights.push(current);
    });
    return heights;
  };

  it("draws everyone at the same size in a scene with two, with five and alone", () => {
    for (const ratio of ["9:16", "16:9", "1:1"] as const) {
      const [two, five, alone] = drawnHeights(story(ratio));
      expect(five.size).toBe(5);
      for (const name of ["Rama", "Sita"]) {
        expect(two.get(name)).toBeCloseTo(five.get(name)!, 6);
      }
      expect(alone.get("Rama")).toBeCloseTo(five.get("Rama")!, 6);
      // Everyone in the crowded scene, front row and back row, is the same height.
      expect(new Set([...five.values()].map((h) => h.toFixed(3))).size).toBe(1);
    }
  });

  it("shrinks the whole story only as much as its most crowded scene needs, never below 65%", () => {
    const tall = dimensionsFor("9:16");
    const scale = storyCharacterScale(story("9:16"), sprites, tall);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.65);
    // Without the crowded scene there is room for everyone at full size.
    const small = { ...story("9:16"), scenes: story("9:16").scenes.filter((scene) => scene.id !== "s2") };
    expect(storyCharacterScale(small, sprites, tall)).toBe(1);
    // An exercise card in any scene makes everyone smaller in every scene, not only there.
    expect(storyCharacterScale({ ...small, scenes: story("9:16", true).scenes.filter((scene) => scene.id !== "s2") }, sprites, tall)).toBe(0.72);
    const [two, alone] = drawnHeights({ ...small, scenes: story("9:16", true).scenes.filter((scene) => scene.id !== "s2") });
    expect(two.get("Rama")).toBeCloseTo(alone.get("Rama")!, 6);
  });
});

describe("where characters stand", () => {
  const tall = dimensionsFor("9:16");
  const wide = dimensionsFor("16:9");
  const people = (...sizes: Array<"small" | "medium" | "large">) => sizes.map((size) => ({ size }));

  it("keeps one, two or three characters in a single row", () => {
    for (const n of [1, 2, 3]) {
      const places = arrangeStage(people(...Array<"large">(n).fill("large")), tall);
      expect(places).toHaveLength(n);
      expect(places.every((place) => place.row === "front")).toBe(true);
    }
  });

  it("stands a physiotherapist behind four children in a tall video", () => {
    const places = arrangeStage(people("large", "small", "small", "small", "small"), tall);
    expect(places[0]).toMatchObject({ row: "back", x: 0.5 });
    expect(places.slice(1).map((place) => place.row)).toEqual(["front", "front", "front", "front"]);
    expect(places.slice(1).map((place) => place.x)).toEqual([0.14, 0.38, 0.62, 0.86]);
  });

  it("uses one row when the frame is wide enough for everyone", () => {
    expect(arrangeStage(people("small", "small", "small", "small"), tall).every((p) => p.row === "front")).toBe(true);
    expect(
      arrangeStage(people("large", "large", "large", "large", "large"), wide).every((p) => p.row === "front"),
    ).toBe(true);
  });

  it("splits five adults into two rows, left to right in cast order", () => {
    const places = arrangeStage(people("large", "large", "large", "large", "large"), tall);
    expect(places.map((place) => place.row)).toEqual(["front", "back", "front", "back", "front"]);
    const xs = places.map((place) => place.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("gives everyone a different spot inside the frame, for every mix of sizes", () => {
    const sizes = ["small", "medium", "large"] as const;
    for (const ratio of ["9:16", "16:9", "1:1"] as const) {
      for (let n = 1; n <= STORY_LIMITS.onStage; n++) {
        for (let mix = 0; mix < 3 ** n; mix++) {
          const cast = Array.from({ length: n }, (_, i) => ({ size: sizes[Math.floor(mix / 3 ** i) % 3] }));
          const places = arrangeStage(cast, dimensionsFor(ratio));
          expect(places).toHaveLength(n);
          expect(new Set(places.map((place) => `${place.row}:${place.x}`)).size).toBe(n);
          for (const place of places) {
            expect(place.x).toBeGreaterThan(0.05);
            expect(place.x).toBeLessThan(0.95);
            expect(place.maxWidth).toBeGreaterThan(0.15);
          }
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("the Special Parenting QR card", () => {
  it("is decided from the description, and always on for Social Stories and exercise programmes", () => {
    const ready = (result: ReturnType<typeof normalizePlanBuild>) => {
      if (result.status !== "ready") throw new Error("expected a plan");
      return result.plan;
    };
    expect(ready(normalizePlanBuild(physioWire(), { allowQuestions: false })).specialParenting).toBe(true);
    // For example a Ramayan story: no QR card.
    expect(ready(normalizePlanBuild(physioWire({ specialParenting: false }), { allowQuestions: false })).specialParenting).toBe(false);
    expect(ready(normalizePlanBuild(physioWire({ specialParenting: false }), { allowQuestions: false, kind: "social" })).specialParenting).toBe(true);
    const programme = physioWire({
      specialParenting: false,
      exercises: [{ name: "Bridge", steps: "Lie on your back and lift your hips.", dose: "10 times", look: "A boy on a mat", caution: "" }],
    });
    expect(ready(normalizePlanBuild(programme, { allowQuestions: false, kind: "exercises" })).specialParenting).toBe(true);

    // A plan made before the question existed gets no QR card; the example (cerebral palsy) does.
    expect(StoryPlanSchema.parse({ ...samplePlan, specialParenting: undefined }).specialParenting).toBe(false);
    expect(StoryPlanSchema.parse(samplePlan).specialParenting).toBe(true);
  });

  it("asks both writers the same question, leaving out general topics and stories", () => {
    for (const instructions of [PLAN_INSTRUCTIONS, STORYBOARD_INSTRUCTIONS]) {
      expect(instructions).toContain("specialParenting: true only if the video is about special parenting");
      expect(instructions).toContain("autism, cerebral palsy");
      expect(instructions).toContain("not about special needs");
      expect(instructions).toContain("mythology");
    }
  });
});

describe("Social Stories and home exercise programmes", () => {
  it("makes a Social Story calm, and keeps exercises out of it", () => {
    const social = normalizePlanBuild(physioWire({ exercises: [{ name: "x", steps: "y z", dose: "", look: "a b", caution: "" }] }), {
      allowQuestions: false,
      kind: "social",
    });
    if (social.status !== "ready") throw new Error("expected a plan");
    expect(social.plan).toMatchObject({ kind: "social", calm: true, exercises: [] });
    expect(assemblePlan(social.plan)).toContain("KIND\nSocial Story (calm, sensory-friendly)");
    expect(planInstructions("social")).toContain("This is a Social Story");
    expect(storyInstructions("social")).toContain("Write it in the first person, as the child");
    expect(storyInstructions("social")).toContain("at least twice as many lines that describe or reassure");
    expect(planInstructions("story")).toBe(PLAN_INSTRUCTIONS);
  });

  it("passes the child's details and the therapist's exercises to the planner", () => {
    const social = planInput({
      description: "Going to the dentist for a check-up.",
      kind: "social",
      child: { name: "Aarav", age: "6", look: "Curly hair and glasses", helps: "his toy dinosaur" },
    });
    expect(social).toContain("This is a Social Story for this child:\n- Name: Aarav\n- Age: 6\n- Looks like: Curly hair and glasses\n- What helps: his toy dinosaur");
    const exercises = planInput({
      description: "Leg exercises after surgery.",
      kind: "exercises",
      therapy: { type: "Physiotherapy", who: "Aarav, 6", exercises: "Bridge: lift hips, 10 times." },
    });
    expect(exercises).toContain("Therapy: Physiotherapy");
    expect(exercises).toContain('The therapist\'s exercises, as written:\n"""\nBridge: lift hips, 10 times.\n"""');
    expect(planInput({ description: "A story about friends." })).not.toContain("Social Story");
  });

  const exerciseWire = () =>
    physioWire({
      characters: [
        { name: "Ms. Kavya", role: "physiotherapist", age: "adult", look: "A woman in a teal tunic." },
        { name: "Aarav", role: "boy", age: "child", look: "A boy in a red T-shirt." },
      ],
      exercises: [
        { name: "Bridge", steps: "Lie on your back, knees bent, and lift your hips.", dose: "Hold 5 seconds, 10 times", look: "A boy on a mat lifting his hips", caution: "" },
        { name: "Sit to stand", steps: "Stand up from a chair without using your hands.", dose: "8 times, 2 rounds", look: "A boy standing up from a chair", caution: "Keep a hand near him." },
        { name: "  ", steps: "", dose: "", look: "", caution: "" },
      ],
    });

  it("turns the therapist's exercises into a programme, in order, adding nothing", () => {
    const result = normalizePlanBuild(exerciseWire(), { allowQuestions: false, kind: "exercises" });
    if (result.status !== "ready") throw new Error("expected a plan");
    expect(result.plan.exercises.map((exercise) => [exercise.id, exercise.name, exercise.dose])).toEqual([
      ["e1", "Bridge", "Hold 5 seconds, 10 times"],
      ["e2", "Sit to stand", "8 times, 2 rounds"],
    ]);
    expect(picturesNeeded(result.plan)).toBe(2 * 6 + 1 + 2);
    expect(assemblePlan(result.plan)).toContain("EXERCISES (2, in this order)\n- Exercise 0: Bridge.");
    expect(storyInstructions("exercises")).toContain("one scene for each exercise in the plan, in order");
    // A programme with no exercises is refused, which makes the planner try again.
    expect(() => normalizePlanBuild(physioWire(), { allowQuestions: false, kind: "exercises" })).toThrow();
  });

  it("gives each exercise its card, and adds any exercise the writer left out", () => {
    const result = normalizePlanBuild(exerciseWire(), { allowQuestions: false, kind: "exercises" });
    if (result.status !== "ready") throw new Error("expected a plan");
    const story = buildStoryFromPlan(
      result.plan,
      script({
        voices: [],
        scenes: [
          { locationId: "l1", exercise: -1, flying: [], onStage: ["c1", "c2"], lines: [{ speaker: "c1", text: "Hello Aarav! Ready?", how: "", emotion: "neutral", thought: false }] },
          { locationId: "l1", exercise: 0, flying: [], onStage: ["c1", "c2"], lines: [{ speaker: "c1", text: "Bridge. Lift your hips. Ten times.", how: "", emotion: "neutral", thought: false }] },
          { locationId: "l1", exercise: -1, flying: [], onStage: ["c1", "c2"], lines: [{ speaker: "c1", text: "Well done today!", how: "", emotion: "neutral", thought: false }] },
        ],
      }),
    );
    expect(story.scenes.map((scene) => scene.card?.title ?? "-")).toEqual(["-", "Bridge", "Sit to stand", "-"]);
    const added = story.scenes[2];
    expect(added.card).toEqual({ title: "Sit to stand", dose: "8 times, 2 rounds", look: "A boy standing up from a chair", caution: "Keep a hand near him." });
    expect(added.lines[0].text).toBe("Sit to stand. Stand up from a chair without using your hands.");
    expect(added.lines[0].speaker).toBe("c1");
    expect(StorySchema.safeParse(story).success).toBe(true);
  });

  it("keeps the calm setting on the story", () => {
    const social = normalizePlanBuild(physioWire(), { allowQuestions: false, kind: "social" });
    if (social.status !== "ready") throw new Error("expected a plan");
    expect(buildStoryFromPlan(social.plan, script()).calm).toBe(true);
    expect(buildStoryFromPlan(physioPlan(), script()).calm).toBeUndefined();
  });
});

