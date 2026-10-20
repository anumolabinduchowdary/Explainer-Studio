import { NARRATOR, type Story, type StoryScene } from "./story";

/**
 * What a scene is like: the time of day, the kind of place and the feeling
 * of its lines. The music, nature sounds, light and the small moving touches
 * in the background (fireflies, leaves, rain) all follow it.
 *
 * It is read from the place's name and description (which the planner writes
 * in English for the illustrator, with common Telugu and Hindi words understood
 * too, for places described by hand) and from the feelings on the lines,
 * so it needs no extra request to the AI and costs no time.
 */

export type TimeOfDay = "day" | "dusk" | "night";
export type SceneFeeling = "neutral" | "happy" | "sad" | "tense";

export type SceneSetting = {
  time: TimeOfDay;
  feeling: SceneFeeling;
  /** Inside a room, hall, temple or other building. */
  indoors: boolean;
  /** Trees, grass or a garden: birds by day, crickets and fireflies at night. */
  nature: boolean;
  flowers: boolean;
  water: "none" | "river" | "sea";
  rain: boolean;
  snow: boolean;
  /** Lamps, candles or a small fire: a soft, flickering warm light. */
  lamps: boolean;
  /** Something burning (such as Lanka set alight): rising embers, firelight and its crackle. */
  fire: boolean;
  temple: boolean;
  /** A town, market or street: a distant murmur. */
  busy: boolean;
};

const has = (pattern: RegExp, text: string) => pattern.test(text);

/**
 * The same ideas in Telugu and Hindi, for places described in those languages.
 * These scripts join words together, so they are matched anywhere in the text.
 */
const LOCAL = {
  night: /రాత్రి|వెన్నెల|చంద్ర|रात|चाँदनी|चांदनी|चंद्र/,
  dusk: /సాయంత్ర|సంధ్య|సూర్యాస్త|తెల్లవార|शाम|सूर्यास्त|सुबह-सवेरे|भोर/,
  rain: /వర్ష|వాన|बारिश|वर्षा/,
  snow: /మంచు|बर्फ|हिम/,
  lamps: /దీప|దివ్వె|లాంతరు|కాగడా|दीप|दीय|दिये|दिया|लालटेन|मशाल/,
  fire: /మంటలు|మంటల్లో|అగ్ని|నిప్పు|కాలుతు|आग|ज्वाला|लपट|अग्नि|जलती|जलते/,
  flowers: /పూల|పువ్వు|పూవు|అశోక|తామర|फूल|पुष्प|अशोक|कमल/,
  nature: /అడవి|వనం|వన |చెట్ట|చెట్ల|తోట|పొలం|కొండ|గ్రామ|जंगल|वन |पेड़|बाग|बगीच|उद्यान|खेत|पहाड़|गाँव|गांव/,
  sea: /సముద్ర|సాగర|తీరం|समुद्र|सागर|तट/,
  river: /నది|సరస్సు|చెరువు|జలపాత|नदी|झील|तालाब|झरना|घाट/,
  indoors: /గది|ఇంట్లో|లోపల|సభ|కోవెల లోపల|कमरा|कमरे|घर के अंदर|अंदर|दरबार/,
  temple: /గుడి|ఆలయ|కోవెల|मंदिर|देवालय/,
  busy: /వీధి|నగర|పట్టణ|సంత|బజార్|बाज़ार|बाजार|शहर|गली|सड़क/,
};

const NIGHT = /\b(night|moon\w*|midnight|starry|stars|starlit)\b/;
const DUSK = /\b(dusk|sunset|evening|twilight|dawn|sunrise|golden hour)\b/;
const RAIN = /\b(rain\w*|monsoon|storm\w*|drizzl\w*|thunder\w*)\b/;
const SNOW = /\b(snow\w*|winter|frost\w*|icy)\b/;
const LAMPS = /\b(lamps?|diyas?|candles?|lanterns?|torch\w*|bonfire|campfire|fireplace|firelight)\b/;
const FIRE = /\b(fires?|flames?|flaming|burning|ablaze|blaz\w+|embers?|sparks)\b/;
const FLOWERS = /\b(flowers?|flowering|blossom\w*|petals?|lotus\w*|roses?|jasmine|marigolds?|gardens?|ashoka)\b/;
const NATURE =
  /\b(forest|jungle|woods?|woodland|trees?|gardens?|park|grove|meadow|fields?|grass\w*|hermitage|ashram|orchard|farm|village|hills?|mountains?|valley|countryside|bushes|vines?)\b/;
