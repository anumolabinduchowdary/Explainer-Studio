/**
 * Makes a recorded line flow like natural speech.
 *
 * Text-to-speech voices (Sarvam's especially) stop for a third of a second
 * or more at every comma and phrase, so a line sounds like separate pieces
 * stuck together, and every recording starts and ends with dead air. Here
 * every silence inside the line is shortened to a breath, and the dead air at
 * both ends is trimmed. Only quiet stretches are cut, never the words, and
 * each cut is softened with a short fade so it cannot click.
 */
export const PAUSES = {
  /** How long each loudness measurement is, in seconds. */
  window: 0.01,
  /** Quieter than this, below the line's loudest moment, counts as silence. */
  quietDb: -30,
  /** The longest a pause inside a line may be, in seconds: a natural breath. */
  maxInside: 0.16,
  /** Silence kept before the first word and after the last, in seconds. */
  keepStart: 0.02,
  keepEnd: 0.06,
  /** Length of the fade at each cut, in seconds. */
  fade: 0.008,
} as const;

/**
 * Returns the line's channels with long silences shortened, or the same
 * channels when there is nothing to change.
 */
export function tightenPauses(channels: Float32Array<ArrayBuffer>[], sampleRate: number): Float32Array<ArrayBuffer>[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return channels;
  const win = Math.max(1, Math.round(sampleRate * PAUSES.window));
  const frames = Math.ceil(length / win);

  // Loudness of each short window, across all channels.
  const level = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const end = Math.min(length, (f + 1) * win);
    let sum = 0;
    for (const channel of channels) for (let i = f * win; i < end; i++) sum += channel[i] * channel[i];
    level[f] = Math.sqrt(sum / ((end - f * win) * channels.length));
    if (level[f] > peak) peak = level[f];
  }
  if (peak === 0) return channels;
  const quiet = peak * 10 ** (PAUSES.quietDb / 20);
  const loud = (f: number) => level[f] >= quiet;

  let first = 0;
  while (first < frames && !loud(first)) first++;
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  if (first >= frames) return channels;

  // The parts to keep, in samples: everything except the middle of each long pause.
  const half = Math.round((PAUSES.maxInside / 2) * sampleRate);
  const parts: Array<[number, number]> = [];
  let start = Math.max(0, first * win - Math.round(PAUSES.keepStart * sampleRate));
  for (let f = first; f <= last; ) {
    if (loud(f)) {
      f++;
      continue;
    }
    const runStart = f;
    while (f <= last && !loud(f)) f++;
    if ((f - runStart) * win > 2 * half) {
      parts.push([start, runStart * win + half]);
      start = f * win - half;
    }
  }
  parts.push([start, Math.min(length, (last + 1) * win + Math.round(PAUSES.keepEnd * sampleRate))]);

  const total = parts.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (total >= length) return channels;
  const fade = Math.max(1, Math.round(PAUSES.fade * sampleRate));
  return channels.map((channel) => {
    const out = new Float32Array(total);
    let at = 0;
    for (const [from, to] of parts) {
      const piece = channel.subarray(from, to);
      out.set(piece, at);
      // Fade in and out at every cut (and at both ends), so no cut can click.
      const n = Math.min(fade, Math.floor(piece.length / 2));
      for (let i = 0; i < n; i++) {
        const gain = i / n;
        out[at + i] *= gain;
        out[at + piece.length - 1 - i] *= gain;
      }
      at += piece.length;
    }
    return out;
  });
}
