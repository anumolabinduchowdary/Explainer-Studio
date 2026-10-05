import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_CHARS, TranscribeRequestSchema } from "@/lib/schemas";
import type { OpenAIClient } from "@/lib/server/openai";
import { transcribeAudio } from "@/lib/server/transcribe";

const WEBM = "data:audio/webm;codecs=opus;base64,QUJD";

beforeEach(() => {
  vi.stubEnv("OPENAI_TRANSCRIBE_MODEL", "test-transcribe-model");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeTranscriber(text = "  A video about washing hands.  ") {
  const create = vi.fn(async () => ({ text }));
  const client = { audio: { transcriptions: { create } } } as unknown as OpenAIClient;
  return { client, create };
}

describe("speaking instead of typing", () => {
  it("accepts the recordings browsers make and rejects anything else", () => {
    for (const audio of [WEBM, "data:audio/webm;base64,QUJD", "data:audio/mp4;base64,QUJD"]) {
      expect(TranscribeRequestSchema.safeParse({ audio }).success).toBe(true);
    }
    for (const audio of [
      "data:video/webm;base64,QUJD",
      "data:audio/webm;base64,not base64!",
      "https://example.org/speech.webm",
      `data:audio/webm;base64,${"A".repeat(MAX_AUDIO_CHARS)}`,
    ]) {
      expect(TranscribeRequestSchema.safeParse({ audio }).success).toBe(false);
    }
  });

  it("sends the recording to the configured model as a named audio file and tidies the words", async () => {
    const { client, create } = fakeTranscriber();
    await expect(transcribeAudio(client, WEBM)).resolves.toBe("A video about washing hands.");
    const [params] = create.mock.calls[0] as unknown as [{ model: string; file: File }];
    expect(params.model).toBe("test-transcribe-model");
    expect(params.file).toBeInstanceOf(File);
    expect(params.file.name).toBe("speech.webm");
    expect(params.file.type).toBe("audio/webm");
    expect(Buffer.from(await params.file.arrayBuffer()).toString()).toBe("ABC");
  });

  it("names Safari's recordings correctly too", async () => {
    const { client, create } = fakeTranscriber();
    await transcribeAudio(client, "data:audio/mp4;base64,QUJD");
    const [params] = create.mock.calls[0] as unknown as [{ file: File }];
    expect(params.file.name).toBe("speech.mp4");
  });

  it("fails clearly when the model is not set or the recording is not sound", async () => {
    const { client, create } = fakeTranscriber();
    await expect(transcribeAudio(client, "data:audio/flac;base64,QUJD")).rejects.toMatchObject({
      code: "invalid_input",
    });
    vi.stubEnv("OPENAI_TRANSCRIBE_MODEL", "");
    await expect(transcribeAudio(client, WEBM)).rejects.toMatchObject({
      code: "server_misconfigured",
      message: expect.stringContaining("OPENAI_TRANSCRIBE_MODEL"),
    });
    expect(create).not.toHaveBeenCalled();
  });
});
