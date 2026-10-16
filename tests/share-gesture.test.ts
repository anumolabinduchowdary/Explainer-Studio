import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_DISCLAIMER, SOCIAL_HANDLE } from "@/lib/config";
import { generatePicture, imagePrompt } from "@/lib/server/images";
import type { OpenAIClient } from "@/lib/server/openai";
import { suggestCaption } from "@/lib/share";
import {
  GESTURE_BLEND_SEC,
  ImageRequestSchema,
  NO_GESTURE,
  gestureAt,
  gestureSpans,
  pictureKey,
  type ImageRequest,
} from "@/lib/story";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const request = (overrides: Partial<ImageRequest> = {}): ImageRequest => ({
  kind: "gesture",
  look: "A cheerful boy with a blue walker.",
  artStyle: "flat cartoon",
  aspectRatio: "9:16",
  reference: PNG,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("OPENAI_IMAGE_MODEL", "test-image-model");
  vi.stubEnv("OPENAI_IMAGE_EDIT_MODEL", "test-edit-model");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hand gestures", () => {
  it("needs the standing picture to redraw from", () => {
    expect(ImageRequestSchema.safeParse(request()).success).toBe(true);
    expect(ImageRequestSchema.safeParse(request({ reference: undefined })).success).toBe(false);
  });

  it("asks for the same character with one hand raised, keeping any mobility aid", () => {
    const prompt = imagePrompt(request());
    expect(prompt).toContain("A cheerful boy with a blue walker.");
    expect(prompt).toContain("exactly the same character");
    expect(prompt).toContain("open palm");
    expect(prompt).toContain("keep a hand on it");
    expect(prompt).toContain("transparent");
  });

  it("is drawn by editing the reference picture", async () => {
    const result = { data: [{ b64_json: "QUJD" }] };
    const generate = vi.fn(async () => result);
    const edit = vi.fn(async () => result);
    const client = { images: { generate, edit } } as unknown as OpenAIClient;
    await generatePicture(client, request());
    expect(generate).not.toHaveBeenCalled();
    const [params] = edit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params).toMatchObject({ model: "test-edit-model", background: "transparent" });
  });

  it("has its own pictures, separate from the standing pose", () => {
    const keys = [
      pictureKey.character("c1"),
      pictureKey.talking("c1"),
      pictureKey.gesture("c1"),
      pictureKey.gestureTalking("c1"),
      pictureKey.explain("c1"),
      pictureKey.explainTalking("c1"),
    ];
    expect(new Set(keys).size).toBe(6);
  });

  const longLine = { speaker: "c1", text: "Starting therapy early helps children build strength, balance and confidence every day." };
  const longTiming = { duration: 6, speechStart: 0.2, speechEnd: 5.6 };
  const sample = (poses: number) =>
    Array.from({ length: 54 }, (_, i) => gestureAt(longLine, 0.2 + i * 0.1, longTiming, poses));

  it("comes and goes while a long line is spoken, the same way every time", () => {
    const samples = sample(2);
    const raised = samples.filter((moment) => moment.pose !== NO_GESTURE).length / samples.length;
    expect(raised).toBeGreaterThan(0.3);
    expect(raised).toBeLessThan(0.8);
    expect(sample(2)).toEqual(samples);
    // Each gesture lasts most of a second or more, with rests between, inside the spoken part.
    const spans = gestureSpans(longLine, longTiming, 2);
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const [i, span] of spans.entries()) {
      expect(span.end - span.start).toBeGreaterThan(0.5);
      expect(span.start).toBeGreaterThanOrEqual(longTiming.speechStart);
      expect(span.end).toBeLessThanOrEqual(longTiming.speechEnd);
      if (i > 0) expect(span.start - spans[i - 1].end).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("uses both gesture poses when a character has two, and only real poses", () => {
    const poses = new Set(
      ["One two three four five six seven eight nine ten eleven twelve.", "Look at how strong your legs are getting now!", "We can practise together every single morning."]
        .flatMap((text) => gestureSpans({ speaker: "c1", text }, longTiming, 2).map((span) => span.pose)),
    );
    expect([...poses].sort()).toEqual([0, 1]);
    expect(gestureSpans(longLine, longTiming, 1).every((span) => span.pose === 0)).toBe(true);
    expect(gestureSpans(longLine, longTiming, 0)).toEqual([]);
  });

  it("blends smoothly into and out of each gesture instead of jumping", () => {
    const [span] = gestureSpans(longLine, longTiming, 2);
    const starting = gestureAt(longLine, span.start + GESTURE_BLEND_SEC / 2, longTiming, 2);
    expect(starting).toMatchObject({ pose: span.pose, from: NO_GESTURE });
    expect(starting.blend).toBeCloseTo(0.5, 5);
    expect(gestureAt(longLine, span.start + GESTURE_BLEND_SEC * 2, longTiming, 2)).toEqual({ pose: span.pose, from: NO_GESTURE, blend: 1 });
    const ending = gestureAt(longLine, span.end + GESTURE_BLEND_SEC / 2, longTiming, 2);
    expect(ending).toMatchObject({ pose: NO_GESTURE, from: span.pose });
    expect(ending.blend).toBeCloseTo(0.5, 5);
  });

  it("gives a short line one gesture through its middle, or none", () => {
    const timing = { duration: 1.4, speechStart: 0, speechEnd: 0.9 };
    for (const text of ["Hi!", "Watch me!", "No.", "Yes!", "Me too!"]) {
      const spans = gestureSpans({ speaker: "c1", text }, timing, 2);
      expect(spans.length).toBeLessThanOrEqual(1);
      for (const span of spans) {
        expect(span.start).toBeGreaterThan(0);
        expect(span.end).toBeLessThan(0.9);
      }
    }
  });
});

describe("suggested caption", () => {
  it("leads with the title and ends with the account to follow", () => {
    const caption = suggestCaption({ title: "Understanding Cerebral Palsy", health: false, aiVoices: false });
    expect(caption.split("\n\n")).toEqual([
      "Understanding Cerebral Palsy",
      `Follow ${SOCIAL_HANDLE} for more.`,
    ]);
  });

  it("carries the health disclaimer and the AI-voice statement when they apply", () => {
    const caption = suggestCaption({ title: "A story", health: true, aiVoices: true });
    expect(caption).toContain(HEALTH_DISCLAIMER);
    expect(caption).toContain("AI-generated");
    expect(suggestCaption({ title: "A story", health: true, aiVoices: false })).not.toContain("AI-generated");
  });

  it("mentions the account only when the video ends with its QR card", () => {
    const caption = suggestCaption({ title: "Ramayan in a minute", health: false, aiVoices: true, follow: false });
    expect(caption).not.toContain(SOCIAL_HANDLE);
    expect(caption).toContain("AI-generated");
    expect(suggestCaption({ title: "CP explained", health: true, aiVoices: false, follow: true })).toContain(SOCIAL_HANDLE);
  });

  it("still reads well without a title", () => {
    expect(suggestCaption({ title: "  ", health: false, aiVoices: false })).toMatch(/^A short explainer/);
  });
});
