import { postJson } from "./api";
import {
  FactCheckResponseSchema,
  PictureCheckResponseSchema,
  type FactCheckResult,
  type PictureCheck,
} from "./quality";
import type { Texts } from "./translate";

/** Asks the server to check and fix a script's facts. */
export function checkFacts(
  kind: "explainer" | "story",
  language: string,
  texts: Texts,
  apiKey?: string,
): Promise<FactCheckResult> {
  return postJson("/api/check/facts", { kind, language, texts }, FactCheckResponseSchema, {
    apiKey: apiKey || undefined,
    timeoutMs: 75_000,
  });
}

/** Compares a drawing with its description. Resolves to null if the check could not be made. */
export async function checkDrawing(
  kind: "character" | "background" | "exercise",
  look: string,
  image: string,
  apiKey?: string,
): Promise<PictureCheck | null> {
  try {
    return await postJson("/api/check/picture", { kind, look, image }, PictureCheckResponseSchema, {
      apiKey: apiKey || undefined,
      timeoutMs: 65_000,
    });
  } catch {
    return null;
  }
}

/** The state of the fact check on a video page. */
export type FactsState =
  | { status: "none" }
  | { status: "checking" }
  | { status: "checked"; result: FactCheckResult; texts: string }
  | { status: "failed"; message: string };

/** A fingerprint of the words, to tell when they have changed since they were checked. */
export const textsKey = (texts: Texts) => JSON.stringify(texts);
