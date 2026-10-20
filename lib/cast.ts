import { z } from "zod";
import { ASPECT_RATIOS } from "./schemas";
import {
  CHARACTER_SIZES,
  EMOTIONS,
  STORY_LIMITS,
  VOICE_AGES,
  pictureKey,
  type Story,
  type StoryCharacter,
  type StoryLocation,
} from "./story";

/**
 * A saved cast: the characters of a story, with every picture drawn of them
 * (standing, talking, gestures, faces, flying), their voices, the places,
 * and the drawing style, in one file on the person's own computer.
 *
 * Loading it into a new story reuses those pictures instead of drawing new
 * ones, so a series keeps the same characters from episode to episode (and
 * costs far fewer pictures). Nothing is uploaded: the file is saved and read
 * in the browser.
 */

export const CAST_FILE_APP = "explainer-studio-cast";
export const CAST_FILE_VERSION = 1;
/** The largest cast file the app will read (about 12 characters with every pose, and their places). */
export const MAX_CAST_FILE_BYTES = 80_000_000;

const picture = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Not a picture.");

/** The poses a saved character can have, by a name that does not depend on the story's ids. */
const poseName = z.string().regex(/^(character|talking|gesture|gesture-talking|explain|explain-talking|flying|expression(-talking)?:[a-z]+)$/);

export const CastFileSchema = z.object({
  app: z.literal(CAST_FILE_APP),
  version: z.literal(CAST_FILE_VERSION),
  savedAt: z.string().max(40),
  /** The story it was saved from, to show when loading. */
  title: z.string().max(STORY_LIMITS.title),
  artStyle: z.string().max(STORY_LIMITS.artStyle),
  characters: z
    .array(
      z.object({
        name: z.string().max(STORY_LIMITS.name),
        look: z.string().max(STORY_LIMITS.look),
        size: z.enum(CHARACTER_SIZES),
        voice: z.string().max(60),
        voiceAge: z.enum(VOICE_AGES),
        voiceStyle: z.string().max(STORY_LIMITS.voiceStyle),
        pictures: z.record(poseName, picture),
      }),
    )
    .max(12),
  places: z
    .array(
      z.object({
        name: z.string().max(STORY_LIMITS.name),
        look: z.string().max(STORY_LIMITS.look),
        aspectRatio: z.enum(ASPECT_RATIOS),
        picture,
      }),
    )
    .max(12),
});
export type CastFile = z.infer<typeof CastFileSchema>;

/** Every pose a character can have: its name in the file, and its picture key in a story. */
export function characterPoses(characterId: string): Array<[pose: string, key: string]> {
  const faces = EMOTIONS.filter((emotion) => emotion !== "neutral").flatMap((emotion): Array<[string, string]> => [
    [`expression:${emotion}`, pictureKey.expression(characterId, emotion)],
    [`expression-talking:${emotion}`, pictureKey.expressionTalking(characterId, emotion)],
  ]);
  return [
    ["character", pictureKey.character(characterId)],
    ["talking", pictureKey.talking(characterId)],
    ["gesture", pictureKey.gesture(characterId)],
    ["gesture-talking", pictureKey.gestureTalking(characterId)],
    ["explain", pictureKey.explain(characterId)],
    ["explain-talking", pictureKey.explainTalking(characterId)],
    ["flying", pictureKey.flying(characterId)],
    ...faces,
  ];
}

/**
 * Builds the cast file for a story. `pictureOf` gives the drawn picture for a
 * key (as a data URL), or nothing. Characters without a standing picture and
 * places without a background are left out.
 */
