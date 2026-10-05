import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import samplePrompt from "@/examples/cerebral-palsy.prompt.json";
import sampleStoryboard from "@/examples/cerebral-palsy.storyboard.json";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { assemblePrompt } from "@/lib/prompt";
import { locate, totalDuration } from "@/lib/renderer";
import {
  FiveStepPromptSchema,
  PromptBuildWireSchema,
  SceneSchema,
  SceneWireSchema,
  StoryboardSchema,
  StoryboardWireSchema,
} from "@/lib/schemas";
import { VISUAL_IDS } from "@/lib/visuals";

describe("example run", () => {
  it("has a valid 5-step prompt", () => {
    expect(FiveStepPromptSchema.safeParse(samplePrompt).success).toBe(true);
  });

  it("has a valid storyboard that matches the brief", () => {
    const storyboard = StoryboardSchema.parse(sampleStoryboard);
    expect(storyboard.aspectRatio).toBe("9:16");
    expect(storyboard.scenes).toHaveLength(12);
    expect(totalDuration(storyboard)).toBe(120);
    expect(storyboard.scenes.at(-1)?.body.endsWith(HEALTH_DISCLAIMER)).toBe(true);
    expect(new Set(storyboard.scenes.map((s) => s.id)).size).toBe(12);
  });
});

describe("assemblePrompt", () => {
  const prompt = FiveStepPromptSchema.parse(samplePrompt);

  it("lists the five parts in order", () => {
    const text = assemblePrompt(prompt);
    const order = ["ACT AS\n", "GOAL\n", "CONTEXT\n", "CONSTRAINTS\n", "OUTPUT\n"].map((h) =>
      text.indexOf(h),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves out Constraints when it is empty", () => {
    const text = assemblePrompt({ ...prompt, constraints: "   " });
    expect(text).not.toContain("CONSTRAINTS");
    expect(text).toContain("OUTPUT\n");
  });
});

describe("schemas", () => {
  it("requires the four mandatory parts but not Constraints", () => {
    const base = { actAs: "a", goal: "b", context: "c", constraints: "", output: "d" };
    expect(FiveStepPromptSchema.safeParse(base).success).toBe(true);
    for (const key of ["actAs", "goal", "context", "output"] as const) {
      expect(FiveStepPromptSchema.safeParse({ ...base, [key]: "  " }).success).toBe(false);
    }
  });

  it("only accepts illustrations from the library", () => {
    const scene = {
      id: "s1",
      durationSec: 8,
      heading: "Hello",
      body: "",
      bullets: [],
      visual: "unicorn",
      transition: "fade",
    };
    expect(SceneSchema.safeParse(scene).success).toBe(false);
    expect(SceneSchema.safeParse({ ...scene, visual: VISUAL_IDS[0] }).success).toBe(true);
  });

  it("keeps scene durations within range", () => {
    const scene = {
      id: "s1",
      heading: "Hello",
      body: "",
      bullets: [],
      visual: "heart",
      transition: "fade",
    };
    expect(SceneSchema.parse({ ...scene, durationSec: 0.2 }).durationSec).toBe(2);
    expect(SceneSchema.parse({ ...scene, durationSec: 500 }).durationSec).toBe(30);
    expect(SceneSchema.parse({ ...scene, durationSec: 7.26 }).durationSec).toBe(7.5);
  });

  it("converts to strict JSON Schema for Structured Outputs", () => {
    for (const schema of [PromptBuildWireSchema, SceneWireSchema, StoryboardWireSchema]) {
      const format = zodTextFormat(schema, "test");
      expect(format.type).toBe("json_schema");
      expect(format.strict).toBe(true);
      assertStrict(format.schema as JsonSchema);
    }
    const storyboard = zodTextFormat(StoryboardWireSchema, "storyboard").schema as JsonSchema;
    const visual = storyboard.properties?.scenes?.items?.properties?.visual;
    expect(visual?.enum).toEqual([...VISUAL_IDS]);
  });
});

type JsonSchema = {
  type?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

/** Every object must list all its properties as required and forbid extras. */
function assertStrict(schema: JsonSchema) {
  if (schema.type === "object") {
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required ?? [])].sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
    Object.values(schema.properties ?? {}).forEach(assertStrict);
  }
  if (schema.items) assertStrict(schema.items);
}

describe("timeline", () => {
  const storyboard = StoryboardSchema.parse(sampleStoryboard);

  it("finds the scene for a moment in time", () => {
    expect(locate(storyboard, 0)).toEqual({ index: 0, local: 0 });
    expect(locate(storyboard, 8).index).toBe(1);
    expect(locate(storyboard, 119.9).index).toBe(11);
    expect(locate(storyboard, 500)).toEqual({ index: 11, local: 10 });
  });
});
