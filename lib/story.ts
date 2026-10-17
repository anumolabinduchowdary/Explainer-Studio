import { z } from "zod";
import { VoiceCheckSchema } from "./quality";
import { ASPECT_RATIOS } from "./schemas";

/**
 * "Cartoon stories": short dialogue videos where AI-drawn characters stand in
 * AI-drawn backgrounds and talk in word-by-word captions.
 */

export const NARRATOR = "narrator";
export const CHARACTER_SIZES = ["small", "medium", "large"] as const;

/**
 * OpenAI's built-in voices. OpenAI does not describe how each one sounds, so
 * the hints below are informal impressions that help pick a sensible default.
 * People choose by listening.
 *
 * The story writer always casts from this list. When another voice service is
 * set up on the server, each choice is swapped for one of that service's
 * voices of the same gender and age (see lib/voices.ts).
 */
export const VOICES = [
  { id: "marin", group: "women", hint: "female, warm" },
  { id: "coral", group: "women", hint: "female, bright" },
  { id: "sage", group: "women", hint: "female, calm" },
  { id: "nova", group: "women", hint: "female, lively" },
  { id: "shimmer", group: "women", hint: "female, soft" },
  { id: "cedar", group: "men", hint: "male, warm" },
  { id: "ash", group: "men", hint: "male, friendly" },
  { id: "echo", group: "men", hint: "male, steady" },
  { id: "verse", group: "men", hint: "male, expressive" },
  { id: "ballad", group: "men", hint: "male, gentle" },
  { id: "fable", group: "men", hint: "male, storyteller" },
  { id: "onyx", group: "men", hint: "male, deep" },
  { id: "alloy", group: "neutral", hint: "neutral" },
] as const;

export const VOICE_GROUPS = [
  { id: "women", label: "Women's voices" },
  { id: "men", label: "Men's voices" },
  { id: "neutral", label: "Neutral voice" },
] as const;

/**
 * Ages. Most voices are adults, so other ages are approximated in two ways at
 * once: the voice is asked to act the age (`manner`), and the finished
 * recording is played back faster or slower (`rate`), which raises or lowers
 * the pitch the way a smaller or older voice sounds. `pace` is the speaking
 * speed asked of services that have a speed control instead of acting
 * instructions; it offsets the speed-up or slow-down that `rate` causes.
 */
export const VOICE_AGES = ["child", "teen", "adult", "older"] as const;
export type VoiceAge = (typeof VOICE_AGES)[number];

export const VOICE_AGE_SETTINGS: Record<
  VoiceAge,
  { label: string; rate: number; pace: number; manner: string }
> = {
  child: {
    label: "Child",
    rate: 1.12,
    pace: 0.93,
    // A child's voice comes from shorter vocal cords and a smaller throat: higher,
    // lighter and brighter, with less resonance and depth. A small pitch shift
    // (rate) supplies the "smaller" sound and the acting does the rest; a large
    // shift sounds artificial. The shift also speeds the line up a little, which
    // the relaxed pace makes up for. Deliberately not asked to mispronounce
    // words: unclear speech could read as mocking a speech difficulty.
    manner:
      "a young child of about six. The voice is high, light and bright, with very little chest resonance, eager and full of wonder, like a real child chatting, at a relaxed pace",
  },
  teen: {
    label: "Teenager",
    rate: 1.04,
    pace: 0.98,
    manner: "a teenager, with a young, lively, casual voice",
  },
  adult: { label: "Adult", rate: 1, pace: 1, manner: "" },
  older: {
    label: "Older person",
    rate: 0.95,
    pace: 1,
    manner:
      "an elderly person in their seventies, with a gentle, slightly aged voice, warm and unhurried, with small pauses",
  },
};
export type VoiceId = (typeof VOICES)[number]["id"];
export const VOICE_IDS = VOICES.map((voice) => voice.id) as [VoiceId, ...VoiceId[]];
export const DEFAULT_NARRATOR_VOICE: VoiceId = "alloy";

export const DEFAULT_ART_STYLE =
  "2D cartoon for a friendly educational video: bold dark outlines, flat bright colours with simple cel shading, rounded shapes and big expressive eyes";

export const STORY_LIMITS = {
  title: 120,
  artStyle: 300,
  name: 40,
  look: 400,
  lineText: 160,
  delivery: 80,
  voice: 80,
  voiceStyle: 160,
  characters: 6,
  locations: 4,
  scenes: 12,
  linesPerScene: 10,
  onStage: 5,
} as const;

