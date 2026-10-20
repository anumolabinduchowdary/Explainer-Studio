import { firstPassAt } from "./flight";
import type { Dimensions } from "./renderer";
import type { StoryScene } from "./story";
import { randomFrom, seedFrom, type SceneSetting } from "./storyMood";

/**
 * The light and the small living touches in a story's backgrounds.
 *
 * - Mood light: one soft wash over the whole picture that is warm for happy
 *   scenes, cool for sad ones, deep blue at night and orange at dusk, darker
 *   towards the edges (it replaces the plain vignette, so it costs nothing extra).
 * - Lamps and candles make the light flicker very gently; a fire glows
 *   orange and flickers more.
 * - Embers rising where something is burning, fireflies at night, leaves or petals drifting down by day, specks of dust
 *   in the light indoors, and rain or snow when the place has it.
 *
 * Everything is worked out from the time alone, so the preview and the
 * downloaded video match. Characters never move: these touches are drawn
 * behind them. Calm (sensory-friendly) stories keep the light but have no
 * moving touches and no flicker.
 */

type Colour = readonly [number, number, number, number];
type Light = { centre: Colour; edge: Colour };

export const LIGHTS = {
  neutral: { centre: [255, 236, 200, 0], edge: [20, 12, 8, 0.26] },
  happy: { centre: [255, 206, 120, 0.08], edge: [70, 34, 6, 0.24] },
  sad: { centre: [110, 140, 200, 0.12], edge: [10, 18, 44, 0.32] },
  tense: { centre: [170, 70, 40, 0.07], edge: [34, 6, 4, 0.38] },
  dusk: { centre: [255, 150, 90, 0.1], edge: [54, 16, 24, 0.3] },
  night: { centre: [50, 70, 150, 0.16], edge: [4, 8, 32, 0.42] },
} as const satisfies Record<string, Light>;
export type LightName = keyof typeof LIGHTS;

/** Which light a scene gets: the time of day first, then the feeling of its lines. */
export function lightFor(setting: SceneSetting): LightName {
  if (setting.time === "night") return "night";
  if (setting.time === "dusk" && setting.feeling !== "sad" && setting.feeling !== "tense") return "dusk";
  return setting.feeling;
}

const LAMP: Colour = [255, 170, 80, 0.07];
const FIRE: Colour = [255, 130, 50, 0.1];

/** A gentle, uneven flicker between 0 and 1, like a flame. */
export function flicker(clock: number): number {
  return 0.5 + 0.25 * Math.sin(clock * 7.3) + 0.15 * Math.sin(clock * 13.1 + 1) + 0.1 * Math.sin(clock * 23.7 + 2);
}

const rgba = ([r, g, b, a]: Colour, scale = 1) => `rgba(${r}, ${g}, ${b}, ${(a * scale).toFixed(3)})`;

/** Paints the mood light over the stage, in screen space. */
export function drawMoodLight(
  ctx: CanvasRenderingContext2D,
  { width: W, height: H }: Dimensions,
  setting: SceneSetting,
  calm: boolean,
  clock: number,
) {
  const light = LIGHTS[lightFor(setting)];
  const strength = calm ? 0.6 : 1;
  // A fire or lamps warm the middle of the picture, with a flicker (steady in calm stories).
  const warm = setting.fire ? FIRE : setting.lamps ? LAMP : null;
  const lift = setting.fire ? 0.06 : 0.035;
  const centre: Colour = warm
    ? [warm[0], warm[1], warm[2], warm[3] + (calm ? lift / 2 : lift * flicker(clock))]
    : light.centre;
  const radius = Math.hypot(W, H) / 2;
  const wash = ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, radius);
  wash.addColorStop(0, rgba(centre, strength));
  wash.addColorStop(0.45, rgba(centre, strength));
  wash.addColorStop(1, rgba(light.edge, strength));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
}

/** The moving touches a scene has, for the description and tests. */
export function touchesFor(setting: SceneSetting): string[] {
  if (setting.rain) return ["rain"];
  if (setting.snow) return ["snow"];
  if (setting.fire) return ["embers"];
  const touches: string[] = [];
  const outside = !setting.indoors;
  if (setting.time === "night" && outside && (setting.nature || setting.water !== "none")) touches.push("fireflies");
  if (setting.time !== "night" && outside && setting.flowers) touches.push("petals");
  else if (setting.time !== "night" && outside && setting.nature) touches.push("leaves");
  if (setting.indoors && setting.time !== "night") touches.push("dust");
  return touches;
}

