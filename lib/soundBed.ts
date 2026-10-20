import { passMiddles } from "./flight";
import { NARRATOR, lineStarts, sceneDuration, type Story, type TimeLine } from "./story";
import { firesFor } from "./storyAtmosphere";
import { randomFrom, sceneSetting, seedFrom, type SceneSetting } from "./storyMood";

/**
 * Background music and nature sounds for cartoon stories, made by the app
 * itself (so there is nothing to license, download or pay for):
 *
 * - a tanpura drone, plucked in its usual Pa, Sa, Sa, low Sa cycle;
 * - short bansuri (flute) phrases in a raga-like scale that follows each
 *   scene's mood: bright by day, evening-like at dusk and night, tender for
 *   sad scenes and darker for tense ones;
 * - the sounds of each place: birds and rustling leaves in a forest, crickets
 *   at night, a flowing river or waves, rain, a quiet room, a temple bell, a
 *   distant town, the crackle of a fire, and a light wind outdoors.
 *
 * An action scene (someone flying) gets dhol-style drums, a whoosh each time
 * the flyer passes and, in a burning place, a deep boom as each fire catches,
 * all timed from the same flight path and fires as the picture.
 *
 * Whenever someone speaks the music steps back (and the nature sounds a
 * little), then comes back up. The whole track is worked out from the story
 * and rendered once, faster than real time, into one sound buffer that both
 * the preview and the downloaded video use.
 */

export const BED_RATE = 32_000;

/** Sa of the drone and the flute, in hertz (C sharp, a common tanpura pitch). */
const SA = 138.59;

export type BedScene = {
  start: number;
  end: number;
  setting: SceneSetting;
  /** How many characters fly through the scene (an action scene when above 0). */
  flyers: number;
  /** When each fire catches, in seconds into the scene. */
  ignitions: number[];
};
export type BedPlan = {
  duration: number;
  scenes: BedScene[];
  /** When a voice is heard, merged into stretches; the music steps back during these. */
  speech: Array<[number, number]>;
  /** False for a captions-only video: the music is all there is to hear, so it plays a little louder. */
  voices: boolean;
  calm: boolean;
  seed: number;
};

/** Stretches of speech closer together than this are treated as one, so the music does not pump. */
const MERGE_GAP_SEC = 0.8;

/** Works out the sound bed for a story. `voices` is false for a captions-only video (nothing to step back for). */
export function planSoundBed(story: Story, timeLine: TimeLine, duration: number, voices: boolean): BedPlan {
  const scenes: BedScene[] = [];
  let start = 0;
  story.scenes.forEach((scene, index) => {
    const length = sceneDuration(scene, timeLine);
    const last = index === story.scenes.length - 1;
    // The last scene's sounds carry on under the end card, if there is one.
    const setting = sceneSetting(story, scene);
    const calm = story.calm === true;
    scenes.push({
      start,
      end: last ? Math.max(duration, start + length) : start + length,
      setting,
      flyers: calm ? 0 : (scene.flying ?? []).filter((id) => scene.onStage.includes(id)).length,
      ignitions: setting.fire && !calm ? firesFor(scene, calm).map((spot) => Number(spot.ignite.toFixed(3))) : [],
    });
    start += length;
  });
  const speech: Array<[number, number]> = [];
  if (voices) {
    for (const { line, at } of lineStarts(story, timeLine)) {
      if (!line.text.trim()) continue;
      const timing = timeLine(line);
      const from = at + timing.speechStart;
      const to = at + timing.speechEnd;
      const previous = speech[speech.length - 1];
      if (previous && from - previous[1] < MERGE_GAP_SEC) previous[1] = Math.max(previous[1], to);
      else speech.push([from, to]);
    }
  }
  const words = story.scenes.flatMap((scene) => scene.lines.filter((line) => line.speaker !== NARRATOR).map((line) => line.text));
  return {
    duration,
    scenes,
    speech,
    voices,
    calm: story.calm === true,
    seed: seedFrom(`${story.title}|${words.slice(0, 3).join("|")}`),
  };
}

/* ------------------------------------------------------------------ */
/* The music, as notes (pure, so it can be tested)                     */
/* ------------------------------------------------------------------ */