export function buildCastFile(story: Story, pictureOf: (key: string) => string | undefined, savedAt: Date): CastFile {
  const characters = story.characters.flatMap((character) => {
    const pictures: Record<string, string> = {};
    for (const [pose, key] of characterPoses(character.id)) {
      const dataUrl = pictureOf(key);
      if (dataUrl) pictures[pose] = dataUrl;
    }
    if (!pictures.character) return [];
    const { name, look, size, voice, voiceAge, voiceStyle } = character;
    return [{ name, look, size, voice, voiceAge, voiceStyle, pictures }];
  });
  const places = story.locations.flatMap((location) => {
    const dataUrl = pictureOf(pictureKey.place(location.id));
    return dataUrl ? [{ name: location.name, look: location.look, aspectRatio: story.aspectRatio, picture: dataUrl }] : [];
  });
  return {
    app: CAST_FILE_APP,
    version: CAST_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    title: story.title,
    artStyle: story.artStyle,
    characters,
    places,
  };
}

/** Reads a cast file's text. Throws a plain message if it is not a cast saved by this app. */
export function parseCastFile(text: string): CastFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a saved cast from this app.");
  }
  const parsed = CastFileSchema.safeParse(data);
  if (!parsed.success) throw new Error("That file isn't a saved cast from this app, or it was damaged.");
  return parsed.data;
}

const simple = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length > 2));

/** How alike two descriptions are, from 0 (no shared words) to 1. */
function alike(a: string, b: string): number {
  const first = words(a);
  const second = words(b);
  if (first.size === 0 || second.size === 0) return 0;
  let shared = 0;
  for (const word of first) if (second.has(word)) shared += 1;
  return shared / Math.min(first.size, second.size);
}

/**
 * Suggests which saved character goes with which character in the story
 * (and the same for places): the same name first, otherwise the most alike
 * description. Each one is used at most once. Null means "don't use it".
 */
export function matchCast(
  story: Story,
  cast: CastFile,
): { characters: Array<string | null>; places: Array<string | null> } {
  const pick = <T extends { name: string; look: string }>(
    saved: Array<{ name: string; look: string }>,
    items: Array<T & { id: string }>,
  ): Array<string | null> => {
    const taken = new Set<string>();
    const result: Array<string | null> = saved.map((entry) => {
      const byName = items.find((item) => !taken.has(item.id) && simple(item.name) !== "" && simple(item.name) === simple(entry.name));
      if (byName) taken.add(byName.id);
      return byName?.id ?? null;
    });
    saved.forEach((entry, i) => {
      if (result[i]) return;
      let best: { id: string; score: number } | null = null;
      for (const item of items) {
        if (taken.has(item.id)) continue;
        const score = alike(entry.look, item.look);
        if (score >= 0.5 && (!best || score > best.score)) best = { id: item.id, score };
      }
      if (best) {
        taken.add(best.id);
        result[i] = best.id;
      }
    });
    return result;
  };
  return {
    characters: pick<StoryCharacter>(cast.characters, story.characters),
    places: pick<StoryLocation>(cast.places, story.locations),
  };
}

/**
 * The story with the chosen saved characters and places put in: their
 * descriptions, sizes and voices (a voice only if this story's voice service
 * has it) and the saved drawing style, so the saved pictures count as up to date.
 */
export function storyWithCast(
  story: Story,
  cast: CastFile,
  choice: { characters: Array<string | null>; places: Array<string | null> },
  hasVoice: (voice: string) => boolean,
): Story {
  const savedFor = new Map(choice.characters.flatMap((id, i) => (id ? [[id, cast.characters[i]] as const] : [])));
  const placeFor = new Map(choice.places.flatMap((id, i) => (id ? [[id, cast.places[i]] as const] : [])));
  return {
    ...story,
    artStyle: cast.artStyle,
    characters: story.characters.map((character) => {
      const saved = savedFor.get(character.id);
      if (!saved) return character;
      return {
        ...character,
        look: saved.look,
        size: saved.size,
        voiceAge: saved.voiceAge,
        voiceStyle: saved.voiceStyle,
        ...(hasVoice(saved.voice) ? { voice: saved.voice } : {}),
      };
    }),
    locations: story.locations.map((location) => {
      const saved = placeFor.get(location.id);
      return saved ? { ...location, look: saved.look } : location;
    }),
  };
}
