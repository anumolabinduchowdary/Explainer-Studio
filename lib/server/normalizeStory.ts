import { HEALTH_DISCLAIMER } from "@/lib/config";
import {
  DEFAULT_ART_STYLE,
  NARRATOR,
  STORY_LIMITS,
  StorySchema,
  type Story,
  type StoryLine,
  type StoryWire,
} from "@/lib/story";

const clip = (text: string, max: number) => text.trim().slice(0, max);

/** Gives every item a short, unique id and remembers what the model called it. */
function assignIds<T extends { id: string }>(items: T[], prefix: string) {
  const renamed = new Map<string, string>();
  const result = items.map((item, i) => {
    const id = `${prefix}${i + 1}`;
    const original = item.id.trim();
    if (original && !renamed.has(original)) renamed.set(original, id);
    return { ...item, id };
  });
  return { items: result, renamed };
}

/**
 * Turns the model's raw story into the validated shape the app uses: tidy
 * ids, no dangling references, sensible limits and the health disclaimer.
 * Throws when the story is unusable, which makes the caller retry.
 */
export function normalizeStory(wire: StoryWire): Story {
  const cast = assignIds(
    wire.characters
      .filter((c) => c.look.trim() || c.name.trim())
      .slice(0, STORY_LIMITS.characters),
    "c",
  );
  const places = assignIds(
    wire.locations.filter((l) => l.look.trim() || l.name.trim()).slice(0, STORY_LIMITS.locations),
    "l",
  );
  if (cast.items.length === 0) throw new Error("The story has no characters.");
  if (places.items.length === 0) throw new Error("The story has no locations.");

  const scenes = wire.scenes
    .slice(0, STORY_LIMITS.scenes)
    .map((scene) => {
      const lines: StoryLine[] = scene.lines
        .map((line) => ({
          // Anything that is not a known character is read by the narrator.
          speaker: cast.renamed.get(line.speaker.trim()) ?? NARRATOR,
          text: clip(line.text, STORY_LIMITS.lineText),
        }))
        .filter((line) => line.text.length > 0)
        .slice(0, STORY_LIMITS.linesPerScene - 1);

      // Whoever speaks must be on stage; speakers come first if space is tight.
      const speakers = lines.map((line) => line.speaker).filter((s) => s !== NARRATOR);
      const listed = scene.onStage
        .map((id) => cast.renamed.get(id.trim()))
        .filter((id): id is string => Boolean(id));
      const onStage = [...new Set([...speakers, ...listed])].slice(0, STORY_LIMITS.onStage);
      for (const line of lines) {
        if (line.speaker !== NARRATOR && !onStage.includes(line.speaker)) line.speaker = NARRATOR;
      }

      return {
        id: "",
        locationId: places.renamed.get(scene.locationId.trim()) ?? places.items[0].id,
        onStage,
        lines,
      };
    })
    .filter((scene) => scene.lines.length > 0)
    .map((scene, i) => ({ ...scene, id: `s${i + 1}` }));

  if (scenes.length === 0) throw new Error("The story has no scenes with lines.");

  if (wire.isHealthTopic) {
    const last = scenes[scenes.length - 1];
    const pattern = new RegExp(HEALTH_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    last.lines = last.lines
      .map((line) => ({ ...line, text: line.text.replace(pattern, "").replace(/\s+/g, " ").trim() }))
      .filter((line) => line.text.length > 0);
    last.lines.push({ speaker: NARRATOR, text: HEALTH_DISCLAIMER });
  }

  return StorySchema.parse({
    title: clip(wire.title, STORY_LIMITS.title) || "Untitled story",
    aspectRatio: wire.aspectRatio,
    artStyle: clip(wire.artStyle, STORY_LIMITS.artStyle) || DEFAULT_ART_STYLE,
    narratorVoice: wire.narratorVoice,
    characters: cast.items.map((c) => ({
      id: c.id,
      name: clip(c.name, STORY_LIMITS.name) || "Character",
      look: clip(c.look, STORY_LIMITS.look),
      size: c.size,
      voice: c.voice,
      voiceAge: c.voiceAge,
      voiceStyle: clip(c.voiceStyle, STORY_LIMITS.voiceStyle),
    })),
    locations: places.items.map((l) => ({
      id: l.id,
      name: clip(l.name, STORY_LIMITS.name) || "Place",
      look: clip(l.look, STORY_LIMITS.look),
    })),
    scenes,
  });
}
