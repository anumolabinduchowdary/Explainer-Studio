import { z } from "zod";
import { STORY_LIMITS, VOICES, VOICE_AGE_SETTINGS, type Story, type VoiceAge } from "./story";

/**
 * Voices, whichever service speaks them.
 *
 * The app can speak lines with OpenAI's voices or, when it is set up on the
 * server, with SpeechGen's. Each service has its own list of voice names, so
 * the browser asks the server for the list and everything else works from
 * these plain descriptions.
 */

export const SPEECH_PROVIDERS = ["openai", "speechgen"] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];

export const VoiceOptionSchema = z.object({
  /** The name the voice service knows the voice by. */
  id: z.string().min(1).max(STORY_LIMITS.voice),
  /** What people see in the menu. */
  label: z.string().min(1).max(140),
  gender: z.enum(["female", "male", "neutral"]),
  /** The age the voice really is. Most voices are adults. */
  age: z.enum(["child", "adult", "older"]),
});
export type VoiceOption = z.infer<typeof VoiceOptionSchema>;

export const VoicesRequestSchema = z.object({
  /** The language the story is spoken in, as people write it: "English", "Hindi". */
  language: z.string().trim().max(60),
});

export const VoicesResponseSchema = z.object({
  provider: z.enum(SPEECH_PROVIDERS),
  voices: z.array(VoiceOptionSchema).min(1).max(300),
});
export type VoiceList = z.infer<typeof VoicesResponseSchema>;

const OPENAI_GENDER = { women: "female", men: "male", neutral: "neutral" } as const;

export const OPENAI_VOICE_OPTIONS: VoiceOption[] = VOICES.map((voice) => ({
  id: voice.id,
  label: `${voice.id[0].toUpperCase()}${voice.id.slice(1)} (${voice.hint})`,
  gender: OPENAI_GENDER[voice.group],
  age: "adult",
}));

export const OPENAI_VOICE_LIST: VoiceList = { provider: "openai", voices: OPENAI_VOICE_OPTIONS };

const MENU_GROUPS: Array<{ label: string; holds: (voice: VoiceOption) => boolean }> = [
  { label: "Children's voices", holds: (voice) => voice.age === "child" },
  { label: "Women's voices", holds: (voice) => voice.age === "adult" && voice.gender === "female" },
  { label: "Men's voices", holds: (voice) => voice.age === "adult" && voice.gender === "male" },
  { label: "Older voices", holds: (voice) => voice.age === "older" },
  { label: "Neutral voices", holds: (voice) => voice.age === "adult" && voice.gender === "neutral" },
];

/** The voices sorted into the headings of the voice menu. Empty headings are left out. */
export function voiceMenu(voices: ReadonlyArray<VoiceOption>): Array<{ label: string; voices: VoiceOption[] }> {
  return MENU_GROUPS.map((group) => ({ label: group.label, voices: voices.filter(group.holds) })).filter(
    (group) => group.voices.length > 0,
  );
}

/**
 * How much faster or slower a recording is played to suggest an age.
 * A real child's or older person's voice already sounds its age, so it is
 * left alone; only adult voices are shifted.
 */
export function ageRate(characterAge: VoiceAge, voice: VoiceOption | undefined): number {
  if (voice && voice.age !== "adult") return 1;
  return VOICE_AGE_SETTINGS[characterAge].rate;
}

/** "Justin" and "Justin plus" are one voice in two qualities. */
const sameVoice = (id: string) => id.toLowerCase().replace(/\s+plus$/, "");

/**
 * Chooses a voice for a speaker: the right gender and, where the list has
 * one, a voice that really is the speaker's age. Voices already taken by
 * someone else are avoided while there are others left. The list is in the
 * server's order of preference, so the first match wins.
 */
export function pickVoice(
  voices: ReadonlyArray<VoiceOption>,
  wanted: { gender: VoiceOption["gender"]; age: VoiceAge },
  taken: ReadonlySet<string> = new Set(),
): VoiceOption | undefined {
  const realAge = wanted.age === "child" ? "child" : wanted.age === "older" ? "older" : "adult";
  const free = (voice: VoiceOption) => !taken.has(sameVoice(voice.id));
  const rightGender = (voice: VoiceOption) => wanted.gender === "neutral" || voice.gender === wanted.gender;
  const attempts: Array<(voice: VoiceOption) => boolean> = [
    (voice) => free(voice) && rightGender(voice) && voice.age === realAge,
    // No voice of that age is left: an adult voice is used and its pitch shifted instead.
    (voice) => free(voice) && rightGender(voice) && voice.age === "adult",
    (voice) => rightGender(voice) && voice.age === "adult",
    (voice) => free(voice) && voice.age === "adult",
    () => true,
  ];
  for (const fits of attempts) {
    const found = voices.find(fits);
    if (found) return found;
  }
  return undefined;
}

/**
 * Gives every speaker a voice from `voices`. Speakers whose voice is already
 * in the list keep it. The others (for example a story cast with OpenAI's
 * voices, now spoken by another service) get a voice of the same gender and
 * of their own age. Returns the same story when nothing needs to change.
 */
export function castVoices(story: Story, voices: ReadonlyArray<VoiceOption>): Story {
  if (voices.length === 0) return story;
  const known = new Map(voices.map((voice) => [voice.id, voice]));
  const speakers = [story.narratorVoice, ...story.characters.map((character) => character.voice)];
  if (speakers.every((voice) => known.has(voice))) return story;

  const genderOf = (voice: string): VoiceOption["gender"] =>
    OPENAI_VOICE_OPTIONS.find((option) => option.id === voice)?.gender ?? "neutral";
  const taken = new Set(speakers.filter((voice) => known.has(voice)).map(sameVoice));
  const choose = (current: string, age: VoiceAge): string => {
    if (known.has(current)) return current;
    const picked = pickVoice(voices, { gender: genderOf(current), age }, taken);
    if (!picked) return current;
    taken.add(sameVoice(picked.id));
    return picked.id;
  };

  // Characters choose first, so the narrator never takes a child's only voice.
  const characters = story.characters.map((character) => ({
    ...character,
    voice: choose(character.voice, character.voiceAge),
  }));
  return { ...story, characters, narratorVoice: choose(story.narratorVoice, "adult") };
}