const id = z.string().trim().min(1).max(40);
/**
 * The name of a voice. Which names exist depends on the voice service the
 * server uses, so the server checks it when a line is spoken.
 */
const voiceName = z.string().trim().min(1).max(STORY_LIMITS.voice);

export const StoryCharacterSchema = z.object({
  id,
  name: z.string().trim().max(STORY_LIMITS.name),
  /** What the artist should draw. */
  look: z.string().trim().max(STORY_LIMITS.look),
  size: z.enum(CHARACTER_SIZES),
  voice: voiceName,
  /** The character's age group, which shapes how the voice is acted and pitched. */
  voiceAge: z.enum(VOICE_AGES),
  /** How the character sounds, in a few words: mood, pace, personality. */
  voiceStyle: z.string().trim().max(STORY_LIMITS.voiceStyle),
});
export type StoryCharacter = z.infer<typeof StoryCharacterSchema>;

export const StoryLocationSchema = z.object({
  id,
  name: z.string().trim().max(STORY_LIMITS.name),
  look: z.string().trim().max(STORY_LIMITS.look),
});
export type StoryLocation = z.infer<typeof StoryLocationSchema>;

export const StoryLineSchema = z.object({
  /** A character id, or "narrator". */
  speaker: id,
  text: z.string().trim().max(STORY_LIMITS.lineText),
  /** How the line is said, e.g. "surprised, then laughing". Helps the voice sound natural. */
  how: z.string().trim().max(STORY_LIMITS.delivery).optional(),
});
export type StoryLine = z.infer<typeof StoryLineSchema>;

/**
 * A card shown above the characters in a home exercise programme: a picture
 * of the exercise, its name and how many times or how long to do it.
 */
export const ExerciseCardSchema = z.object({
  title: z.string().trim().max(60),
  /** How much, e.g. "10 times, 2 rounds" or "Hold for 5 seconds". */
  dose: z.string().trim().max(80),
  /** What the picture shows. */
  look: z.string().trim().max(STORY_LIMITS.look),
  /** A safety note from the therapist, if any. */
  caution: z.string().trim().max(160).optional(),
});
export type ExerciseCard = z.infer<typeof ExerciseCardSchema>;

export const StorySceneSchema = z.object({
  id,
  locationId: id,
  /** Home exercise programmes: the exercise shown in this scene. */
  card: ExerciseCardSchema.optional(),
  onStage: z.array(id).max(STORY_LIMITS.onStage),
  lines: z.array(StoryLineSchema).min(1).max(STORY_LIMITS.linesPerScene),
});
export type StoryScene = z.infer<typeof StorySceneSchema>;

export const StorySchema = z.object({
  title: z.string().trim().max(STORY_LIMITS.title),
  aspectRatio: z.enum(ASPECT_RATIOS),
  artStyle: z.string().trim().max(STORY_LIMITS.artStyle),
  narratorVoice: voiceName,
  /** Sensory-friendly: no flashes, gentler movement and more time between lines (Social Stories). */
  calm: z.boolean().optional(),
  characters: z.array(StoryCharacterSchema).min(1).max(STORY_LIMITS.characters),
  locations: z.array(StoryLocationSchema).min(1).max(STORY_LIMITS.locations),
  scenes: z.array(StorySceneSchema).min(1).max(STORY_LIMITS.scenes),
});
export type Story = z.infer<typeof StorySchema>;

/**
 * A story before it is tidied by normalizeStory. The story writer's answer
 * (StoryFromPlanWireSchema in plan.ts) is combined with the plan into this.
 */
export const StoryWireSchema = z.object({
  title: z.string(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  artStyle: z.string(),
  narratorVoice: z.enum(VOICE_IDS),
  calm: z.boolean().optional(),
  isHealthTopic: z.boolean(),
  /** The full disclaimer line to end a health story with. Defaults to the English sentence. */
  disclaimer: z.string().optional(),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      look: z.string(),
      size: z.enum(CHARACTER_SIZES),
      voice: z.enum(VOICE_IDS),
      voiceAge: z.enum(VOICE_AGES),
      voiceStyle: z.string(),
    }),
  ),
  locations: z.array(z.object({ id: z.string(), name: z.string(), look: z.string() })),
  scenes: z.array(
    z.object({
      id: z.string(),
      locationId: z.string(),
      card: ExerciseCardSchema.optional(),
      onStage: z.array(z.string()),
      lines: z.array(z.object({ speaker: z.string(), text: z.string(), how: z.string().optional() })),
    }),
  ),
});
export type StoryWire = z.infer<typeof StoryWireSchema>;

