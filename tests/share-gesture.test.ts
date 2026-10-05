import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_DISCLAIMER, SOCIAL_HANDLE } from "@/lib/config";
import { generatePicture, imagePrompt } from "@/lib/server/images";
import type { OpenAIClient } from "@/lib/server/openai";
import { suggestCaption } from "@/lib/share";
import { ImageRequestSchema, isGesturing, pictureKey, type ImageRequest } from "@/lib/story";

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
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it("comes and goes while a long line is spoken, the same way every time", () => {
    const line = { speaker: "c1", text: "Starting therapy early helps children build strength and skills." };
    const timing = { duration: 5, speechStart: 0.2, speechEnd: 4.6 };
    const samples = Array.from({ length: 44 }, (_, i) => isGesturing(line, 0.2 + i * 0.1, timing));
    const share = samples.filter(Boolean).length / samples.length;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
    // No flickering: a gesture, once started, lasts about a second.
    const changes = samples.filter((on, i) => i > 0 && on !== samples[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(4);
    expect(samples).toEqual(Array.from({ length: 44 }, (_, i) => isGesturing(line, 0.2 + i * 0.1, timing)));
  });

  it("holds or skips the gesture for the whole of a short line", () => {
    const timing = { duration: 1.4, speechStart: 0, speechEnd: 0.9 };
    for (const text of ["Hi!", "Watch me!", "No."]) {
      const line = { speaker: "c1", text };
      const samples = [0, 0.3, 0.6, 0.85].map((t) => isGesturing(line, t, timing));
      expect(new Set(samples).size).toBe(1);
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

  it("still reads well without a title", () => {
    expect(suggestCaption({ title: "  ", health: false, aiVoices: false })).toMatch(/^A short explainer/);
  });
});
