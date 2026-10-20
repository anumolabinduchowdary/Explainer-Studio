/**
 * Evens out how loud each voice clip is, so no character sounds much louder
 * or softer than the others (voice services return clips at different levels).
 *
 * The level is measured over the parts where someone is speaking (quiet gaps
 * are ignored), then the whole clip is turned up or down towards one target,
 * never so far that its loudest moment would clip.
 */

/** The speaking level every clip is brought to (about -20 dBFS RMS). */
export const TARGET_RMS = 0.1;
const PEAK_LIMIT = 0.89;
const WINDOW_SEC = 0.02;
/** Windows quieter than this (relative to the loudest) count as silence. */
const GATE = 0.1;
const MAX_GAIN = 4;
const MIN_GAIN = 0.25;

/** The gain that brings this recording to the target level. 1 means leave it as it is. */
export function loudnessGain(channels: Float32Array[], sampleRate: number): number {
  const samples = channels[0];
  if (!samples || samples.length === 0) return 1;
  const window = Math.max(1, Math.floor(sampleRate * WINDOW_SEC));
  const levels: number[] = [];
  let peak = 0;
  for (let start = 0; start < samples.length; start += window) {
    const end = Math.min(samples.length, start + window);
    let sum = 0;
    for (let i = start; i < end; i++) {
      for (const channel of channels) {
        const value = channel[i];
        sum += value * value;
        const size = Math.abs(value);
        if (size > peak) peak = size;
      }
    }
    levels.push(Math.sqrt(sum / ((end - start) * channels.length)));
  }
  const loudest = Math.max(...levels);
  if (loudest === 0 || peak === 0) return 1;
  const speaking = levels.filter((level) => level >= loudest * GATE);
  const rms = Math.sqrt(speaking.reduce((sum, level) => sum + level * level, 0) / speaking.length);
  const gain = Math.min(TARGET_RMS / rms, PEAK_LIMIT / peak, MAX_GAIN);
  return Math.max(MIN_GAIN, gain);
}

/** The recording at the target level, or the same arrays when it is already close. */
export function evenLoudness(channels: Float32Array<ArrayBuffer>[], sampleRate: number): Float32Array<ArrayBuffer>[] {
  const gain = loudnessGain(channels, sampleRate);
  if (Math.abs(gain - 1) < 0.05) return channels;
  return channels.map((channel) => channel.map((value) => value * gain));
}
