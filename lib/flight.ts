/**
 * Characters who fly through a scene (Hanuman leaping over Lanka, a bird):
 * fast, swooping passes across the picture, each one coming back the other
 * way. Everything is worked out from the time alone, so the picture, the
 * camera that follows the flyer, the fire that catches where they pass and
 * the whoosh of each pass all line up, in the preview and in the video.
 */

/** One crossing of the picture, in seconds. */
export const FLIGHT_PASS_SEC = 2.4;
/** The flyer is just off screen for this long before coming back. */
const FLIGHT_GAP_SEC = 0.35;
/** Calm stories fly more slowly. */
const CALM_SLOWER = 1.8;
/** How far beyond each edge a pass starts and ends, as a fraction of the width. */
const OVERSHOOT = 0.25;

export type FlightPoint = {
  /** Centre, as fractions of the width and height (x goes past 0 and 1 when off screen). */
  x: number;
  y: number;
  /** 1 flying right, -1 flying left. */
  direction: 1 | -1;
  /** Nose up (negative) while rising, down while falling, in radians, before mirroring. */
  tilt: number;
  visible: boolean;
};

const cycleSec = (calm: boolean) => (FLIGHT_PASS_SEC + FLIGHT_GAP_SEC) * (calm ? CALM_SLOWER : 1);
const passSec = (calm: boolean) => FLIGHT_PASS_SEC * (calm ? CALM_SLOWER : 1);
/** A gentle start and finish to each pass, fastest in the middle. */
const swoop = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);
/** Each pass flies at its own height, so the passes do not look repeated. */
const HEIGHTS = [0.36, 0.3, 0.42, 0.33];

/** Where flyer number `flyer` is, `sceneLocal` seconds into the scene. A second flyer follows half a pass behind. */
export function flightAt(sceneLocal: number, flyer = 0, calm = false): FlightPoint {
  const cycle = cycleSec(calm);
  const t = Math.max(0, sceneLocal - flyer * cycle * 0.5);
  const pass = Math.floor(t / cycle);
  const p = Math.min(1, (t - pass * cycle) / passSec(calm));
  const direction: 1 | -1 = pass % 2 === 0 ? 1 : -1;
  const across = -OVERSHOOT + (1 + 2 * OVERSHOOT) * swoop(p);
  const x = direction === 1 ? across : 1 - across;
  // A leap: up in the middle of the pass, lower at both ends.
  const y = HEIGHTS[pass % HEIGHTS.length] + 0.1 * (1 - Math.sin(Math.PI * p));
  const tilt = -0.32 * Math.cos(Math.PI * p);
  return { x, y, direction, tilt, visible: x > -0.3 && x < 1.3 };
}

/** When flyer number `flyer` first flies over the point `x` (a fraction of the width), in seconds into the scene. */
export function firstPassAt(x: number, flyer = 0, calm = false): number {
  const across = Math.min(1, Math.max(0, (x + OVERSHOOT) / (1 + 2 * OVERSHOOT)));
  const p = Math.acos(1 - 2 * across) / Math.PI;
  return flyer * cycleSec(calm) * 0.5 + p * passSec(calm);
}

/** The moments each pass crosses the middle of the picture, for the whoosh, within `duration` seconds. */
export function passMiddles(duration: number, flyer = 0, calm = false): Array<{ at: number; direction: 1 | -1 }> {
  const cycle = cycleSec(calm);
  const middles: Array<{ at: number; direction: 1 | -1 }> = [];
  for (let pass = 0; ; pass++) {
    const at = flyer * cycle * 0.5 + pass * cycle + passSec(calm) / 2;
    if (at >= duration) break;
    middles.push({ at, direction: pass % 2 === 0 ? 1 : -1 });
  }
  return middles;
}
