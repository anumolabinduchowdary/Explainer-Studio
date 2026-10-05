import { HEALTH_DISCLAIMER, SOCIAL_HANDLE } from "./config";

/**
 * A starting caption for a finished video. It carries the two statements a
 * shared video needs: the health disclaimer, and (when AI voices are used)
 * that the voices are computer-generated.
 */
export function suggestCaption(video: { title: string; health: boolean; aiVoices: boolean }): string {
  const notes = [
    video.health ? HEALTH_DISCLAIMER : "",
    video.aiVoices ? "The voices in this video are AI-generated." : "",
  ].filter(Boolean);
  return [
    video.title.trim() || "A short explainer",
    notes.join(" "),
    `Follow ${SOCIAL_HANDLE} for more.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