const TAU = Math.PI * 2;
const LEAF_COLOURS = [
  ["#7FB24A", "#4E7A2A"],
  ["#C9A23A", "#8A6B1E"],
  ["#D9822B", "#9A5418"],
] as const;
const PETAL_COLOURS = ["#F6B7C8", "#F9D2DC", "#F3A0B8"] as const;

/** Numbers that stay the same for a scene, so each leaf or firefly keeps its own path. */
function constants(seed: number, count: number, size: number): number[][] {
  const random = randomFrom(seed);
  return Array.from({ length: count }, () => Array.from({ length: size }, random));
}

/** Leaves or petals drifting slowly down, swaying and turning as they fall. */
function drawFalling(
  ctx: CanvasRenderingContext2D,
  { width: W, height: H }: Dimensions,
  seed: number,
  clock: number,
  petals: boolean,
) {
  const count = petals ? 9 : 7;
  const span = H * 1.15;
  for (const [index, r] of constants(seed, count, 10).entries()) {
    const speed = H * (petals ? 0.035 + 0.02 * r[0] : 0.05 + 0.03 * r[0]);
    const y = ((clock * speed + r[1] * span) % span) - H * 0.08;
    const x = W * (0.04 + 0.92 * r[2]) + Math.sin(clock * (0.5 + 0.4 * r[3]) + r[4] * TAU) * W * (petals ? 0.06 : 0.045);
    const angle = Math.sin(clock * (0.8 + 0.6 * r[5]) + r[6] * TAU) * 1.1 + r[7] * Math.PI;
    const size = W * (petals ? 0.007 + 0.004 * r[8] : 0.012 + 0.008 * r[8]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * (petals ? 0.62 : 0.45), angle, 0, TAU);
    if (petals) {
      ctx.fillStyle = PETAL_COLOURS[index % PETAL_COLOURS.length];
      ctx.fill();
      continue;
    }
    const [fill, vein] = LEAF_COLOURS[index % LEAF_COLOURS.length];
    ctx.fillStyle = fill;
    ctx.fill();
    // The leaf's middle vein.
    const dx = Math.cos(angle) * size * 0.9;
    const dy = Math.sin(angle) * size * 0.9;
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
}

/** Fireflies wandering slowly and glowing on and off, each at its own pace. */
function drawFireflies(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, floor: number, seed: number, clock: number) {
  for (const r of constants(seed, 12, 9)) {
    const x = W * (0.05 + 0.9 * r[0]) + Math.sin(clock * (0.18 + 0.15 * r[1]) + r[2] * TAU) * W * 0.05;
    const y = H * (0.2 + (floor - 0.25) * r[3]) + Math.cos(clock * (0.15 + 0.12 * r[4]) + r[5] * TAU) * H * 0.03;
    const glow = Math.max(0, Math.sin(clock * (0.7 + 0.6 * r[6]) + r[7] * TAU));
    const alpha = 0.15 + 0.85 * glow * glow;
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(210, 255, 120, ${(0.18 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, W * 0.014, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 190, ${(0.9 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, W * 0.0035, 0, TAU);
    ctx.fill();
  }
}

/** Tiny specks of dust floating in the light of a room. */
function drawDust(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, seed: number, clock: number) {
  for (const r of constants(seed, 14, 8)) {
    const x = W * (0.08 + 0.84 * r[0]) + Math.sin(clock * (0.12 + 0.1 * r[1]) + r[2] * TAU) * W * 0.03;
    const y = H * (0.12 + 0.6 * r[3]) + Math.sin(clock * (0.13 + 0.1 * r[4]) + r[5] * TAU) * H * 0.04;
    const alpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(clock * (0.5 + 0.5 * r[6]) + r[7] * TAU));
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(255, 240, 200, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, W * (0.002 + 0.002 * r[1]), 0, TAU);
    ctx.fill();
  }
}

/** Glowing embers swirling up from a fire, flickering and fading as they rise (more of them in an action scene). */
function drawEmbers(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, seed: number, clock: number, action: boolean) {
  const span = H * 1.2;
  for (const r of constants(seed, action ? 46 : 34, 9)) {
    const rise = (clock * H * (0.16 + 0.14 * r[0]) + r[1] * span) % span;
    const y = H * 1.05 - rise;
    const x = W * (0.03 + 0.94 * r[2]) + Math.sin(clock * (0.6 + 0.6 * r[3]) + r[4] * TAU) * W * 0.04;
    // Brightest low down, fading as they climb.
    const fade = Math.min(1, Math.max(0, y / H) * 1.4);
    const alpha = fade * (0.4 + 0.6 * Math.abs(Math.sin(clock * (2 + 3 * r[5]) + r[6] * TAU)));
    const size = W * (0.003 + 0.003 * r[7]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(255, 120, 40, ${(0.25 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size * 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 220, 120, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
}

/** Light rain, falling at a slight slant, drawn as one set of strokes. */
function drawRain(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, seed: number, clock: number) {
  const length = H * 0.04;
  const slant = 0.18;
  const span = H * 1.2;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(210, 225, 255, 0.35)";
  ctx.lineWidth = Math.max(1, W * 0.0016);
  ctx.beginPath();
  for (const r of constants(seed, W > H ? 90 : 70, 3)) {
    const y = ((clock * H * 1.4 * (0.85 + 0.3 * r[0]) + r[1] * span) % span) - H * 0.1;
    const x = r[2] * W * 1.2 - W * 0.2 + y * slant;
    ctx.moveTo(x, y);
    ctx.lineTo(x + slant * length, y + length);
  }
  ctx.stroke();
}

/** Snowflakes drifting down, drawn as one shape. */
function drawSnow(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, seed: number, clock: number) {
  const span = H * 1.1;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  for (const r of constants(seed, 40, 6)) {
    const y = ((clock * H * (0.04 + 0.03 * r[0]) + r[1] * span) % span) - H * 0.05;
    const x = r[2] * W + Math.sin(clock * (0.4 + 0.4 * r[3]) + r[4] * TAU) * W * 0.03;
    const size = W * (0.003 + 0.003 * r[5]);
    ctx.moveTo(x + size, y);
    ctx.arc(x, y, size, 0, TAU);
  }
  ctx.fill();
}

/**
 * Paints a scene's moving touches over its background (in the background's
 * own space, so they move with the camera), before the characters.
 */
export function drawAmbience(
  ctx: CanvasRenderingContext2D,
  dims: Dimensions,
  floor: number,
  setting: SceneSetting,
  seed: number,
  clock: number,
  action = false,
) {
  const touches = touchesFor(setting);
  if (touches.length === 0) return;
  ctx.save();
  for (const touch of touches) {
    if (touch === "rain") drawRain(ctx, dims, seed, clock);
    if (touch === "snow") drawSnow(ctx, dims, seed, clock);
    if (touch === "embers") drawEmbers(ctx, dims, seed, clock, action);
    if (touch === "fireflies") drawFireflies(ctx, dims, floor, seed, clock);
    if (touch === "leaves" || touch === "petals") drawFalling(ctx, dims, seed, clock, touch === "petals");
    if (touch === "dust") drawDust(ctx, dims, seed, clock);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Fire in an action scene                                             */
/* ------------------------------------------------------------------ */

/** One cartoon flame: three nested tongues of fire (red, orange, yellow), its tip swaying by `sway`. */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, sway: number) {
  const tongue = (scale: number, colour: string) => {
    const tw = w * scale;
    const th = h * (0.35 + 0.65 * scale);
    const tip = sway * scale;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x + tip, baseY - th);
    ctx.bezierCurveTo(x + tw * 0.55 + tip * 0.5, baseY - th * 0.55, x + tw * 0.75, baseY - th * 0.12, x, baseY);
    ctx.bezierCurveTo(x - tw * 0.75, baseY - th * 0.12, x - tw * 0.55 + tip * 0.5, baseY - th * 0.55, x + tip, baseY - th);
    ctx.fill();
  };
  tongue(1, "#E8461E");
  tongue(0.68, "#FF8A1F");
  tongue(0.38, "#FFD84A");
}

/** A place in the picture where fire catches, and when it does (in seconds into the scene). */
export type FireSpot = { x: number; y: number; size: number; phase: number; ignite: number };

/**
 * Where the fires of an action scene burn: nine spots across the picture, on
 * the rooftops (the middle band of the background). `igniteAt` says when each
 * one catches, for example as the flyer passes over it.
 */
export function fireSpots(seed: number, igniteAt: (x: number, index: number) => number): FireSpot[] {
  return constants(seed ^ 0x5f, 9, 4).map((r, i) => {
    const x = 0.05 + (0.9 * (i + 0.5 + (r[0] - 0.5) * 0.6)) / 9;
    return { x, y: 0.44 + 0.16 * r[1], size: 0.06 + 0.06 * r[2], phase: r[3] * TAU, ignite: igniteAt(x, i) };
  });
}

/**
 * The fires of a burning scene: they catch where the flyer passes, or spread
 * across the picture from left to right when nobody flies. The picture and the
 * sound (the boom as each one catches) both use this.
 */
export function firesFor(scene: StoryScene, calm: boolean): FireSpot[] {
  const flying = (scene.flying ?? []).some((id) => scene.onStage.includes(id));
  return fireSpots(seedFrom(`${scene.id}:${scene.locationId}`), (x, i) => (flying ? firstPassAt(x, 0, calm) : 0.2 + i * 0.18));
}

/** How far a flame has burst up, `since` seconds after it caught: a quick rise that overshoots a little. */
function burst(since: number): number {
  const t = Math.min(1, Math.max(0, since / 0.4));
  const back = 1.7;
  return t <= 0 ? 0 : 1 + (back + 1) * Math.pow(t - 1, 3) + back * Math.pow(t - 1, 2);
}

/** Paints the fires that have caught by `sceneLocal`, flickering, in the background's own space. */
export function drawSpreadingFire(
  ctx: CanvasRenderingContext2D,
  { width: W, height: H }: Dimensions,
  spots: FireSpot[],
  sceneLocal: number,
  clock: number,
) {
  ctx.save();
  for (const spot of spots) {
    const grow = burst(sceneLocal - spot.ignite);
    if (grow <= 0) continue;
    const h = H * spot.size * grow * (1 + 0.14 * Math.sin(clock * 9.3 + spot.phase) + 0.08 * Math.sin(clock * 15.7 + spot.phase * 2));
    const w = h * 0.55;
    const x = W * spot.x;
    const y = H * spot.y;
    ctx.globalAlpha = 1;
    // A soft glow around the flame, fading to nothing at its edge.
    const glow = ctx.createRadialGradient(x, y - h * 0.4, 0, x, y - h * 0.4, h * 1.1);
    glow.addColorStop(0, "rgba(255, 150, 50, 0.32)");
    glow.addColorStop(1, "rgba(255, 150, 50, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - h * 0.4, h * 1.1, 0, TAU);
    ctx.fill();
    drawFlame(ctx, x, y, w, h, w * 0.3 * Math.sin(clock * 6.1 + spot.phase));
  }
  ctx.restore();
}

/** A flash of firelight just after each fire catches (0 to 0.18), for the whole picture. */
export function fireFlash(spots: FireSpot[], sceneLocal: number): number {
  let flash = 0;
  for (const spot of spots) {
    const since = sceneLocal - spot.ignite;
    if (since >= 0 && since < 0.3) flash += 0.1 * (1 - since / 0.3);
  }
  return Math.min(0.18, flash);
}

/** Big embers rushing up close to the camera, in front of everything, for depth (screen space). */
export function drawForegroundEmbers(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, seed: number, clock: number) {
  const span = H * 1.3;
  ctx.save();
  for (const r of constants(seed ^ 0x77, 7, 6)) {
    const y = H * 1.15 - ((clock * H * (0.45 + 0.3 * r[0]) + r[1] * span) % span);
    const x = W * (0.02 + 0.96 * r[2]) + Math.sin(clock * (1.2 + r[3]) + r[4] * TAU) * W * 0.05;
    const size = W * (0.008 + 0.008 * r[5]);
    const alpha = 0.55 * Math.min(1, Math.max(0, y / H) * 1.6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(255, 110, 30, ${(0.22 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 210, 120, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
