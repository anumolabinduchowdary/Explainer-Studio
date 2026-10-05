import { describe, expect, it } from "vitest";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { LIMITS, type SceneWire, type StoryboardWire } from "@/lib/schemas";
import {
  ensureDisclaimer,
  normalizePromptBuild,
  normalizeRegeneratedScene,
  normalizeScene,
  normalizeStoryboard,
} from "@/lib/server/normalize";

const scene = (overrides: Partial<SceneWire> = {}): SceneWire => ({
  id: "s1",
  durationSec: 8,
  heading: "A heading",
  body: "Some body text.",
  bullets: [],
  visual: "heart",
  transition: "fade",
  ...overrides,
});

const storyboard = (overrides: Partial<StoryboardWire> = {}): StoryboardWire => ({
  title: "A title",
  aspectRatio: "9:16",
  isHealthTopic: false,
  scenes: [scene({ id: "s1" }), scene({ id: "s2" })],
  ...overrides,
});

describe("normalizeStoryboard", () => {
  it("returns only the public storyboard fields", () => {
    const result = normalizeStoryboard(storyboard());
    expect(Object.keys(result).sort()).toEqual(["aspectRatio", "scenes", "title"]);
  });

  it("adds the disclaimer to the last scene of a health video", () => {
    const result = normalizeStoryboard(storyboard({ isHealthTopic: true }));
    expect(result.scenes[0].body).not.toContain(HEALTH_DISCLAIMER);
    expect(result.scenes[1].body).toBe(`Some body text. ${HEALTH_DISCLAIMER}`);
  });

  it("does not add the disclaimer to other videos", () => {
    const result = normalizeStoryboard(storyboard());
    expect(result.scenes.some((s) => s.body.includes(HEALTH_DISCLAIMER))).toBe(false);
  });

  it("renumbers duplicate scene ids", () => {
    const result = normalizeStoryboard(
      storyboard({ scenes: [scene({ id: "a" }), scene({ id: "a" }), scene({ id: "b" })] }),
    );
    expect(result.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("drops empty bullets and limits how many there are", () => {
    const bullets = ["one", " ", "two", "three", "four", "five", "six"];
    const result = normalizeStoryboard(storyboard({ scenes: [scene({ bullets })] }));
    expect(result.scenes[0].bullets).toEqual(["one", "two", "three", "four", "five"]);
  });

  it("rejects an empty storyboard, an empty heading and over-long text", () => {
    expect(() => normalizeStoryboard(storyboard({ scenes: [] }))).toThrow();
    expect(() => normalizeScene(scene({ heading: "  " }), "s1")).toThrow();
    expect(() => normalizeScene(scene({ body: "x".repeat(LIMITS.body + 1) }), "s1")).toThrow();
  });

  it("gives an untitled storyboard a title", () => {
    expect(normalizeStoryboard(storyboard({ title: "  " })).title).toBe("Untitled video");
  });
});

describe("ensureDisclaimer", () => {
  const base = normalizeScene(scene(), "s1");

  it("is added once, at the end, however the model wrote it", () => {
    const messy = { ...base, body: `for awareness, not medical advice. Thank you for watching.` };
    const result = ensureDisclaimer(messy);
    expect(result.body).toBe(`Thank you for watching. ${HEALTH_DISCLAIMER}`);
    expect(ensureDisclaimer(result).body).toBe(result.body);
  });

  it("never exceeds the body length limit", () => {
    const long = { ...base, body: "word ".repeat(80).trim().slice(0, LIMITS.body) };
    const result = ensureDisclaimer(long);
    expect(result.body.length).toBeLessThanOrEqual(LIMITS.body);
    expect(result.body.endsWith(HEALTH_DISCLAIMER)).toBe(true);
  });
});

describe("normalizeRegeneratedScene", () => {
  it("keeps the original id and the disclaimer", () => {
    const previous = ensureDisclaimer(normalizeScene(scene({ id: "s9" }), "s9"));
    const result = normalizeRegeneratedScene(scene({ id: "other", body: "A fresh take." }), previous);
    expect(result.id).toBe("s9");
    expect(result.body).toBe(`A fresh take. ${HEALTH_DISCLAIMER}`);
  });

  it("does not add a disclaimer that was not there", () => {
    const previous = normalizeScene(scene({ id: "s2" }), "s2");
    const result = normalizeRegeneratedScene(scene({ body: "A fresh take." }), previous);
    expect(result.body).toBe("A fresh take.");
  });
});

describe("normalizePromptBuild", () => {
  const ready = {
    status: "ready" as const,
    questions: [],
    actAs: "A teacher",
    goal: "Explain",
    context: "Parents",
    constraints: "",
    output: "A 60-second 9:16 video in 6 scenes",
  };
  const vague = {
    status: "needs_clarification" as const,
    questions: ["What is the video about?", " ", "Who is it for?", "How long?", "One too many?"],
    actAs: "",
    goal: "",
    context: "",
    constraints: "",
    output: "",
  };

  it("returns the prompt when it is ready", () => {
    const result = normalizePromptBuild(ready, { allowQuestions: true });
    expect(result).toEqual({
      status: "ready",
      prompt: {
        actAs: "A teacher",
        goal: "Explain",
        context: "Parents",
        constraints: "",
        output: "A 60-second 9:16 video in 6 scenes",
      },
    });
  });

  it("returns at most three questions", () => {
    const result = normalizePromptBuild(vague, { allowQuestions: true });
    expect(result).toEqual({
      status: "needs_clarification",
      questions: ["What is the video about?", "Who is it for?", "How long?"],
    });
  });

  it("rejects questions on the second pass so the caller retries", () => {
    expect(() => normalizePromptBuild(vague, { allowQuestions: false })).toThrow();
  });

  it("rejects a 'ready' answer with a missing required part", () => {
    expect(() => normalizePromptBuild({ ...ready, goal: " " }, { allowQuestions: true })).toThrow();
  });
});
