import { describe, expect, it } from "vitest";
import { DEFAULT_ART_STYLE, NARRATOR, SCENE_LEAD_SEC, StorySchema, estimateLine, storyDuration, type LineTiming, type Story } from "@/lib/story";
import { sceneSetting, seedFrom, withoutAbsent } from "@/lib/storyMood";
import { LIGHTS, lightFor, touchesFor } from "@/lib/storyAtmosphere";
import { SCALES, flutePhrases, natureFor, planSoundBed, scaleFor, tanpuraPlucks } from "@/lib/soundBed";
import { TITLE_SEC, drawStoryFrame, titleAlpha, type CharacterSprites, type StoryRenderAssets } from "@/lib/storyRenderer";

const story = (places: Array<[string, string]>, changes: Partial<Story> = {}): Story =>
  StorySchema.parse({
    title: "రామాయణం",
    aspectRatio: "9:16",
    artStyle: DEFAULT_ART_STYLE,
    narratorVoice: "sage",
    characters: [
      { id: "c1", name: "Rama", look: "x", size: "large", voice: "cedar", voiceAge: "adult", voiceStyle: "" },
      { id: "c2", name: "Sita", look: "x", size: "large", voice: "marin", voiceAge: "adult", voiceStyle: "" },
    ],
    locations: places.map(([name, look], i) => ({ id: `l${i + 1}`, name, look })),
    scenes: places.map((_, i) => ({
      id: `s${i + 1}`,
      locationId: `l${i + 1}`,
      onStage: ["c1", "c2"],
      lines: [
        { speaker: "c1", text: "Sita, this forest feels like home to me now.", emotion: i === 1 ? "sad" : "happy" },
        { speaker: "c2", text: "It does, Rama. I love the birds here." },
        { speaker: NARRATOR, text: "They lived there for many happy years." },
      ],
    })),
    ...changes,
  });

const FOREST: [string, string] = ["Panchavati Forest", "A sunny forest clearing with tall trees and a small hut."];
const NIGHT: [string, string] = ["Panchavati at night", "The forest hut under the moon, with small clay lamps glowing."];
const PALACE: [string, string] = ["Ravana's palace hall", "A grand golden hall inside the palace with pillars."];