const SEA = /\b(sea|ocean|beach|shore|coast\w*|waves)\b/;
const RIVER = /\b(river\w*|lake\w*|pond|stream|waterfall|ghats?|canal)\b/;
const INDOORS =
  /\b(room|hall|palace|temple|home|house|kitchen|school|classroom|clinic|hospital|office|library|court(room)?|inside|indoors?|hut|shop|store|bedroom|bathroom|toilet|surgery|waiting area|corridor|chamber|throne|cave)\b/;
const OUTSIDE_WORDS = /\b(garden|courtyard|outside|outdoors|balcony|terrace|veranda|street|road|square)\b/;
const TEMPLE = /\b(temples?|shrine|mandir|puja|pooja)\b/;
const BUSY = /\b(city|town|market|bazaa?r|street|road|station|playground|fair|crowd\w*|shops)\b/;

/** The feeling that runs through a scene's lines: the strongest one that is shown. */
function sceneFeeling(scene: StoryScene): SceneFeeling {
  let happy = 0;
  let sad = 0;
  let tense = 0;
  for (const line of scene.lines) {
    if (line.speaker === NARRATOR) continue;
    if (line.emotion === "happy") happy += 1;
    if (line.emotion === "sad" || line.emotion === "worried") sad += 1;
    if (line.emotion === "angry") tense += 1.5;
  }
  const strongest = Math.max(happy, sad, tense);
  if (strongest === 0) return "neutral";
  if (tense === strongest) return "tense";
  if (sad === strongest) return "sad";
  return "happy";
}

/**
 * The text with anything it says is absent left out, so "the garden is safe,
 * with no fire" does not count as fire: from "no", "not", "without" or "never"
 * to the end of that part of the sentence.
 */
export function withoutAbsent(text: string): string {
  return text.replace(/\b(no|not|nor|without|never)\b[^.,;:!?]*/g, " ");
}

/** Reads what a scene is like from its place and its lines. */
export function sceneSetting(story: Story, scene: StoryScene): SceneSetting {
  const location = story.locations.find((place) => place.id === scene.locationId);
  const text = withoutAbsent(`${location?.name ?? ""}. ${location?.look ?? ""}`.toLowerCase());
  const either = (english: RegExp, local: RegExp) => has(english, text) || has(local, text);
  const nature = either(NATURE, LOCAL.nature);
  const sea = either(SEA, LOCAL.sea);
  const river = either(RIVER, LOCAL.river);
  const indoors = either(INDOORS, LOCAL.indoors) && !has(OUTSIDE_WORDS, text) && !nature && !sea && !river;
  return {
    time: either(NIGHT, LOCAL.night) ? "night" : either(DUSK, LOCAL.dusk) ? "dusk" : "day",
    feeling: sceneFeeling(scene),
    indoors,
    nature,
    flowers: either(FLOWERS, LOCAL.flowers),
    water: sea ? "sea" : river ? "river" : "none",
    rain: either(RAIN, LOCAL.rain),
    snow: either(SNOW, LOCAL.snow),
    lamps: either(LAMPS, LOCAL.lamps),
    fire: either(FIRE, LOCAL.fire),
    temple: either(TEMPLE, LOCAL.temple),
    busy: either(BUSY, LOCAL.busy),
  };
}

/** A small number that is the same every time for the same text (for repeatable "random" touches). */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A tiny repeatable random number generator (mulberry32): the same seed gives the same numbers. */
export function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
