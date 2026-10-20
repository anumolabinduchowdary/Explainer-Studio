import { describe, expect, it } from "vitest";
import { TARGET_RMS, evenLoudness, loudnessGain } from "@/lib/loudness";

const RATE = 24000;
/** One second of a tone at `level` RMS, then half a second of silence. */
function voice(level: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(RATE * 1.5);
  for (let i = 0; i < RATE; i++) samples[i] = level * Math.SQRT2 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return samples;
}
const rms = (samples: Float32Array<ArrayBuffer>) => Math.sqrt(samples.slice(0, RATE).reduce((sum, v) => sum + v * v, 0) / RATE);

describe("even voice loudness", () => {
  it("brings a soft voice and a loud voice to the same level, ignoring the silence", () => {
    const soft = evenLoudness([voice(0.03)], RATE)[0];
    const loud = evenLoudness([voice(0.3)], RATE)[0];
    expect(rms(soft)).toBeCloseTo(TARGET_RMS, 2);
    expect(rms(loud)).toBeCloseTo(TARGET_RMS, 2);
  });

  it("never turns a clip up so far that it would clip", () => {
    const spiky = voice(0.02);
    spiky[100] = 0.8;
    const gain = loudnessGain([spiky], RATE);
    expect(0.8 * gain).toBeLessThanOrEqual(0.89 + 1e-6);
  });

  it("leaves silence and clips already at the right level alone", () => {
    const silent = [new Float32Array(RATE)];
    expect(evenLoudness(silent, RATE)).toBe(silent);
    const right = [voice(TARGET_RMS)];
    expect(evenLoudness(right, RATE)).toBe(right);
  });
});