export const SCALES = {
  /** Bhupali-like: Sa Re Ga Pa Dha. */
  bright: [0, 2, 4, 7, 9],
  /** Hamsadhwani-like: Sa Re Ga Pa Ni, for dusk and night. */
  evening: [0, 2, 4, 7, 11],
  /** Sa komal-Ga Ma Pa komal-Ni, for sad scenes. */
  tender: [0, 3, 5, 7, 10],
  /** Sa komal-Re Ma Pa komal-Dha, for tense scenes. */
  tense: [0, 1, 5, 7, 8],
} as const;
export type ScaleName = keyof typeof SCALES;

export function scaleFor(setting: SceneSetting): ScaleName {
  if (setting.feeling === "tense") return "tense";
  if (setting.feeling === "sad") return "tender";
  if (setting.time !== "day") return "evening";
  return "bright";
}

export type Pluck = { at: number; frequency: number };

/** The tanpura's plucks for the whole bed: Pa, Sa, Sa, low Sa, round and round. */
export function tanpuraPlucks(plan: BedPlan): Pluck[] {
  const gap = plan.calm ? 1.5 : 1.25;
  const cycle = [SA * 2 ** (7 / 12), SA * 2, SA * 2, SA];
  const plucks: Pluck[] = [];
  for (let i = 0; i * gap < plan.duration - 0.5; i++) plucks.push({ at: i * gap, frequency: cycle[i % cycle.length] / 2 });
  return plucks;
}

export type FluteNote = { at: number; length: number; semitone: number };
export type Phrase = { at: number; scale: ScaleName; notes: FluteNote[] };

const STEPS = [-2, -1, -1, 1, 1, 2];
const LENGTHS = [0.45, 0.6, 0.6, 0.9, 1.2];

/** One short flute phrase starting at `at`: a gentle walk through the scale that comes to rest on Sa, Ga or Pa. */
function phrase(at: number, scale: ScaleName, random: () => number, calm: boolean): Phrase {
  const degrees = SCALES[scale];
  // Two octaves of the scale, from just below Sa to just above the upper Sa.
  const pitches = [...degrees.slice(3).map((s) => s - 12), ...degrees, ...degrees.slice(0, 3).map((s) => s + 12)];
  let index = pitches.indexOf(random() < 0.5 ? 0 : 7);
  if (index < 0) index = pitches.indexOf(0);
  const count = 3 + Math.floor(random() * 4);
  const stretch = calm ? 1.3 : 1;
  const notes: FluteNote[] = [];
  let time = at;
  for (let n = 0; n < count; n++) {
    const last = n === count - 1;
    let semitone = pitches[index];
    if (last) {
      // End on a restful note.
      const rests = pitches.filter((p) => p === 0 || p === 7 || p === 12 || p === 4);
      semitone = rests.reduce((best, p) => (Math.abs(p - semitone) < Math.abs(best - semitone) ? p : best), rests[0]);
    }
    const length = (last ? 1.6 : LENGTHS[Math.floor(random() * LENGTHS.length)]) * stretch;
    notes.push({ at: time, length, semitone });
    time += length;
    index = Math.min(pitches.length - 1, Math.max(0, index + STEPS[Math.floor(random() * STEPS.length)]));
  }
  return { at, scale, notes };
}

/**
 * The flute phrases: one as each scene opens, more every 9 to 13 seconds
 * (14 to 18 in a calm story), and a closing phrase at the end.
 */
export function flutePhrases(plan: BedPlan): Phrase[] {
  const random = randomFrom(plan.seed);
  const phrases: Phrase[] = [];
  const room = (at: number) => at + 4 <= plan.duration;
  for (const scene of plan.scenes) {
    const scale = scaleFor(scene.setting);
    let at = scene.start + 0.15;
    while (at + 3 < scene.end && room(at)) {
      phrases.push(phrase(at, scale, random, plan.calm));
      at += (plan.calm ? 14 : 9) + random() * 4;
    }
  }
  const ending = plan.duration - 4.5;
  const last = phrases[phrases.length - 1];
  if (ending > 0 && (!last || ending - last.at > 5)) {
    phrases.push(phrase(ending, scaleFor(plan.scenes[plan.scenes.length - 1].setting), random, plan.calm));
  }
  return phrases;
}

