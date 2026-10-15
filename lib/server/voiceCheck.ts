import "server-only";
import { languageCode } from "@/lib/languages";
import { VOICE_MATCH_THRESHOLD, mainScript, similarity, type VoiceCheck } from "@/lib/quality";
import type { OpenAIClient } from "./openai";
import { canTranscribe, transcribeAudio } from "./transcribe";

/**
 * Listens to a recorded line and compares what was heard with what was
 * written. Returns null when the line cannot be checked (speech-to-text is
 * not set up, failed, or wrote the words in another script).
 */
export async function hearLine(
  client: OpenAIClient,
  text: string,
  audio: string,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<number | null> {
  if (!canTranscribe()) return null;
  let heard: string;
  try {
    heard = await transcribeAudio(client, audio, signal, language ? languageCode(language) : undefined);
  } catch {
    return null;
  }
  // Speech-to-text sometimes writes Indian languages in Latin letters; those cannot be compared fairly.
  if (mainScript(text) !== mainScript(heard)) return null;
  return similarity(text, heard);
}

/**
 * Records a line and listens back. If the words were not heard as written,
 * the line is recorded once more, asking for clearer speech, and the better
 * of the two is kept.
 */
export async function speakAndCheck(
  speak: (extraDirection?: string) => Promise<string>,
  hear: (audio: string) => Promise<number | null>,
): Promise<{ audio: string; check: VoiceCheck }> {
  const first = await speak();
  const firstScore = await hear(first);
  if (firstScore === null) return { audio: first, check: { result: "skipped", retried: false } };
  if (firstScore >= VOICE_MATCH_THRESHOLD) return { audio: first, check: { result: "ok", score: firstScore, retried: false } };

  const second = await speak("Say every word clearly and correctly, exactly as written, at a natural pace.");
  const secondScore = await hear(second);
  if (secondScore !== null && secondScore > firstScore) {
    return { audio: second, check: { result: secondScore >= VOICE_MATCH_THRESHOLD ? "ok" : "unclear", score: secondScore, retried: true } };
  }
  return { audio: first, check: { result: "unclear", score: firstScore, retried: true } };
}
