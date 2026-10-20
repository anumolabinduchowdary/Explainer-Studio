/**
 * Sound for cartoon stories: decodes voice clips, plays them (and the
 * background music and nature sounds, see lib/soundBed.ts) in step with the
 * picture and feeds them into the recording.
 */

import { evenLoudness } from "./loudness";
import { tightenPauses } from "./pauses";

/** Loudness is sampled this many times a second, to drive the mouth. */
const ENVELOPE_RATE = 50;
const QUIET = 0.08;

/** One spoken line, ready to play. */
export type Clip = {
  buffer: AudioBuffer;
  duration: number;
  /** Loudness over time (0 to 1), ENVELOPE_RATE values per second. */
  envelope: Float32Array;
  /** When the voice is actually heard within the clip, in seconds. */
  speechStart: number;
  speechEnd: number;
};

/** True when the voice is loud enough at `time` for the mouth to be open. */
export function isMouthOpen(clip: Clip, time: number): boolean {
  const index = Math.floor(time * ENVELOPE_RATE);
  return index >= 0 && index < clip.envelope.length && clip.envelope[index] > 0.2;
}

function analyse(buffer: AudioBuffer): Pick<Clip, "envelope" | "speechStart" | "speechEnd"> {
  const samples = buffer.getChannelData(0);
  const window = Math.max(1, Math.floor(buffer.sampleRate / ENVELOPE_RATE));
  const envelope = new Float32Array(Math.ceil(samples.length / window));
  let peak = 0;
  for (let i = 0; i < envelope.length; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * window);
    for (let j = i * window; j < end; j++) sum += samples[j] * samples[j];
    envelope[i] = Math.sqrt(sum / window);
    if (envelope[i] > peak) peak = envelope[i];
  }
  let first = 0;
  let last = envelope.length - 1;
  if (peak > 0) {
    for (let i = 0; i < envelope.length; i++) envelope[i] /= peak;
    while (first < envelope.length - 1 && envelope[first] < QUIET) first++;
    while (last > first && envelope[last] < QUIET) last--;
  }
  return {
    envelope,
    speechStart: first / ENVELOPE_RATE,
    speechEnd: Math.min(buffer.duration, (last + 1) / ENVELOPE_RATE),
  };
}

/**
 * The recording with its long silences shortened to a breath (see lib/pauses.ts), so the line
 * flows, and brought to the same loudness as every other voice (see lib/loudness.ts).
 */
function flowing(context: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const tightened = evenLoudness(tightenPauses(channels, buffer.sampleRate), buffer.sampleRate);
  if (tightened === channels) return buffer;
  const result = context.createBuffer(tightened.length, tightened[0].length, buffer.sampleRate);
  tightened.forEach((data, c) => result.copyToChannel(data, c));
  return result;
}

/** Re-renders a recording at a different speed, shifting its pitch with it. */
async function resample(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(buffer.length / rate));
  const offline = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

export type ScheduledClip = { at: number; clip: Clip };

/** A safety limiter: only the very loudest moments are held back, so voices and music together never distort. */
function limiter(context: BaseAudioContext): DynamicsCompressorNode {
  const node = context.createDynamicsCompressor();
  node.threshold.value = -3;
  node.knee.value = 2;
  node.ratio.value = 20;
  node.attack.value = 0.003;
  node.release.value = 0.15;
  return node;
}

/**
 * A small audio player built on the Web Audio API. While it is running it is
 * also the clock for the picture, so sound and animation cannot drift apart.
 */
export class StoryAudio {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private readonly recordingTap: MediaStreamAudioDestinationNode;
  private playing: AudioBufferSourceNode[] = [];
  private bedSource: AudioBufferSourceNode | null = null;
  private startedAt: number | null = null;
  private startTime = 0;