/** The sounds each kind of place gets. */
export function natureFor(setting: SceneSetting): string[] {
  const sounds: string[] = [];
  const outside = !setting.indoors;
  if (setting.rain) sounds.push("rain");
  else if (setting.snow) sounds.push("snow wind");
  else if (outside) sounds.push("wind");
  if (setting.water === "river") sounds.push("river");
  if (setting.water === "sea") sounds.push("waves");
  // A fire crackles; no bird or cricket sings beside it.
  if (setting.fire) sounds.push("fire");
  const calmNature = !setting.rain && !setting.fire;
  if (outside && setting.nature && setting.time === "day" && calmNature) sounds.push("birds", "leaves");
  if (outside && setting.time === "dusk" && setting.nature && calmNature) sounds.push("birds");
  if (outside && setting.time === "night" && calmNature && !setting.snow) sounds.push("crickets");
  if (setting.indoors) sounds.push("room");
  if (setting.temple) sounds.push("bell");
  if (setting.busy && !setting.indoors) sounds.push("town");
  return sounds;
}

/* ------------------------------------------------------------------ */
/* Rendering (browser only)                                            */
/* ------------------------------------------------------------------ */

type Ctx = OfflineAudioContext;

function noiseBuffer(ctx: Ctx, seconds: number, seed: number, brown: boolean): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = randomFrom(seed);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/** Turns a parameter down while people speak and back up after, smoothly. */
function stepBack(param: AudioParam, speech: BedPlan["speech"], full: number, low: number) {
  param.setValueAtTime(full, 0);
  for (const [from, to] of speech) {
    param.setValueAtTime(full, Math.max(0, from - 0.25));
    param.linearRampToValueAtTime(low, Math.max(0.001, from));
    param.setValueAtTime(low, to);
    param.linearRampToValueAtTime(full, to + 0.5);
  }
}

/** A gain that fades a scene's sounds in and out across the scene changes. */
function sceneGain(ctx: Ctx, out: AudioNode, scene: BedScene, first: boolean): GainNode {
  const gain = ctx.createGain();
  const fade = 0.4;
  gain.gain.setValueAtTime(first ? 1 : 0, Math.max(0, scene.start - fade));
  gain.gain.linearRampToValueAtTime(1, scene.start + fade);
  gain.gain.setValueAtTime(1, Math.max(scene.start + fade, scene.end - fade));
  gain.gain.linearRampToValueAtTime(0, scene.end + fade);
  gain.connect(out);
  return gain;
}

/** A looping noise through a filter, at a level that can sway slowly (like wind or waves). */
function noiseBed(
  ctx: Ctx,
  out: AudioNode,
  noise: AudioBuffer,
  from: number,
  to: number,
  filter: { type: BiquadFilterType; frequency: number; q?: number },
  level: number,
  sway?: { rate: number; depth: number },
  extra?: { type: BiquadFilterType; frequency: number },
) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.loopStart = 0;
  const shape = ctx.createBiquadFilter();
  shape.type = filter.type;
  shape.frequency.value = filter.frequency;
  if (filter.q) shape.Q.value = filter.q;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(shape);
  let last: AudioNode = shape;
  if (extra) {
    const second = ctx.createBiquadFilter();
    second.type = extra.type;
    second.frequency.value = extra.frequency;
    shape.connect(second);
    last = second;
  }
  last.connect(gain);
  gain.connect(out);
  if (sway) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = sway.rate;
    const depth = ctx.createGain();
    depth.gain.value = level * sway.depth;
    lfo.connect(depth);
    depth.connect(gain.gain);
    lfo.start(from);
    lfo.stop(to);
  }
  // Start each place at a different point in the noise so neighbouring scenes do not sound the same.
  source.start(from, (from * 0.37) % noise.duration);
  source.stop(to);
}