describe("what each scene is like", () => {
  it("reads the time of day, the place and the feeling from the place and the lines", () => {
    const subject = story([FOREST, NIGHT, PALACE]);
    const [day, night, hall] = subject.scenes.map((scene) => sceneSetting(subject, scene));
    expect(day).toMatchObject({ time: "day", nature: true, indoors: false, feeling: "happy" });
    expect(night).toMatchObject({ time: "night", lamps: true, feeling: "sad" });
    expect(hall).toMatchObject({ indoors: true, nature: false });
    expect(sceneSetting(story([["Palace garden", "A palace garden full of flowers"]]), subject.scenes[0])).toMatchObject({
      indoors: false,
    });
  });

  it("notices when a place is on fire, in English, Telugu or Hindi, but not lamps or fireflies", () => {
    const burning = story([
      ["Lanka rooftops", "Golden rooftops of Lanka at dusk, with orange flames and glowing embers rising into the sky."],
      ["లంక", "సాయంత్రం లంక భవనాలపై మంటలు."],
      ["Forest", "A forest at night with fireflies and a small fireplace glow."],
    ]);
    const [english, telugu, fireflies] = burning.scenes.map((scene) => sceneSetting(burning, scene));
    expect(english).toMatchObject({ fire: true, time: "dusk" });
    expect(telugu).toMatchObject({ fire: true, time: "dusk" });
    expect(fireflies).toMatchObject({ fire: false, lamps: true });
  });

  it("does not count what a place says is absent", () => {
    expect(withoutAbsent("a peaceful garden, with cool green leaves and no fire.")).not.toContain("fire");
    expect(withoutAbsent("orange light on the rooftops, with no damaged buildings or threatening flames. dusk sky")).not.toContain("flames");
    expect(withoutAbsent("a river without people, under the moon")).toContain("river");
    const safe = story([["Ashoka garden", "A peaceful garden of ashoka trees in soft evening light. The garden is intact, with cool green foliage and no fire."]]);
    expect(sceneSetting(safe, safe.scenes[0])).toMatchObject({ fire: false, time: "dusk", flowers: true });
  });

  it("understands places described in Telugu or Hindi too", () => {
    const telugu = story([
      ["పంచవటి", "ఎత్తైన పచ్చని చెట్లు, అడవి పూలతో నిండిన ప్రశాంతమైన వనం. ఎండ కాసే ఉదయం."],
      ["అయోధ్య", "రాజభవన ద్వారం, వీధికి ఇరువైపులా వరుసగా వెలిగే మట్టి దీపాలు. ప్రశాంతమైన రాత్రి."],
      ["समुद्र तट", "शाम के समय समुद्र का किनारा।"],
    ]);
    const [forest, ayodhya, shore] = telugu.scenes.map((scene) => sceneSetting(telugu, scene));
    expect(forest).toMatchObject({ time: "day", nature: true, flowers: true, indoors: false });
    expect(ayodhya).toMatchObject({ time: "night", lamps: true, busy: true });
    expect(shore).toMatchObject({ time: "dusk", water: "sea" });
  });

  it("gives each scene its light: warm when happy, cool when sad, blue at night", () => {
    const subject = story([FOREST, NIGHT, PALACE]);
    const settings = subject.scenes.map((scene) => sceneSetting(subject, scene));
    expect(lightFor(settings[0])).toBe("happy");
    expect(lightFor(settings[1])).toBe("night");
    expect(lightFor({ ...settings[0], feeling: "sad" })).toBe("sad");
    expect(lightFor({ ...settings[0], time: "dusk" })).toBe("dusk");
    // Warm is redder than it is blue; sad and night are bluer.
    expect(LIGHTS.happy.centre[0]).toBeGreaterThan(LIGHTS.happy.centre[2]);
    expect(LIGHTS.sad.centre[2]).toBeGreaterThan(LIGHTS.sad.centre[0]);
    expect(LIGHTS.night.centre[2]).toBeGreaterThan(LIGHTS.night.centre[0]);
  });

  it("chooses the small moving touches from the place", () => {
    const subject = story([FOREST, NIGHT, PALACE]);
    const [day, night, hall] = subject.scenes.map((scene) => sceneSetting(subject, scene));
    expect(touchesFor(day)).toEqual(["leaves"]);
    expect(touchesFor(night)).toEqual(["fireflies"]);
    expect(touchesFor(hall)).toEqual(["dust"]);
    expect(touchesFor({ ...day, flowers: true })).toEqual(["petals"]);
    expect(touchesFor({ ...day, rain: true })).toEqual(["rain"]);
    expect(touchesFor({ ...day, fire: true })).toEqual(["embers"]);
  });
});