  constructor() {
    this.context = new AudioContext();
    // Start warming up straight away: the first start of a device's sound can take a moment.
    void this.context.resume();
    this.output = this.context.createGain();
    const safe = limiter(this.context);
    this.output.connect(safe);
    safe.connect(this.context.destination);
    // A second outlet carries the same sound into the recorded video.
    this.recordingTap = this.context.createMediaStreamDestination();
    safe.connect(this.recordingTap);
  }

  /**
   * Turns a recording into a playable clip. With a `rate` other than 1 the
   * clip is re-rendered faster or slower, which raises or lowers its pitch:
   * that is how an adult voice is made to sound like a child or an older person.
   */
  async decode(dataUrl: string, rate = 1): Promise<Clip> {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    let buffer = flowing(this.context, await this.context.decodeAudioData(bytes));
    if (rate !== 1) buffer = await resample(buffer, rate);
    return { buffer, duration: buffer.duration, ...analyse(buffer) };
  }

  /**
   * Starts sound from `time` seconds into the story, with the music and nature
   * sounds (`bed`) when they are ready. Call from a click or key press.
   */
  start(time: number, schedule: ScheduledClip[], bed: AudioBuffer | null = null) {
    this.stop();
    void this.context.resume();
    const base = this.context.currentTime + 0.05;
    for (const { at, clip } of schedule) {
      if (at + clip.duration <= time) continue;
      const source = this.context.createBufferSource();
      source.buffer = clip.buffer;
      source.connect(this.output);
      source.start(base + Math.max(0, at - time), Math.max(0, time - at));
      this.playing.push(source);
    }
    this.startedAt = base;
    this.startTime = time;
    if (bed) this.playBed(bed, base, time);
  }

  private playBed(bed: AudioBuffer, when: number, from: number) {
    try {
      this.bedSource?.stop();
    } catch {
      // Already finished.
    }
    this.bedSource = null;
    if (from >= bed.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = bed;
    source.connect(this.output);
    source.start(when, from);
    this.bedSource = source;
    this.playing.push(source);
  }

  /** Brings in the music and nature sounds that finished preparing after playback started. */
  joinBed(bed: AudioBuffer) {
    const now = this.now();
    if (now === null) return;
    this.playBed(bed, this.context.currentTime + 0.05, now + 0.05);
  }

  stop() {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
      source.disconnect();
    }
    this.playing = [];
    this.bedSource = null;
    this.startedAt = null;
  }

  /** Position in the story by the audio clock, or null when sound is not running. */
  now(): number | null {
    if (this.startedAt === null || this.context.state !== "running") return null;
    return this.startTime + Math.max(0, this.context.currentTime - this.startedAt);
  }

  /**
   * Resolves once the sound clock is actually ticking (or after a short
   * wait). Used before recording so the video does not open on a frozen frame.
   */
  async whenRunning(timeoutMs = 3000): Promise<void> {
    void this.context.resume();
    const first = this.context.currentTime;
    const deadline = performance.now() + timeoutMs;
    while (this.context.currentTime === first && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Mixes every scheduled clip, and the music and nature sounds, into one
   * sound track covering the whole video, for building the downloadable file.
   * Nothing is played aloud.
   */
  async mixdown(schedule: ScheduledClip[], duration: number, bed: AudioBuffer | null = null): Promise<AudioBuffer> {
    const rate = 48_000;
    const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
    const safe = limiter(offline);
    safe.connect(offline.destination);
    const sources = bed ? [{ at: 0, buffer: bed }, ...schedule.map(({ at, clip }) => ({ at, buffer: clip.buffer }))] : schedule.map(({ at, clip }) => ({ at, buffer: clip.buffer }));
    for (const { at, buffer } of sources) {
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(safe);
      source.start(at);
    }
    return offline.startRendering();
  }

  /** Plays a single clip straight away, for "Listen" buttons. */
  preview(clip: Clip) {
    this.start(0, [{ at: 0, clip }]);
  }

  /** The audio track to add to a recording. */
  recordingStream(): MediaStream {
    return this.recordingTap.stream;
  }

  dispose() {
    this.stop();
    void this.context.close();
  }
}