function addTanpura(ctx: Ctx, out: AudioNode, plan: BedPlan) {
  const harmonics = [0, 1, 0.62, 0.5, 0.36, 0.3, 0.22, 0.18, 0.12, 0.1, 0.08, 0.06, 0.05];
  const wave = ctx.createPeriodicWave(new Float32Array(harmonics), new Float32Array(harmonics.length));
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2200;
  tone.connect(out);
  const level = plan.calm ? 0.026 : 0.034;
  for (const { at, frequency } of tanpuraPlucks(plan)) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.015);
    gain.gain.setTargetAtTime(0, at + 0.015, 1.3);
    gain.connect(tone);
    // Two strings a hair apart in pitch give the tanpura's slow shimmer.
    for (const detune of [0, 4]) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(at);
      osc.stop(Math.min(plan.duration, at + 5));
    }
  }
}

function addFlute(ctx: Ctx, out: AudioNode, plan: BedPlan, breath: AudioBuffer) {
  const level = plan.calm ? 0.032 : 0.042;
  for (const { notes } of flutePhrases(plan)) {
    const start = notes[0].at;
    const end = notes[notes.length - 1].at + notes[notes.length - 1].length;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.connect(out);
    const body = ctx.createOscillator();
    body.type = "sine";
    const edge = ctx.createOscillator();
    edge.type = "triangle";
    const edgeGain = ctx.createGain();
    edgeGain.gain.value = 0.18;
    body.connect(gain);
    edge.connect(edgeGain);
    edgeGain.connect(gain);
    // A gentle vibrato, as a bansuri player adds on held notes.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.value = 9;
    vibrato.connect(depth);
    depth.connect(body.detune);
    depth.connect(edge.detune);
    let previous = 0;
    notes.forEach((note, n) => {
      // Two octaves above the drone's Sa, where a bansuri sings.
      const frequency = SA * 4 * 2 ** (note.semitone / 12);
      for (const osc of [body, edge]) {
        if (n === 0) osc.frequency.setValueAtTime(frequency, note.at);
        else {
          // A short glide into each note (meend).
          osc.frequency.setValueAtTime(previous, note.at);
          osc.frequency.exponentialRampToValueAtTime(frequency, note.at + 0.08);
        }
      }
      previous = frequency;
      // Each note swells a little, with a slight dip between notes.
      gain.gain.linearRampToValueAtTime(level * (n === 0 ? 0.9 : 0.75), note.at + 0.04);
      gain.gain.linearRampToValueAtTime(level, note.at + Math.min(0.25, note.length * 0.4));
      gain.gain.linearRampToValueAtTime(level * 0.85, note.at + note.length * 0.92);
    });
    gain.gain.linearRampToValueAtTime(0, end + 0.3);
    for (const osc of [body, edge, vibrato]) {
      osc.start(start);
      osc.stop(end + 0.4);
    }
    // A little breath at the start of the phrase.
    const air = ctx.createBufferSource();
    air.buffer = breath;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 1800;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0, start);
    airGain.gain.linearRampToValueAtTime(level * 0.12, start + 0.05);
    airGain.gain.linearRampToValueAtTime(0, start + 0.5);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(out);
    air.start(start, (start * 0.53) % breath.duration);
    air.stop(start + 0.6);
  }
}

/** Little bird calls: quick rising chirps from one bird, longer sliding whistles from another. */
function addBirds(ctx: Ctx, out: AudioNode, from: number, to: number, random: () => number, level: number) {
  for (let at = from + 0.4 + random() * 1.5; at < to - 0.6; at += 1.2 + random() * 2.6) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = random() * 1.4 - 0.7;
    pan.connect(out);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.connect(pan);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    let end = at;
    if (random() < 0.7) {
      const base = 2600 + random() * 1600;
      const syllables = 2 + Math.floor(random() * 3);
      let time = at;
      for (let s = 0; s < syllables; s++) {
        const length = 0.06 + random() * 0.05;
        osc.frequency.setValueAtTime(base, time);
        osc.frequency.exponentialRampToValueAtTime(base * (1.25 + random() * 0.35), time + length);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + 0.012);
        gain.gain.linearRampToValueAtTime(0, time + length);
        time += length + 0.05 + random() * 0.04;
      }
      end = time;
    } else {
      const base = 1700 + random() * 500;
      const length = 0.25 + random() * 0.15;
      osc.frequency.setValueAtTime(base, at);
      osc.frequency.linearRampToValueAtTime(base * 1.35, at + length * 0.6);
      osc.frequency.linearRampToValueAtTime(base * 1.1, at + length);
      gain.gain.linearRampToValueAtTime(level * 0.8, at + 0.04);
      gain.gain.linearRampToValueAtTime(0, at + length);
      end = at + length;
    }
    osc.start(at);
    osc.stop(end + 0.05);
  }
}

