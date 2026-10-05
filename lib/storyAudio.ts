/**
 * Sound for cartoon stories: decodes voice clips, plays them in step with
 * the picture and feeds them into the recording.
 */

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

export type ScheduledClip = { at: number; clip: Clip };

/**
 * A small audio player built on the Web Audio API. While it is running it is
 * also the clock for the picture, so sound and animation cannot drift apart.
 */
export class StoryAudio {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private readonly recordingTap: MediaStreamAudioDestinationNode;
  private playing: AudioBufferSourceNode[] = [];
  private startedAt: number | null = null;
  private startTime = 0;

  constructor() {
    this.context = new AudioContext();
    // Start warming up straight away: the first start of a device's sound can take a moment.
    void this.context.resume();
    this.output = this.context.createGain();
    this.output.connect(this.context.destination);
    // A second outlet carries the same sound into the recorded video.
    this.recordingTap = this.context.createMediaStreamDestination();
    this.output.connect(this.recordingTap);
  }

  async decode(dataUrl: string): Promise<Clip> {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    const buffer = await this.context.decodeAudioData(bytes);
    return { buffer, duration: buffer.duration, ...analyse(buffer) };
  }

  /** Starts sound from `time` seconds into the story. Call from a click or key press. */
  start(time: number, schedule: ScheduledClip[]) {
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