/* ------------------------------------------------------------------ */
/* API shapes                                                          */
/* ------------------------------------------------------------------ */

export const StoryResponseSchema = z.object({ story: StorySchema });

export const IMAGE_KINDS = ["character", "talking", "gesture", "explain", "background", "exercise"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** Largest reference picture (a base64 PNG data URL) accepted for the talking pose. */
export const MAX_REFERENCE_CHARS = 3_500_000;

export const ImageRequestSchema = z
  .object({
    kind: z.enum(IMAGE_KINDS),
    look: z.string().trim().min(3, "Please describe what to draw.").max(STORY_LIMITS.look),
    artStyle: z.string().trim().max(STORY_LIMITS.artStyle),
    aspectRatio: z.enum(ASPECT_RATIOS),
    /** What the last attempt got wrong, so a redraw can correct it (from the picture check). */
    fix: z.string().trim().max(400).optional(),
    /** For "talking", "gesture" and "explain": the picture to redraw from, as a PNG data URL. */
    reference: z
      .string()
      .max(MAX_REFERENCE_CHARS, "That picture is too large to use as a reference.")
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "The reference picture is not a valid PNG.")
      .optional(),
  })
  .refine(
    (request) => !["talking", "gesture", "explain"].includes(request.kind) || Boolean(request.reference),
    { message: "A reference picture is needed to redraw a character.", path: ["reference"] },
  );
export type ImageRequest = z.infer<typeof ImageRequestSchema>;

export const ImageResponseSchema = z.object({
  image: z.string().regex(/^data:image\/(webp|png|jpeg);base64,/),
});

export const SpeechRequestSchema = z.object({
  text: z.string().trim().min(1, "There is nothing to say.").max(STORY_LIMITS.lineText),
  voice: voiceName,
  /** How the character sounds in general, e.g. "cheerful and proud". */
  style: z.string().trim().max(STORY_LIMITS.voiceStyle).optional(),
  /** How this one line is said, e.g. "whispering a secret". */
  delivery: z.string().trim().max(STORY_LIMITS.delivery).optional(),
  /** The language the line is in, e.g. "Hindi", so the recording can be checked. */
  language: z.string().trim().max(60).optional(),
  /** The speaker's age group. Defaults to an adult. */
  age: z.enum(VOICE_AGES).optional(),
});
export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;