/** Two crickets, each chirping in short trills at its own pitch and pace. */
function addCrickets(ctx: Ctx, out: AudioNode, from: number, to: number, random: () => number, level: number) {
  for (const [pitch, side] of [
    [4500, -0.5],
    [4950, 0.45],
  ]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = pitch;
    // The trill: the sound pulses about 30 times a second.
    const trill = ctx.createGain();
    trill.gain.value = 0.5;
    const pulse = ctx.createOscillator();
    pulse.type = "square";
    pulse.frequency.value = 28 + random() * 6;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulse.connect(pulseDepth);
    pulseDepth.connect(trill.gain);
    const chirps = ctx.createGain();
    chirps.gain.setValueAtTime(0, from);
    const pan = ctx.createStereoPanner();
    pan.pan.value = side;
    osc.connect(trill);
    trill.connect(chirps);
    chirps.connect(pan);
    pan.connect(out);
    for (let at = from + random(); at < to - 0.4; at += 0.85 + random() * 0.5) {
      const length = 0.18 + random() * 0.12;
      chirps.gain.setValueAtTime(0, at);
      chirps.gain.linearRampToValueAtTime(level, at + 0.02);
      chirps.gain.setValueAtTime(level, at + length - 0.03);
      chirps.gain.linearRampToValueAtTime(0, at + length);
    }
    for (const node of [osc, pulse]) {
      node.start(from);
      node.stop(to);
    }
  }
}

/**
 * Seven seconds of crackles and pops (tiny bursts of noise at random moments),
 * written straight into a buffer once and looped, which is far quicker to
 * render than a separate sound for every pop.
 */
function crackleBuffer(ctx: Ctx, seed: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(7 * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = randomFrom(seed);
  for (let at = random() * 0.2; at < 6.9; at += 0.06 + random() * 0.3) {
    const start = Math.floor(at * ctx.sampleRate);
    const length = Math.floor((0.005 + random() * 0.025) * ctx.sampleRate);
    const size = 0.6 + random() * 1.4;
    for (let i = 0; i < length && start + i < data.length; i++) {
      data[start + i] += (random() * 2 - 1) * size * Math.exp((-5 * i) / length);
    }
  }
  return buffer;
}

/** A fire: a low, swaying roar with crackles and pops. */
function addFire(ctx: Ctx, out: AudioNode, crackles: AudioBuffer, brown: AudioBuffer, from: number, to: number, level: number) {
  noiseBed(ctx, out, brown, from, to, { type: "lowpass", frequency: 350 }, level, { rate: 0.3, depth: 0.4 });
  noiseBed(ctx, out, crackles, from, to, { type: "bandpass", frequency: 2500, q: 0.7 }, level * 0.9);
}

/** Dhol-style drums for an action scene: a deep "dha" and a sharp "tak" in a driving pattern, accented on each bar. */
function addDrums(ctx: Ctx, out: AudioNode, noise: AudioBuffer, from: number, to: number, level: number) {
  const step = 60 / 128 / 2;
  // Eight steps a bar: dha . tak dha | tak . dha tak
  const pattern = ["dha", "", "tak", "dha", "tak", "", "dha", "tak"];
  const fadeIn = Math.min(1.2, (to - from) / 3);
  for (let i = 0, at = from; at < to - 0.2; i++, at = from + i * step) {
    const hit = pattern[i % pattern.length];
    if (!hit) continue;
    const ramp = Math.min(1, (at - from) / fadeIn + 0.25);
    const accent = (i % pattern.length === 0 ? 1.25 : 1) * ramp;
    const gain = ctx.createGain();
    gain.connect(out);
    if (hit === "dha") {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(115, at);
      osc.frequency.exponentialRampToValueAtTime(48, at + 0.18);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * accent, at + 0.005);
      gain.gain.setTargetAtTime(0, at + 0.005, 0.11);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.6);
    } else {
      const tap = ctx.createBufferSource();
      tap.buffer = noise;
      const tone = ctx.createBiquadFilter();
      tone.type = "bandpass";
      tone.frequency.value = 2300;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * 0.55 * accent, at + 0.003);
      gain.gain.setTargetAtTime(0, at + 0.003, 0.03);
      tap.connect(tone);
      tone.connect(gain);
      tap.start(at, (at * 0.71) % (noise.duration - 0.2));
      tap.stop(at + 0.2);
    }
  }
}

