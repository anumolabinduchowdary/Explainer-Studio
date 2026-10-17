import { describe, expect, it } from "vitest";
import { PAUSES, tightenPauses } from "@/lib/pauses";

const RATE = 24000;

/** A recording made of tones and silences: [seconds, loud?] in order. */
function recording(...parts: Array<[number, boolean]>): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(parts.reduce((sum, [s]) => sum + s, 0) * RATE));
  let at = 0;
  for (const [seconds, loud] of parts) {
    const n = Math.round(seconds * RATE);
    if (loud) for (let i = 0; i < n; i++) out[at + i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += n;
  }
  return out;
}

/** The silent stretches in a recording, in seconds. */
function silences(samples: Float32Array): number[] {
  const win = Math.round(RATE * 0.005);
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < samples.length; i += win) {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) peak = Math.max(peak, Math.abs(samples[j]));
    if (peak < 0.01) run += win;
    else if (run) {
      runs.push(run / RATE);
      run = 0;
    }
  }
  if (run) runs.push(run / RATE);
  return runs;
}

describe("making a recorded line flow", () => {
  it("shortens a long pause inside a line to a breath, and keeps every word", () => {
    const line = recording([0.6, true], [0.45, false], [0.8, true]);
    const [out] = tightenPauses([line], RATE);
    const gaps = silences(out);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeGreaterThan(PAUSES.maxInside - 0.03);
    expect(gaps[0]).toBeLessThan(PAUSES.maxInside + 0.03);
    expect(out.length / RATE).toBeCloseTo(0.6 + 0.8 + PAUSES.maxInside, 1);
  });

  it("trims the dead air before the first word and after the last", () => {
    const line = recording([0.3, false], [0.5, true], [0.5, false]);
    const [out] = tightenPauses([line], RATE);
    expect(out.length / RATE).toBeLessThan(0.5 + PAUSES.keepStart + PAUSES.keepEnd + 0.03);
    expect(out.length / RATE).toBeGreaterThan(0.5);
  });

  it("leaves short, natural pauses alone", () => {
    const line = recording([0.5, true], [0.1, false], [0.5, true]);
    const [out] = tightenPauses([line], RATE);
    expect(out.length).toBe(line.length);
    expect(silences(out)).toEqual(silences(line));
  });

  it("fades every cut so it cannot click", () => {
    const line = recording([0.4, true], [0.5, false], [0.4, true]);
    const [out] = tightenPauses([line], RATE);
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });

  it("keeps the channels of a stereo recording together, and leaves silence or nothing alone", () => {
    const left = recording([0.2, false], [0.5, true], [0.6, false], [0.5, true]);
    const right = recording([0.2, false], [0.5, true], [0.6, false], [0.5, true]);
    const [l, r] = tightenPauses([left, right], RATE);
    expect(l.length).toBe(r.length);
    expect(l.length).toBeLessThan(left.length);
    const quiet = [new Float32Array(RATE)];
    expect(tightenPauses(quiet, RATE)).toBe(quiet);
    const empty: Float32Array<ArrayBuffer>[] = [];
    expect(tightenPauses(empty, RATE)).toBe(empty);
  });
});