export const SpeechResponseSchema = z.object({
  /** MP3 from most voice services; WAV from Gemini. */
  audio: z.string().regex(/^data:audio\/(mpeg|wav);base64,/),
  /** Whether the recording was listened back and the words were heard as written. */
  check: VoiceCheckSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Timing: how long each line and scene stays on screen                */
/* ------------------------------------------------------------------ */

/** Caption reading speed. The captions play the part of a voice. */
export const WORDS_PER_SEC = 2.6;
/** A beat at the start of a scene while the characters arrive. */
export const SCENE_LEAD_SEC = 0.5;
const LINE_PAUSE_SEC = 0.45;
const MIN_LINE_SEC = 1.4;

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // Scripts written without spaces still get a sensible reading time.
  return Math.max(words, Math.ceil(text.trim().length / 12));
}

/** Seconds the words of a line take to "say", without the pause after it. */
export function speakingTime(text: string): number {
  return countWords(text) / WORDS_PER_SEC;
}

export function lineDuration(text: string): number {
  return Math.max(MIN_LINE_SEC, speakingTime(text) + LINE_PAUSE_SEC);
}

/** How long a line lasts and when, within it, the words are being said. */
export type LineTiming = { duration: number; speechStart: number; speechEnd: number };

/**
 * Gives the timing of a line. Without voices it is estimated from the number
 * of words; once a voice clip exists, the clip's real length is used instead.
 */
export type TimeLine = (line: StoryLine) => LineTiming;

export const estimateLine: TimeLine = (line) => ({
  duration: lineDuration(line.text),
  speechStart: 0,
  speechEnd: speakingTime(line.text),
});

export function sceneDuration(scene: StoryScene, timeLine: TimeLine = estimateLine): number {
  return SCENE_LEAD_SEC + scene.lines.reduce((sum, line) => sum + timeLine(line).duration, 0);
}

export function storyDuration(story: Story, timeLine: TimeLine = estimateLine): number {
  return story.scenes.reduce((sum, scene) => sum + sceneDuration(scene, timeLine), 0);
}

export function storySceneStart(story: Story, index: number, timeLine: TimeLine = estimateLine): number {
  let start = 0;
  for (let i = 0; i < index && i < story.scenes.length; i++) {
    start += sceneDuration(story.scenes[i], timeLine);
  }
  return start;
}

/** When every line starts, in seconds from the beginning of the story. */
export function lineStarts(
  story: Story,
  timeLine: TimeLine = estimateLine,
): Array<{ line: StoryLine; at: number }> {
  const starts: Array<{ line: StoryLine; at: number }> = [];
  let time = 0;
  for (const scene of story.scenes) {
    time += SCENE_LEAD_SEC;
    for (const line of scene.lines) {
      starts.push({ line, at: time });
      time += timeLine(line).duration;
    }
  }
  return starts;
}

export type StoryMoment = {
  sceneIndex: number;
  /** Seconds since this scene began. */
  sceneLocal: number;
  /** -1 during the scene's opening beat, before the first line. */
  lineIndex: number;
  /** Seconds since this line began. */
  lineLocal: number;
};

/** What is happening at `time` seconds into the story. */
export function locateStory(story: Story, time: number, timeLine: TimeLine = estimateLine): StoryMoment {
  const { scenes } = story;
  let start = 0;
  for (let s = 0; s < scenes.length; s++) {
    const duration = sceneDuration(scenes[s], timeLine);
    const last = s === scenes.length - 1;
    if (time < start + duration || last) {
      const sceneLocal = Math.min(Math.max(time - start, 0), duration);
      let lineStart = SCENE_LEAD_SEC;
      if (sceneLocal < lineStart) return { sceneIndex: s, sceneLocal, lineIndex: -1, lineLocal: 0 };
      const { lines } = scenes[s];
      for (let l = 0; l < lines.length; l++) {
        const length = timeLine(lines[l]).duration;
        if (sceneLocal < lineStart + length || l === lines.length - 1) {
          return {
            sceneIndex: s,
            sceneLocal,
            lineIndex: l,
            lineLocal: Math.min(sceneLocal - lineStart, length),
          };
        }
        lineStart += length;
      }
    }
    start += duration;
  }
  return { sceneIndex: 0, sceneLocal: 0, lineIndex: -1, lineLocal: 0 };
}

/**
 * Splits a line into the short caption chunks shown one at a time.
 * Very short words ride along with the next word so captions don't flicker.
 */
export function captionChunks(text: string): Array<{ text: string; words: number }> {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: Array<{ text: string; words: number }> = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const joined = current.join(" ");
    if (word.length > 3 || joined.length >= 9) {
      chunks.push({ text: joined, words: current.length });
      current = [];
    }
  }
  if (current.length > 0) {
    const last = chunks[chunks.length - 1];
    if (last && (last.text + " " + current.join(" ")).length <= 14) {
      last.text += " " + current.join(" ");
      last.words += current.length;
    } else {
      chunks.push({ text: current.join(" "), words: current.length });
    }
  }
  return chunks;
}

/* ------------------------------------------------------------------ */
/* Picture keys: one per image the story needs                         */
/* ------------------------------------------------------------------ */

export const pictureKey = {
  character: (characterId: string) => `character:${characterId}`,
  talking: (characterId: string) => `talking:${characterId}`,
  /** The same character with a hand raised, and that pose with the mouth open. */
  gesture: (characterId: string) => `gesture:${characterId}`,
  gestureTalking: (characterId: string) => `gesture-talking:${characterId}`,
  /** The picture on a scene's exercise card. */
  card: (sceneId: string) => `card:${sceneId}`,
  /** A second gesture: both hands open, explaining, and that pose with the mouth open. */
  explain: (characterId: string) => `explain:${characterId}`,
  explainTalking: (characterId: string) => `explain-talking:${characterId}`,
  place: (locationId: string) => `place:${locationId}`,
};