/** The rush of air as a flyer passes: noise swept up and down in pitch, moving across from one side to the other. */
function addWhoosh(ctx: Ctx, out: AudioNode, noise: AudioBuffer, at: number, direction: 1 | -1, level: number) {
  const from = at - 0.6;
  const to = at + 0.6;
  const air = ctx.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const tone = ctx.createBiquadFilter();
  tone.type = "bandpass";
  tone.Q.value = 1.2;
  tone.frequency.setValueAtTime(500, from);
  tone.frequency.exponentialRampToValueAtTime(1800, at);
  tone.frequency.exponentialRampToValueAtTime(600, to);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, from);
  gain.gain.linearRampToValueAtTime(level, at);
  gain.gain.linearRampToValueAtTime(0, to);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(-0.8 * direction, from);
  pan.pan.linearRampToValueAtTime(0.8 * direction, to);
  air.connect(tone);
  tone.connect(gain);
  gain.connect(pan);
  pan.connect(out);
  air.start(from, (from * 0.37) % noise.duration);
  air.stop(to);
}

/** A deep boom as a fire catches: a falling low note with a soft burst of rumble. */
function addBoom(ctx: Ctx, out: AudioNode, brown: AudioBuffer, at: number, level: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(85, at);
  osc.frequency.exponentialRampToValueAtTime(34, at + 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.01);
  gain.gain.setTargetAtTime(0, at + 0.01, 0.18);
  osc.connect(gain);
  gain.connect(out);
  osc.start(at);
  osc.stop(at + 1);
  noiseBed(ctx, out, brown, at, at + 0.6, { type: "lowpass", frequency: 300 }, level * 0.8, undefined);
}

/** A soft temple bell now and then, ringing out slowly. */
function addBells(ctx: Ctx, out: AudioNode, from: number, to: number, random: () => number, level: number) {
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.32, 0.55],
    [4.25, 0.3],
    [6.63, 0.18],
  ];
  for (let at = from + 1 + random() * 2; at < to - 1; at += 8 + random() * 4) {
    for (const [ratio, share] of partials) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 740 * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * share, at + 0.005);
      gain.gain.setTargetAtTime(0, at + 0.005, 1.4 / ratio);
      osc.connect(gain);
      gain.connect(out);
      osc.start(at);
      osc.stop(Math.min(to + 0.4, at + 6));
    }
  }
}

