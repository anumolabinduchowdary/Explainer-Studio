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
import { PLAN_INSTRUCTIONS, STORY_INSTRUCTIONS, storyInput } from "@/lib/server/systemPrompts";
import { NARRATOR, STORY_LIMITS, StorySchema } from "@/lib/story";
import { arrangeStage } from "@/lib/storyRenderer";

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
  ...changes,
});

const physioPlan = (): StoryPlan => {
  const result = normalizePlanBuild(physioWire(), { allowQuestions: true });
  if (result.status !== "ready") throw new Error("expected a plan");
  return result.plan;
};

const script = (changes: Partial<StoryFromPlanWire> = {}): StoryFromPlanWire => ({
  title: "Fun at Physiotherapy",
  artStyle: "",
  narratorVoice: "alloy",
  isHealthTopic: false,
  voices: [
    { characterId: "c1", voice: "sage", voiceStyle: "calm and encouraging" },
    { characterId: "c2", voice: "verse", voiceStyle: "eager" },
    { characterId: "c3", voice: "coral", voiceStyle: "bright" },
    { characterId: "c4", voice: "echo", voiceStyle: "cheeky" },
    { characterId: "c5", voice: "shimmer", voiceStyle: "shy" },
  ],
  scenes: [
    {
      locationId: "l1",
      onStage: ["c1", "c2", "c3", "c4", "c5"],
      lines: [
        { speaker: "c1", text: "Good morning, team! Ready to move?" },
        { speaker: "c2", text: "Ready!" },
        { speaker: "c3", text: "Me too!" },
      ],
    },
    {
      locationId: "l1",
      onStage: ["c1", "c4", "c5"],
      lines: [
        { speaker: "c4", text: "Watch me stretch!" },
        { speaker: "c5", text: "I can balance now." },
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

  it("has small helpers for sizes, ids and the number of pictures", () => {
    expect([sizeForAge("child"), sizeForAge("teen"), sizeForAge("adult"), sizeForAge("older")]).toEqual([
      "small",
      "medium",
      "large",
      "large",
    ]);
    expect(nextId("c", [{ id: "c1" }, { id: "c3" }])).toBe("c4");
    expect(nextId("c", [{ id: "c1" }, { id: "c2" }])).toBe("c3");
    expect(picturesNeeded(physioPlan())).toBe(21);
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
            locationId: "somewhere else",
            onStage: ["c1", "c9", "A new nurse"],
            lines: [
              { speaker: "c1", text: "Hello everyone." },
              { speaker: "A new nurse", text: "I was never in the plan." },
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
        scenes: [{ locationId: "l1", onStage: ["c1", "c5"], lines: [{ speaker: "c5", text: "Hello!" }] }],
      }),
    );
    expect(story.characters.map((c) => c.name)).toEqual(["Ms. Kavya", "Diya", "Kabir", "Sara"]);
    const sara = story.characters.find((c) => c.name === "Sara");
    expect(sara?.voice).toBe("shimmer");
    expect(story.scenes[0].lines[0].speaker).toBe(sara?.id);
  });

  it("ends a health story with the disclaimer", () => {
    const story = buildStoryFromPlan(physioPlan(), script({ isHealthTopic: true }));
    expect(story.scenes.at(-1)?.lines.at(-1)).toEqual({ speaker: NARRATOR, text: HEALTH_DISCLAIMER });
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