/** Hands down: no gesture pose. */
export const NO_GESTURE = -1;
/** How long a change of pose takes, in seconds. The two poses are blended over this time. */
export const GESTURE_BLEND_SEC = 0.16;

/** What the speaker's hands are doing: `pose` (or NO_GESTURE), blended in from `from` by `blend` (0 to 1). */
export type GestureMoment = { pose: number; from: number; blend: number };

/**
 * The speaker's gestures across a line: short stretches with a hand raised
 * or both hands open, separated by rests, starting on word boundaries. The
 * pattern is fixed for each line (from its text), so the preview and the
 * finished video always match. `poses` is how many gesture poses the
 * character has (0, 1 or 2).
 */
export function gestureSpans(line: StoryLine, timing: LineTiming, poses: number): Array<{ start: number; end: number; pose: number }> {
  if (poses <= 0) return [];
  let seed = 7;
  for (let i = 0; i < line.text.length; i++) seed = (seed * 31 + line.text.charCodeAt(i)) >>> 0;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const start = timing.speechStart;
  const end = timing.speechEnd;
  const spoken = end - start;
  // Where the words start, as fractions of the spoken time, so gestures begin with a word.
  const words = line.text.trim().split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length + 1, 0) || 1;
  const wordStarts: number[] = [];
  let at = 0;
  for (const word of words) {
    wordStarts.push(start + (at / total) * spoken);
    at += word.length + 1;
  }
  const onWord = (time: number) => wordStarts.find((t) => t >= time - 0.05) ?? time;
  const pickPose = () => Math.floor(next() * poses);

  // A short line gets one gesture through its middle, or none.
  if (spoken < 1.4) {
    return next() < 0.6 ? [{ start: start + spoken * 0.15, end: end - spoken * 0.1, pose: pickPose() }] : [];
  }
  const spans: Array<{ start: number; end: number; pose: number }> = [];
  let time = onWord(start + 0.15 + next() * 0.35);
  let last = NO_GESTURE;
  while (time < end - 0.6) {
    const length = 0.9 + next() * 1.0;
    const stop = Math.min(end - 0.15, time + length);
    // Two gestures in a row usually differ, which reads as a person explaining.
    let pose = pickPose();
    if (poses > 1 && pose === last && next() < 0.7) pose = (pose + 1) % poses;
    spans.push({ start: time, end: stop, pose });
    last = pose;
    time = onWord(stop + 0.45 + next() * 0.8);
  }
  return spans;
}

/** What the speaker's hands are doing at `lineLocal` seconds into the line. */
export function gestureAt(line: StoryLine, lineLocal: number, timing: LineTiming, poses: number): GestureMoment {
  const spans = gestureSpans(line, timing, poses);
  for (const span of spans) {
    if (lineLocal < span.start) break;
    if (lineLocal < span.end) {
      const blend = Math.min(1, (lineLocal - span.start) / GESTURE_BLEND_SEC);
      return { pose: span.pose, from: NO_GESTURE, blend };
    }
    if (lineLocal < span.end + GESTURE_BLEND_SEC) {
      return { pose: NO_GESTURE, from: span.pose, blend: (lineLocal - span.end) / GESTURE_BLEND_SEC };
    }
  }
  return { pose: NO_GESTURE, from: NO_GESTURE, blend: 1 };
}

export function characterName(story: Story, speaker: string): string {
  if (speaker === NARRATOR) return "Narrator";
  return story.characters.find((c) => c.id === speaker)?.name || "Character";
}

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

const NARRATOR_STYLE = "A warm, clear storyteller";

/** The voice, age and manner for a line, depending on who says it. */
export function lineVoice(
  story: Story,
  line: StoryLine,
): { voice: string; age: VoiceAge; style: string; delivery: string } {
  const delivery = line.how?.trim() ?? "";
  const character = story.characters.find((c) => c.id === line.speaker);
  if (!character) return { voice: story.narratorVoice, age: "adult", style: NARRATOR_STYLE, delivery };
  return { voice: character.voice, age: character.voiceAge, style: character.voiceStyle, delivery };
}

/**
 * Identifies a sound clip by what was said and how. A reordered line keeps
 * its clip; an edited line (or a changed voice) needs a new one.
 */
export function clipKey(story: Story, line: StoryLine): string {
  const { voice, age, style, delivery } = lineVoice(story, line);
  return `${voice}|${age}|${style}|${delivery}|${line.text.trim()}`;
}