function addNature(ctx: Ctx, out: AudioNode, plan: BedPlan) {
  const white = noiseBuffer(ctx, 3, plan.seed ^ 0x51, false);
  const brown = noiseBuffer(ctx, 5, plan.seed ^ 0xa7, true);
  const crackles = plan.scenes.some((scene) => scene.setting.fire) ? crackleBuffer(ctx, plan.seed ^ 0xf1) : null;
  const quiet = plan.calm ? 0.5 : 1;
  plan.scenes.forEach((scene, index) => {
    const bus = sceneGain(ctx, out, scene, index === 0);
    const from = Math.max(0, scene.start - 0.4);
    const to = Math.min(plan.duration, scene.end + 0.4);
    const random = randomFrom(plan.seed + index * 7919);
    const night = scene.setting.time === "night";
    for (const sound of natureFor(scene.setting)) {
      if (sound === "wind") noiseBed(ctx, bus, brown, from, to, { type: "lowpass", frequency: 420 }, (night ? 0.016 : 0.024) * quiet, { rate: 0.07, depth: 0.4 });
      if (sound === "snow wind") noiseBed(ctx, bus, white, from, to, { type: "bandpass", frequency: 700, q: 3 }, 0.02 * quiet, { rate: 0.05, depth: 0.5 });
      if (sound === "rain") {
        noiseBed(ctx, bus, white, from, to, { type: "highpass", frequency: 1500 }, 0.03 * quiet, undefined, { type: "lowpass", frequency: 8000 });
        noiseBed(ctx, bus, brown, from, to, { type: "lowpass", frequency: 300 }, 0.02 * quiet);
      }
      if (sound === "river") {
        noiseBed(ctx, bus, white, from, to, { type: "bandpass", frequency: 1000, q: 0.6 }, 0.03 * quiet);
        noiseBed(ctx, bus, white, from, to, { type: "bandpass", frequency: 2600, q: 1.2 }, 0.01 * quiet, { rate: 0.4, depth: 0.6 });
      }
      if (sound === "waves") noiseBed(ctx, bus, brown, from, to, { type: "lowpass", frequency: 800 }, 0.04 * quiet, { rate: 0.1, depth: 0.85 });
      if (sound === "leaves") noiseBed(ctx, bus, white, from, to, { type: "bandpass", frequency: 3500, q: 0.8 }, 0.004 * quiet, { rate: 0.12, depth: 0.8 });
      if (sound === "room") noiseBed(ctx, bus, brown, from, to, { type: "lowpass", frequency: 220 }, 0.012 * quiet);
      if (sound === "town") noiseBed(ctx, bus, brown, from, to, { type: "bandpass", frequency: 450, q: 0.7 }, 0.025 * quiet, { rate: 0.15, depth: 0.3 });
      if (sound === "birds") addBirds(ctx, bus, from, to, random, 0.024 * quiet);
      if (sound === "crickets") addCrickets(ctx, bus, from, to, random, 0.006 * quiet);
      if (sound === "bell") addBells(ctx, bus, from, to, random, 0.022 * quiet);
      if (sound === "fire" && crackles) addFire(ctx, bus, crackles, brown, from, to, 0.03 * quiet);
    }
    // An action scene: a whoosh as each flyer passes, and a boom as each fire catches.
    for (let flyer = 0; flyer < scene.flyers; flyer++) {
      for (const pass of passMiddles(scene.end - scene.start, flyer)) {
        addWhoosh(ctx, bus, white, scene.start + pass.at, pass.direction, 0.07);
      }
    }
    for (const ignite of scene.ignitions) addBoom(ctx, bus, brown, scene.start + ignite, 0.09);
  });
}

/** Renders the music and nature sounds into one buffer, faster than real time. */
export async function renderSoundBed(plan: BedPlan): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(plan.duration * BED_RATE)), BED_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  // Fade in at the start and out at the very end; louder when there are no voices to make room for.
  const level = plan.voices ? 1 : 1.8;
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(level, Math.min(1.2, plan.duration / 3));
  master.gain.setValueAtTime(level, Math.max(Math.min(1.2, plan.duration / 3), plan.duration - 2));
  master.gain.linearRampToValueAtTime(0, plan.duration);

  const music = ctx.createGain();
  music.connect(master);
  stepBack(music.gain, plan.speech, plan.calm ? 0.7 : 1, plan.calm ? 0.25 : 0.35);
  const nature = ctx.createGain();
  nature.connect(master);
  stepBack(nature.gain, plan.speech, 1, 0.6);

  const breath = noiseBuffer(ctx, 1, plan.seed ^ 0x3c, false);
  addTanpura(ctx, music, plan);
  addFlute(ctx, music, plan, breath);
  // Drums drive every action scene.
  for (const scene of plan.scenes) {
    if (scene.flyers > 0) addDrums(ctx, music, breath, scene.start, scene.end, 0.11);
  }
  addNature(ctx, nature, plan);
  return ctx.startRendering();
}

/** A short key for a plan: two plans with the same key sound the same. */
export function bedKey(plan: BedPlan): string {
  return JSON.stringify(plan);
}