describe("the background music and nature sounds", () => {
  const timeLine = estimateLine;

  it("plays the sounds of each place", () => {
    const subject = story([FOREST, NIGHT, PALACE]);
    const [day, night, hall] = subject.scenes.map((scene) => sceneSetting(subject, scene));
    expect(natureFor(day)).toEqual(expect.arrayContaining(["wind", "birds", "leaves"]));
    expect(natureFor(night)).toEqual(expect.arrayContaining(["crickets"]));
    expect(natureFor(night)).not.toContain("birds");
    expect(natureFor(hall)).toEqual(["room"]);
    expect(natureFor({ ...hall, temple: true })).toContain("bell");
    expect(natureFor({ ...day, water: "river" })).toContain("river");
    // A fire crackles, and no bird sings beside it.
    expect(natureFor({ ...day, fire: true })).toContain("fire");
    expect(natureFor({ ...day, fire: true })).not.toContain("birds");
  });

  it("steps the music back exactly while voices are heard, and not at all for captions only", () => {
    const subject = story([FOREST, NIGHT]);
    const duration = storyDuration(subject, timeLine) + 4;
    const plan = planSoundBed(subject, timeLine, duration, true);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[1].end).toBe(duration); // the last scene's sounds carry on under the end card
    expect(plan.speech.length).toBeGreaterThan(0);
    for (let i = 1; i < plan.speech.length; i++) expect(plan.speech[i][0] - plan.speech[i - 1][1]).toBeGreaterThanOrEqual(0.8);
    expect(plan.speech[0][0]).toBeCloseTo(SCENE_LEAD_SEC, 5);
    expect(planSoundBed(subject, timeLine, duration, false)).toMatchObject({ speech: [], voices: false });
  });

  it("plucks the tanpura in its Pa, Sa, Sa, low Sa cycle", () => {
    const plan = planSoundBed(story([FOREST]), timeLine, 12, true);
    const plucks = tanpuraPlucks(plan);
    expect(plucks[0].at).toBe(0);
    expect(plucks[1].frequency).toBeCloseTo(plucks[2].frequency, 6);
    expect(plucks[3].frequency).toBeCloseTo(plucks[1].frequency / 2, 6);
    expect(plucks[0].frequency / plucks[3].frequency).toBeCloseTo(2 ** (7 / 12), 6);
    expect(plucks.every((pluck) => pluck.at < 12)).toBe(true);
  });

  it("opens every scene with a flute phrase in a scale that suits its mood, and rests on a calm note", () => {
    const subject = story([FOREST, NIGHT, PALACE]);
    const plan = planSoundBed(subject, timeLine, storyDuration(subject, timeLine), true);
    const phrases = flutePhrases(plan);
    for (const scene of plan.scenes) expect(phrases.some((phrase) => Math.abs(phrase.at - scene.start - 0.15) < 1e-9)).toBe(true);
    expect(phrases.find((phrase) => phrase.at > plan.scenes[1].start && phrase.at < plan.scenes[1].end)?.scale).toBe("tender");
    expect(scaleFor(plan.scenes[0].setting)).toBe("bright");
    for (const phrase of phrases) {
      const allowed = SCALES[phrase.scale];
      for (const note of phrase.notes) expect(allowed).toContain(((note.semitone % 12) + 12) % 12);
      expect([0, 4, 7, 12]).toContain(phrase.notes[phrase.notes.length - 1].semitone);
    }
    // The same story always gets the same music, so the preview and the video match.
    expect(flutePhrases(planSoundBed(subject, timeLine, plan.duration, true))).toEqual(phrases);
    expect(seedFrom("a")).not.toBe(seedFrom("b"));
  });
});

describe("the opening title and the moving touches in the picture", () => {
  const LINE: LineTiming = { duration: 3, speechStart: 0.1, speechEnd: 2.6 };
  const sprites = new Map<string, CharacterSprites>(
    ["Rama", "Sita"].map((name, i) => [`c${i + 1}`, { idle: { source: { name } as unknown as CanvasImageSource, width: 450, height: 1000 } }]),
  );
  const assets: StoryRenderAssets = { characters: sprites, places: new Map(), headingFont: "sans-serif", timeLine: () => LINE };

  /** Draws a frame and records the text written and the shapes filled. */
  function frame(subject: Story, time: number, options: { settled?: boolean; title?: boolean } = {}) {
    const texts: string[] = [];
    let shapes = 0;
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "fillText") return (text: string) => texts.push(text);
        if (key === "ellipse" || key === "arc") return () => (shapes += 1);
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
        if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
        return () => undefined;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    drawStoryFrame(ctx, subject, time, assets, options);
    return { texts, shapes };
  }

  it("shows the story's name over the first seconds only, fading in and out", () => {
    expect(titleAlpha(0)).toBe(0);
    expect(titleAlpha(1.5)).toBe(1);
    expect(titleAlpha(TITLE_SEC - 0.2)).toBeGreaterThan(0);
    expect(titleAlpha(TITLE_SEC - 0.2)).toBeLessThan(1);
    expect(titleAlpha(TITLE_SEC)).toBe(0);
    const subject = story([FOREST]);
    expect(frame(subject, 1.5).texts).toContain("రామాయణం");
    expect(frame(subject, TITLE_SEC + 0.5).texts).not.toContain("రామాయణం");
    expect(frame(subject, 1.5, { title: false }).texts).not.toContain("రామాయణం");
  });

  it("draws leaves in a forest by day, but nothing moving in a calm story", () => {
    const forest = story([FOREST]);
    // A place with nothing moving: only the characters' shadows are drawn as shapes.
    const still = frame(story([["Golden Lanka", "A golden city of tall towers."]]), 5).shapes;
    expect(frame(forest, 5).shapes).toBeGreaterThanOrEqual(still + 7);
    expect(frame({ ...forest, calm: true }, 5).shapes).toBe(still);
  });
});
