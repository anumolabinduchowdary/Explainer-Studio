import { dimensionsFor, type Dimensions, type FrameOptions } from "./renderer";
import { flightAt } from "./flight";
import {
  drawAmbience,
  drawFlame,
  drawForegroundEmbers,
  drawMoodLight,
  drawSpreadingFire,
  fireFlash,
  firesFor,
} from "./storyAtmosphere";
import { sceneSetting, seedFrom } from "./storyMood";
import {
  NARRATOR,
  SCENE_LEAD_SEC,
  STORY_LIMITS,
  captionChunks,
  characterName,
  estimateLine,
  feelingAt,
  gestureAt,
  locateStory,
  sceneDuration,
  NO_GESTURE,
  type Emotion,
  type ExerciseCard,
  type Story,
  type StoryCharacter,
  type StoryLine,
  type StoryScene,
  type TimeLine,
} from "./story";

/**
 * Draws a cartoon story: a background, up to five characters standing in
 * it (a bigger group stands in two rows), and word-by-word captions. The
 * speaker talks with their hands, blending smoothly between poses, opens and
 * closes their mouth (when a talking pose has been drawn). Everyone else
 * stands perfectly still: nobody bounces, breathes, nods or leans. The camera
 * glides in on whoever is speaking, and scenes fade softly into each other.
 *
 * Like the explainer renderer, one function paints any moment, and both the
 * preview and the recording use it.
 */

/** A picture ready to draw on canvas. */
export type Sprite = {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** A cropped copy for thumbnails, when the picture had empty space around it. */
  previewUrl?: string;
  /** Where the feet are, in pixels from the left edge. Lines up different poses. */
  feetX?: number;
};

export type CharacterSprites = {
  idle: Sprite;
  talk?: Sprite;
  /**
   * Gesture poses (a hand raised, both hands open), each with its mouth-open
   * twin. The speaker moves into and out of them while talking.
   */
  gestures?: Array<{ idle: Sprite; talk?: Sprite }>;
  /**
   * The same character with a feeling on their face (happy, sad…), each with
   * its mouth-open twin. Used while the character says a line with that feeling.
   */
  expressions?: ReadonlyMap<Emotion, { idle: Sprite; talk?: Sprite }>;
  /** The character flying (body level, heading right), for scenes they fly through. */
  flying?: Sprite;
};

export type StoryRenderAssets = {
  characters: ReadonlyMap<string, CharacterSprites>;
  places: ReadonlyMap<string, Sprite>;
  /** Home exercise programmes: each scene's exercise picture, by scene id. */
  cards?: ReadonlyMap<string, Sprite>;
  headingFont: string;
  /** Line timings. Defaults to an estimate from the number of words. */
  timeLine?: TimeLine;
  /**
   * With voices: whether the speaker's mouth is open at this moment of the
   * line, from the loudness of the recording. Null means "no voice clip".
   */
  mouthOpen?: (line: StoryLine, lineLocal: number) => boolean | null;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Layout = {
  /** Where the characters' feet rest, as a fraction of the height. */
  floor: number;
  /** Character height by size, as a fraction of the height. */
  heights: Record<StoryCharacter["size"], number>;
  captionY: number;
  captionSize: number;
  /** How much higher the back row stands when a group needs two rows. */
  rowLift: number;
};

function layoutFor({ width: W, height: H }: Dimensions): Layout {
  if (W > H) {
    return {
      floor: 0.9,
      heights: { large: 0.62, medium: 0.52, small: 0.41 },
      captionY: 0.82,
      captionSize: H * 0.085,
      rowLift: 0.08,
    };
  }
  if (W === H) {
    return {
      floor: 0.88,
      heights: { large: 0.56, medium: 0.47, small: 0.37 },
      captionY: 0.79,
      captionSize: W * 0.072,
      rowLift: 0.08,
    };
  }
  // Tall videos keep the bottom clear, where phone apps put their own buttons and titles.
  return {
    floor: 0.84,
    heights: { large: 0.5, medium: 0.42, small: 0.33 },
    captionY: 0.735,
    captionSize: W * 0.092,
    rowLift: 0.09,
  };
}

/* ------------------------------------------------------------------ */
/* Where everyone stands                                               */
/* ------------------------------------------------------------------ */

const SLOTS: Record<number, number[]> = {
  1: [0.5],
  2: [0.29, 0.71],
  3: [0.2, 0.5, 0.8],
  4: [0.14, 0.38, 0.62, 0.86],
  5: [0.11, 0.305, 0.5, 0.695, 0.89],
};
const SLOT_WIDTH: Record<number, number> = { 1: 0.8, 2: 0.46, 3: 0.32, 4: 0.25, 5: 0.2 };

/**
 * Two rows, like a group photo, keyed by "people at the back + people at the
 * front". The back row stands in the gaps of the front row where it can.
 */
const ROWS: Record<string, { back: number[]; front: number[]; backWidth: number; frontWidth: number }> = {
  "1+3": { back: [0.5], front: [0.2, 0.5, 0.8], backWidth: 0.5, frontWidth: 0.3 },
  "2+2": { back: [0.2, 0.8], front: [0.38, 0.62], backWidth: 0.36, frontWidth: 0.25 },
  "3+1": { back: [0.2, 0.5, 0.8], front: [0.5], backWidth: 0.32, frontWidth: 0.3 },
  "1+4": { back: [0.5], front: [0.14, 0.38, 0.62, 0.86], backWidth: 0.5, frontWidth: 0.24 },
  "2+3": { back: [0.35, 0.65], front: [0.2, 0.5, 0.8], backWidth: 0.3, frontWidth: 0.3 },
  "3+2": { back: [0.2, 0.5, 0.8], front: [0.35, 0.65], backWidth: 0.32, frontWidth: 0.28 },
};
/** When everyone is a similar height, who steps back, so left-to-right still follows the cast order. */
const STEP_BACK: Record<number, number[]> = { 4: [0, 3, 1, 2], 5: [1, 3, 0, 2, 4] };

const SIZE_RANK: Record<StoryCharacter["size"], number> = { small: 0, medium: 1, large: 2 };
/** A typical character is a little under half as wide as they are tall. */
const TYPICAL_ASPECT = 0.45;
/** How wide a character without a picture yet is drawn, for its height. */
const PLACEHOLDER_ASPECT = 0.42;

/** With an exercise card at the top, the characters stand smaller below it. */
const CARD_SCALE = 0.72;
/**
 * Neighbours in a group may overlap a little (a picture's box is wider than
 * the body, with arms and props), so a crowded scene does not shrink
 * everyone more than it needs to.
 */
const GROUP_OVERLAP = 1.25;
/** Characters are never made smaller than this to fit a crowded scene; they stand closer instead. */
const MIN_STORY_SCALE = 0.65;

const aspectOf = (sprites: CharacterSprites | undefined) =>
  sprites ? sprites.idle.width / sprites.idle.height : PLACEHOLDER_ASPECT;

/**
 * One size for the whole story. Every character keeps exactly the same size
 * in every scene and in both rows, however many people share the stage: the
 * story is scaled once, so that its most crowded scene still fits (and the
 * exercise card, if any scene has one). Earlier versions shrank characters
 * scene by scene, so the same person changed size from one scene to the next.
 */
export function storyCharacterScale(
  story: Story,
  characters: StoryRenderAssets["characters"],
  dims: Dimensions,
): number {
  const { width: W, height: H } = dims;
  const { heights } = layoutFor(dims);
  let scale = story.scenes.some((scene) => scene.card) ? CARD_SCALE : 1;
  for (const scene of story.scenes) {
    const cast = sceneCast(story, scene);
    const places = arrangeStage(cast, dims);
    cast.forEach((character, i) => {
      const width = H * heights[character.size] * aspectOf(characters.get(character.id));
      const room = W * places[i].maxWidth * GROUP_OVERLAP;
      if (width * scale > room) scale = room / width;
    });
  }
  return Math.max(MIN_STORY_SCALE, scale);
}

/** The characters on screen in a scene, in the story's cast order. */
function sceneCast(story: Story, scene: Story["scenes"][number]): StoryCharacter[] {
  // Always in the story's cast order, so each character keeps the same side of the screen in every
  // scene, as in a film. (Scenes list who is on stage in any order, often the first speaker first.)
  // Characters flying through the scene are not standing: they are drawn on their flight path instead.
  const flyers = sceneFlyers(scene);
  return story.characters
    .filter((character) => scene.onStage.includes(character.id) && !flyers.includes(character.id))
    .slice(0, STORY_LIMITS.onStage);
}

/** The characters flying through a scene (only those on screen in it). */
function sceneFlyers(scene: StoryScene): string[] {
  return (scene.flying ?? []).filter((id) => scene.onStage.includes(id));
}



export type StagePlace = {
  /** Centre of the character, as a fraction of the width. */
  x: number;
  /** "back" characters stand a little higher and are painted first. */
  row: "front" | "back";
  /** The widest the character may be, as a fraction of the width. */
  maxWidth: number;
};

/**
 * Decides where each character on screen stands. Up to three share one row.
 * Four or five share a row when the frame is wide enough, and otherwise form
 * two rows with the taller characters behind, so every face stays in view.
 */
export function arrangeStage(
  cast: ReadonlyArray<Pick<StoryCharacter, "size">>,
  dims: Dimensions,
): StagePlace[] {
  const n = Math.min(cast.length, STORY_LIMITS.onStage);
  const people = cast.slice(0, n);
  const oneRow = () =>
    people.map((_, i) => ({ x: SLOTS[n][i], row: "front" as const, maxWidth: SLOT_WIDTH[n] }));
  if (n <= 3) return oneRow();

  const { heights } = layoutFor(dims);
  const needed = people.reduce(
    (sum, person) => sum + (heights[person.size] * dims.height * TYPICAL_ASPECT) / dims.width,
    0,
  );
  if (needed <= 1.1) return oneRow();

  const tall = people.flatMap((person, i) => (person.size === "small" ? [] : [i]));
  let back: number[];
  if (tall.length >= 1 && tall.length <= 3 && tall.length < n) {
    back = tall;
  } else {
    // Everyone is a similar height: two step back, the tallest first.
    back = [...STEP_BACK[n]]
      .sort((a, b) => SIZE_RANK[people[b].size] - SIZE_RANK[people[a].size])
      .slice(0, 2)
      .sort((a, b) => a - b);
  }
  const pattern = ROWS[`${back.length}+${n - back.length}`];
  let backSeat = 0;
  let frontSeat = 0;
  return people.map((_, i) =>
    back.includes(i)
      ? { x: pattern.back[backSeat++], row: "back" as const, maxWidth: pattern.backWidth }
      : { x: pattern.front[frontSeat++], row: "front" as const, maxWidth: pattern.frontWidth },
  );
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

function drawPlaceholderBackdrop(ctx: CanvasRenderingContext2D, { width: W, height: H }: Dimensions, floor: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#BFE9FF");
  sky.addColorStop(0.7, "#EAF8FF");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#A8DFA0";
  ctx.beginPath();
  ctx.ellipse(W * 0.25, H * (floor - 0.12), W * 0.6, H * 0.12, 0, 0, Math.PI * 2);
  ctx.ellipse(W * 0.85, H * (floor - 0.1), W * 0.55, H * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#E9D8B8";
  ctx.fillRect(0, H * (floor - 0.1), W, H);
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  place: Sprite | undefined,
  dims: Dimensions,
  floor: number,
  zoom: number,
) {
  const { width: W, height: H } = dims;
  if (!place) {
    drawPlaceholderBackdrop(ctx, dims, floor);
    return;
  }
  // Cover the frame, anchored to the bottom so the ground stays under the characters.
  const scale = Math.max(W / place.width, H / place.height) * zoom;
  const w = place.width * scale;
  const h = place.height * scale;
  ctx.drawImage(place.source, (W - w) / 2, H - h + (h - H) * 0.35, w, h);
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

/** Whether two pictures have nearly the same outline proportions (within 12%). */
function sameShape(a: Sprite, b: Sprite): boolean {
  return Math.abs((a.width / a.height) / (b.width / b.height) - 1) < 0.12;
}

const PLACEHOLDER_COLOURS = ["#F9A8D4", "#93C5FD", "#FCD34D", "#86EFAC", "#C4B5FD", "#FDBA74"];

/** A friendly stand-in shown until a character's picture has been drawn. */
function drawPlaceholderCharacter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colour: string,
  initial: string,
  headingFont: string,
) {
  const head = Math.min(w * 0.36, h * 0.17);
  ctx.fillStyle = colour;
  ctx.strokeStyle = "#2B2118";
  ctx.lineWidth = Math.max(4, h * 0.012);
  ctx.beginPath();
  ctx.roundRect(-w * 0.34, -h + head * 2.05, w * 0.68, h - head * 2.05, w * 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -h + head * 1.1, head, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2B2118";
  ctx.font = `700 ${head * 1.1}px ${headingFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, 0, -h + head * 1.18);
}


/* ------------------------------------------------------------------ */
/* Exercise cards                                                      */
/* ------------------------------------------------------------------ */

type TextLayout = { lines: string[]; size: number; height: number; font: string; maxWidth: number };

/** Breaks text into one or two lines inside `maxWidth`, shrinking it if needed. */
function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  font: string,
  weight = 700,
): TextLayout {
  const words = text.trim().split(/\s+/);
  for (let current = size; current >= size * 0.55; current *= 0.92) {
    const style = `${weight} ${current}px ${font}`;
    ctx.font = style;
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= 2 && lines.every((item) => ctx.measureText(item).width <= maxWidth)) {
      return { lines, size: current, height: lines.length * current * 1.15, font: style, maxWidth };
    }
  }
  const small = size * 0.55;
  return { lines: [text.trim().slice(0, 40)], size: small, height: small * 1.15, font: `${weight} ${small}px ${font}`, maxWidth };
}

function drawText(ctx: CanvasRenderingContext2D, layout: TextLayout, x: number, y: number, colour: string) {
  ctx.font = layout.font;
  ctx.fillStyle = colour;
  ctx.textBaseline = "top";
  layout.lines.forEach((item, i) => ctx.fillText(item, x, y + i * layout.size * 1.15, layout.maxWidth));
}

/** The card above the characters in a home exercise programme. */
function drawExerciseCard(
  ctx: CanvasRenderingContext2D,
  card: ExerciseCard,
  picture: Sprite | undefined,
  { width: W, height: H }: Dimensions,
  font: string,
) {
  const h = H * (W > H ? 0.4 : 0.37);
  // Wide and square videos put the picture on the left with the words beside it; tall ones put it on top.
  const sideBySide = (W * 0.9) / h > 1.8;
  // A side-by-side card is only as wide as it needs to be, so it does not cover the whole scene.
  const w = sideBySide ? Math.min(W * 0.9, h * 2.6) : W * 0.9;
  const x = (W - w) / 2;
  const y = H * 0.04;
  const pad = Math.min(w, h) * 0.05;
  const gap = pad * 0.3;

  // Lay the words out first: the picture gets whatever room they leave.
  const picSide = h - pad * 2;
  const textW = sideBySide ? w - picSide - pad * 3 : w - pad * 2;
  const titleSize = Math.min(w, h) * (sideBySide ? 0.13 : 0.085);
  const title = layoutText(ctx, card.title, textW, titleSize, font);
  const dose = card.dose.trim();
  const badgeH = dose ? titleSize * 0.95 : 0;
  const cautionText = card.caution?.trim();
  const caution = cautionText ? layoutText(ctx, `⚠ ${cautionText}`, textW, titleSize * 0.5, font, 600) : undefined;
  const textH = title.height + (dose ? gap + badgeH : 0) + (caution ? gap + caution.height : 0);

  ctx.shadowColor = "rgba(31, 20, 16, 0.25)";
  ctx.shadowBlur = Math.min(w, h) * 0.04;
  // Fully opaque, so shapes in the background never show through the card.
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.06);
  ctx.fill();
  ctx.shadowColor = "transparent";

  const picBox = sideBySide
    ? { x: x + pad, y: y + pad, w: picSide, h: picSide }
    : { x: x + pad, y: y + pad, w: w - pad * 2, h: Math.max(h * 0.35, h - pad * 2.6 - textH) };
  if (picture) {
    const scale = Math.min(picBox.w / picture.width, picBox.h / picture.height);
    const pw = picture.width * scale;
    const ph = picture.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(picBox.x + (picBox.w - pw) / 2, picBox.y + (picBox.h - ph) / 2, pw, ph, Math.min(pw, ph) * 0.05);
    ctx.clip();
    ctx.drawImage(picture.source, picBox.x + (picBox.w - pw) / 2, picBox.y + (picBox.h - ph) / 2, pw, ph);
    ctx.restore();
  } else {
    ctx.fillStyle = "#F1E9DD";
    ctx.beginPath();
    ctx.roundRect(picBox.x, picBox.y, picBox.w, picBox.h, Math.min(picBox.w, picBox.h) * 0.05);
    ctx.fill();
  }

  // Beside the picture the words are left-aligned and centred top to bottom; under it they are centred.
  const align: CanvasTextAlign = sideBySide ? "left" : "center";
  const left = sideBySide ? picBox.x + picBox.w + pad : x + pad;
  const textX = sideBySide ? left : x + w / 2;
  let textY = sideBySide ? y + Math.max(pad, (h - textH) / 2) : picBox.y + picBox.h + pad * 0.6;
  ctx.textAlign = align;
  drawText(ctx, title, textX, textY, "#2B2118");
  textY += title.height;
  if (dose) {
    textY += gap;
    ctx.font = `700 ${titleSize * 0.62}px ${font}`;
    const bw = Math.min(textW, ctx.measureText(dose).width + titleSize * 0.8);
    const bx = sideBySide ? left : textX - bw / 2;
    ctx.fillStyle = "#0F766E";
    ctx.beginPath();
    ctx.roundRect(bx, textY, bw, badgeH, badgeH / 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(dose, bx + bw / 2, textY + badgeH / 2, bw - titleSize * 0.8);
    textY += badgeH;
  }
  if (caution) {
    ctx.textAlign = align;
    drawText(ctx, caution, textX, textY + gap, "#9A3412");
  }
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------------ */
/* Captions                                                            */
/* ------------------------------------------------------------------ */

/** Who a caption belongs to: a character speaking, the narrator, or a character's thought. */
export type CaptionKind = "speech" | "narrator" | "thought";
const CAPTION_COLOURS: Record<CaptionKind, string> = { speech: "#FFFFFF", narrator: "#FFE8A3", thought: "#FFD3EE" };

/** A small heart, centred on (x, y), marking a thought. */
function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.45);
  ctx.bezierCurveTo(x - size * 0.95, y - size * 0.15, x - size * 0.5, y - size * 0.85, x, y - size * 0.35);
  ctx.bezierCurveTo(x + size * 0.5, y - size * 0.85, x + size * 0.95, y - size * 0.15, x, y + size * 0.45);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  kind: CaptionKind,
  dims: Dimensions,
  layout: Layout,
  headingFont: string,
) {
  const { width: W, height: H } = dims;
  const label = text.toLocaleUpperCase();
  const thought = kind === "thought";
  // Thoughts lean, like a voice inside the head, and make room for their heart.
  const weight = thought ? "italic 700" : "700";
  let size = layout.captionSize;
  ctx.font = `${weight} ${size}px ${headingFont}`;
  const widest = W * 0.86 - (thought ? size * 1.2 : 0);
  const measured = ctx.measureText(label).width;
  if (measured > widest) {
    size *= widest / measured;
    ctx.font = `${weight} ${size}px ${headingFont}`;
  }
  const textWidth = Math.min(measured, widest);
  const shift = thought ? size * 0.6 : 0;

  ctx.save();
  ctx.translate(W / 2, H * layout.captionY);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // A dark outline keeps the words readable over any background.
  ctx.strokeStyle = "#1F1410";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(label, shift, size * 0.05);
  ctx.strokeText(label, shift, 0);
  ctx.fillStyle = CAPTION_COLOURS[kind];
  ctx.fillText(label, shift, 0);
  if (thought) {
    ctx.lineWidth = size * 0.12;
    ctx.fillStyle = "#FF7FBF";
    drawHeart(ctx, shift - textWidth / 2 - size * 0.6, 0, size * 0.55);
  }
  ctx.restore();
}

/** How long the story's name stays at the top of the opening scene, in seconds. */
export const TITLE_SEC = 3.3;
const TITLE_IN_SEC = 0.5;
const TITLE_OUT_SEC = 0.7;

/** How visible the opening title is at `time` (0 to 1). It fades in, holds, then fades out. */
export function titleAlpha(time: number, settled = false): number {
  if (time < 0 || time >= TITLE_SEC) return 0;
  if (settled) return 1;
  return Math.min(easeOutCubic(clamp01(time / TITLE_IN_SEC)), clamp01((TITLE_SEC - time) / TITLE_OUT_SEC));
}

/** The story's name at the top of the picture, with a small gold ornament under it. It never moves. */
function drawOpeningTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  dims: Dimensions,
  layout: Layout,
  font: string,
  time: number,
  settled: boolean,
) {
  const text = title.trim();
  const alpha = titleAlpha(time, settled);
  if (!text || alpha <= 0) return;
  const { width: W, height: H } = dims;
  const block = layoutText(ctx, text, W * 0.84, layout.captionSize * 1.1, font, 800);
  const top = H * (W < H ? 0.1 : 0.07);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = block.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  block.lines.forEach((item, i) => {
    const y = top + i * block.size * 1.15;
    // A dark outline keeps the words readable over any background, like the captions.
    ctx.strokeStyle = "#1F1410";
    ctx.lineWidth = block.size * 0.2;
    ctx.strokeText(item, W / 2, y + block.size * 0.04, block.maxWidth);
    ctx.strokeText(item, W / 2, y, block.maxWidth);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(item, W / 2, y, block.maxWidth);
  });
  const y = top + block.height + block.size * 0.3;
  const half = Math.min(W * 0.16, block.size * 1.6);
  const gem = block.size * 0.13;
  ctx.lineCap = "round";
  for (const [colour, width] of [
    ["#1F1410", block.size * 0.12],
    ["#F2C14E", block.size * 0.05],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(W / 2 - half, y);
    ctx.lineTo(W / 2 - gem * 2, y);
    ctx.moveTo(W / 2 + gem * 2, y);
    ctx.lineTo(W / 2 + half, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(W / 2, y - gem);
  ctx.lineTo(W / 2 + gem, y);
  ctx.lineTo(W / 2, y + gem);
  ctx.lineTo(W / 2 - gem, y);
  ctx.closePath();
  ctx.fillStyle = "#F2C14E";
  ctx.fill();
  ctx.strokeStyle = "#1F1410";
  ctx.lineWidth = block.size * 0.04;
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

/** How long one scene fades into the next, in seconds. */
const CROSSFADE_SEC = 0.6;
/** How long the camera takes to glide to a new speaker, in seconds (calm stories glide more slowly). */
const SHOT_SEC = 0.7;
const CALM_SHOT_SEC = 1.2;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where the camera looks: the stage point at the centre of the frame, and how far it is zoomed in. */
export type Shot = { scale: number; cx: number; cy: number };

/** Where each character in a scene stands: their x, the line their feet stand on, and their height. */
function stageFor(story: Story, scene: StoryScene, assets: StoryRenderAssets, dims: Dimensions) {
  const { width: W, height: H } = dims;
  const layout = layoutFor(dims);
  const storyScale = storyCharacterScale(story, assets.characters, dims);
  const cast = sceneCast(story, scene);
  const places = arrangeStage(cast, dims);
  return cast.map((character, i) => {
    const floor = layout.floor - (places[i].row === "back" ? layout.rowLift : 0);
    return { id: character.id, x: W * places[i].x, feet: H * floor, h: H * layout.heights[character.size] * storyScale };
  });
}

/**
 * The close-up for a speaking character: the camera zooms in so the speaker
 * fills the frame, framed on their head and shoulders, never showing past the
 * edge of the picture. Null for the narrator, someone not on stage, or a scene
 * with an exercise card (which stays wide so the card never covers anyone).
 */
/** The action camera: a little closer in, tracking the flyer a moment behind, never past the picture's edges. */
function chase(story: Story, sceneLocal: number, dims: Dimensions): Shot {
  const { width: W, height: H } = dims;
  const calm = story.calm === true;
  const scale = calm ? 1.08 : 1.22;
  const point = flightAt(Math.max(0, sceneLocal - 0.15), 0, calm);
  const clampTo = (value: number, size: number) => Math.min(size - size / (2 * scale), Math.max(size / (2 * scale), value));
  return { scale, cx: clampTo(W * point.x, W), cy: clampTo(H * (0.5 + (point.y - 0.5) * 0.6), H) };
}

function closeUp(story: Story, scene: StoryScene, speaker: string, assets: StoryRenderAssets, dims: Dimensions): Shot | null {
  if (speaker === NARRATOR || scene.card) return null;
  const spot = stageFor(story, scene, assets, dims).find((place) => place.id === speaker);
  if (!spot) return null;
  const { width: W, height: H } = dims;
  const calm = story.calm === true;
  const scale = calm ? 1.15 : W > H ? 1.45 : W === H ? 1.35 : 1.3;
  const clampTo = (value: number, size: number) => Math.min(size - size / (2 * scale), Math.max(size / (2 * scale), value));
  return { scale, cx: clampTo(spot.x, W), cy: clampTo(spot.feet - spot.h * 0.62, H) };
}

/**
 * The camera at a moment: wide at the start of each scene and while the
 * narrator speaks, gliding in on each character as they start talking, and
 * across to the next speaker. Worked out from the time alone, so the preview
 * and the downloaded video always match.
 */
export function storyCamera(
  story: Story,
  time: number,
  assets: StoryRenderAssets,
  dims: Dimensions,
  settled = false,
): Shot {
  const wide: Shot = { scale: 1, cx: dims.width / 2, cy: dims.height / 2 };
  const timeLine = assets.timeLine ?? estimateLine;
  const moment = locateStory(story, time, timeLine);
  const scene = story.scenes[moment.sceneIndex];
  // An action scene: the camera follows whoever is flying instead of cutting to the speaker.
  if (sceneFlyers(scene).length > 0) return chase(story, moment.sceneLocal, dims);
  if (moment.lineIndex < 0) return wide;
  const shotOf = (index: number) => (index < 0 ? wide : (closeUp(story, scene, scene.lines[index].speaker, assets, dims) ?? wide));
  const to = shotOf(moment.lineIndex);
  if (settled) return to;
  const from = shotOf(moment.lineIndex - 1);
  const t = easeInOutCubic(clamp01(moment.lineLocal / (story.calm === true ? CALM_SHOT_SEC : SHOT_SEC)));
  // Glide in screen terms, so the zoom and the move stay smooth together.
  return {
    scale: from.scale + (to.scale - from.scale) * t,
    cx: from.cx + (to.cx - from.cx) * t,
    cy: from.cy + (to.cy - from.cy) * t,
  };
}

/**
 * Paints the stage at `time` (the background and the characters, through the camera), without
 * captions or cards. `clock` is the real moment in the video, which keeps the background's
 * moving touches going even while an earlier scene is held for the cross-fade.
 */
function paintStage(
  ctx: CanvasRenderingContext2D,
  story: Story,
  time: number,
  assets: StoryRenderAssets,
  settled: boolean,
  clock: number,
) {
  const dims = dimensionsFor(story.aspectRatio);
  const { width: W, height: H } = dims;
  const layout = layoutFor(dims);
  const timeLine = assets.timeLine ?? estimateLine;
  const moment = locateStory(story, time, timeLine);
  const scene = story.scenes[moment.sceneIndex];
  const line = moment.lineIndex >= 0 ? scene.lines[moment.lineIndex] : null;
  const timing = line ? timeLine(line) : null;
  const speakerId = line && line.speaker !== NARRATOR ? line.speaker : null;
  // A thought is heard but not said: the speaker's mouth stays closed and their hands stay still.
  const speaking =
    timing !== null &&
    !settled &&
    line?.thought !== true &&
    moment.lineLocal >= timing.speechStart &&
    moment.lineLocal < timing.speechEnd;
  // Follow the real voice when there is one; otherwise flap at a talking rhythm.
  const heard = line && speaking ? (assets.mouthOpen?.(line, moment.lineLocal) ?? null) : null;
  const mouthOpen = speaking && (heard ?? Math.sin(moment.lineLocal * Math.PI * 2 * 3.4) > -0.15);

  // Calm (sensory-friendly) stories move less: a slower push-in and a smaller, slower zoom.
  const calm = story.calm === true;
  const motion = calm ? 0.4 : 1;
  const camera = storyCamera(story, time, assets, dims, settled);
  ctx.setTransform(camera.scale, 0, 0, camera.scale, W / 2 - camera.scale * camera.cx, H / 2 - camera.scale * camera.cy);
  ctx.globalAlpha = 1;

  // A slow push-in keeps a still background from feeling frozen.
  const zoom = settled ? 1.05 : 1.03 + 0.012 * motion * Math.min(moment.sceneLocal, 6);
  drawBackdrop(ctx, assets.places.get(scene.locationId), dims, layout.floor, zoom);
  // Fireflies, drifting leaves or petals, dust in the light, rain or snow: behind everyone, and
  // never in calm stories (see lib/storyAtmosphere.ts).
  const setting = sceneSetting(story, scene);
  const flyers = sceneFlyers(scene);
  if (!calm) drawAmbience(ctx, dims, layout.floor, setting, seedFrom(`${scene.id}:${scene.locationId}`), clock, flyers.length > 0);
  // In a burning place, flames burst up one after another, where the flyer passes.
  const fires = setting.fire && !calm ? firesFor(scene, calm) : [];
  if (fires.length > 0) drawSpreadingFire(ctx, dims, fires, moment.sceneLocal, clock);
  // Every character is drawn at one size for the whole story (see storyCharacterScale).
  const storyScale = storyCharacterScale(story, assets.characters, dims);

  /* Characters: each keeps its place on screen (slot i) whatever the painting order. */
  const cast = sceneCast(story, scene);
  const places = arrangeStage(cast, dims);
  // Characters fade in where they stand at the start of a scene; they do not rise or jump.
  const arrive = settled ? 1 : easeOutCubic(clamp01(moment.sceneLocal / (SCENE_LEAD_SEC * 0.9)));

  // The back row is painted first. Within a row the speaker is painted last,
  // so a raised hand is never hidden behind a neighbour.
  const paintOrder = cast
    .map((character, i) => ({ character, i }))
    .sort(
      (a, b) =>
        Number(places[a.i].row === "front") - Number(places[b.i].row === "front") ||
        Number(a.character.id === speakerId) - Number(b.character.id === speakerId),
    );

  paintOrder.forEach(({ character, i }) => {
    const sprites = assets.characters.get(character.id);
    const isSpeaker = character.id === speakerId;

    const place = places[i];
    const atBack = place.row === "back";
    // The back row stands a step higher, at the same size, so nobody changes size between scenes.
    const floor = layout.floor - (atBack ? layout.rowLift : 0);
    const h = H * layout.heights[character.size] * storyScale;
    const w = h * aspectOf(sprites);

    const x = W * place.x;
    const facing = place.x > 0.5 ? -1 : 1; // pictures are drawn facing right
    // Everyone stands completely still: no breathing, nodding, leaning or bouncing.
    // Only faces and hands change, and the camera shows who is talking.
    const y = H * floor;

    ctx.save();
    ctx.globalAlpha = arrive;

    ctx.fillStyle = "rgba(31, 20, 16, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x, H * floor, w * 0.36, Math.max(6, h * 0.022), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, y);
    ctx.scale(facing, 1);
    if (sprites) {
      // While a character says a line with a feeling, their face shows it (and their hands stay still).
      // Feelings last: an angry king stays angry while others speak (see feelingAt in lib/story.ts).
      const feeling = feelingAt(scene, moment.lineIndex, character.id);
      const face = feeling ? sprites.expressions?.get(feeling) : undefined;
      const poses = face ? [] : (sprites.gestures ?? []);
      const hands =
        isSpeaker && speaking && poses.length > 0 && line && timing
          ? gestureAt(line, moment.lineLocal, timing, poses.length)
          : { pose: NO_GESTURE, from: NO_GESTURE, blend: 1 };
      const scale = h / sprites.idle.height;
      const feet = -w / 2 + (sprites.idle.feetX ?? sprites.idle.width / 2) * scale;
      /** Paints one pose. Every pose is lined up by the feet and drawn at the standing pose's scale. */
      const paint = (index: number, alpha: number) => {
        const set = index === NO_GESTURE ? (face ?? sprites) : (poses[index] ?? sprites);
        const base = set.idle;
        const pose = isSpeaker && mouthOpen && set.talk ? set.talk : base;
        ctx.globalAlpha = arrive * alpha;
        if (pose === base || sameShape(pose, base)) {
          // A pose and its mouth-open twin share one box, which lines them up even if the twin drifted a little.
          const left = feet - (base.feetX ?? base.width / 2) * scale;
          ctx.drawImage(pose.source, left, -base.height * scale, base.width * scale, base.height * scale);
        } else {
          // A twin that came back a different shape keeps its own proportions instead of being stretched.
          const twin = (base.height * scale) / pose.height;
          const left = feet - (pose.feetX ?? pose.width / 2) * twin;
          ctx.drawImage(pose.source, left, -pose.height * twin, pose.width * twin, pose.height * twin);
        }
      };
      const blend = hands.blend;
      if (blend >= 1 || hands.pose === hands.from) {
        paint(hands.pose, 1);
      } else {
        // Moving between poses: the body stays still while the arms fade from one pose to the other.
        if (blend < 0.5) {
          paint(hands.from, 1);
          paint(hands.pose, blend * 2);
        } else {
          paint(hands.pose, 1);
          paint(hands.from, (1 - blend) * 2);
        }
      }
    } else {
      ctx.scale(facing, 1); // keep the placeholder's letter readable
      drawPlaceholderCharacter(
        ctx,
        w,
        h,
        PLACEHOLDER_COLOURS[story.characters.indexOf(character) % PLACEHOLDER_COLOURS.length],
        (character.name.trim()[0] ?? "?").toLocaleUpperCase(),
        assets.headingFont,
      );
    }
    ctx.restore();
  });

  /* Flyers swoop across in front of everyone. */
  flyers.forEach((id, index) => {
    const character = story.characters.find((item) => item.id === id);
    if (!character) return;
    const standing = H * layout.heights[character.size] * storyScale;
    drawFlyer(ctx, assets.characters.get(id), standing, dims, moment.sceneLocal, index, calm, fires.length > 0, clock, arrive);
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  // Warm for happy scenes, cool for sad ones, blue at night, darker towards the edges.
  drawMoodLight(ctx, dims, setting, calm, clock);
  if (fires.length > 0) {
    // A flash of firelight as each fire catches, and big embers rushing past the camera.
    const flash = settled ? 0 : fireFlash(fires, moment.sceneLocal);
    if (flash > 0.005) {
      ctx.fillStyle = `rgba(255, 170, 90, ${flash.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawForegroundEmbers(ctx, dims, seedFrom(scene.id), clock);
  }
}

/**
 * A character flying along their path (see lib/flight.ts): the flying pose (or,
 * until it is drawn, the standing one), tilted with the swoop, with a motion
 * blur behind, speed streaks and, in a burning scene, a flame streaming from
 * behind them.
 */
function drawFlyer(
  ctx: CanvasRenderingContext2D,
  sprites: CharacterSprites | undefined,
  standingHeight: number,
  { width: W, height: H }: Dimensions,
  sceneLocal: number,
  flyer: number,
  calm: boolean,
  burning: boolean,
  clock: number,
  alpha: number,
) {
  const sprite = sprites?.flying ?? sprites?.idle;
  if (!sprite) return;
  // A flying pose lies level, so it is sized by its length.
  const length = standingHeight * (sprites?.flying ? 1.05 : 1);
  const scale = length / Math.max(sprite.width, sprite.height);
  const w = sprite.width * scale;
  const h = sprite.height * scale;
  // Two fading copies a moment behind make a motion blur (not in calm stories).
  const copies: Array<[behind: number, strength: number]> = calm ? [[0, 1]] : [[0.1, 0.12], [0.05, 0.25], [0, 1]];
  for (const [behind, strength] of copies) {
    const point = flightAt(Math.max(0, sceneLocal - behind), flyer, calm);
    if (!point.visible) continue;
    ctx.save();
    ctx.globalAlpha = alpha * strength;
    ctx.translate(W * point.x, H * point.y);
    ctx.scale(point.direction, 1); // pictures are drawn facing right
    ctx.rotate(point.tilt);
    if (strength === 1 && !calm) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = Math.max(2, W * 0.004);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const y = h * (-0.3 + 0.2 * k);
        ctx.moveTo(-w * 0.55, y);
        ctx.lineTo(-w * (0.85 + 0.12 * (k % 3)), y);
      }
      ctx.stroke();
    }
    if (strength === 1 && burning) {
      // The burning tail: a flame streaming out behind.
      ctx.save();
      ctx.translate(-w * 0.44, h * 0.05);
      ctx.rotate(-Math.PI / 2);
      const flame = w * (0.42 + 0.06 * Math.sin(clock * 11));
      drawFlame(ctx, 0, 0, flame * 0.5, flame, flame * 0.15 * Math.sin(clock * 7));
      ctx.restore();
    }
    ctx.drawImage(sprite.source, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/** Paints the story at `time` seconds onto the canvas context. */
export function drawStoryFrame(
  ctx: CanvasRenderingContext2D,
  story: Story,
  time: number,
  assets: StoryRenderAssets,
  options: FrameOptions = {},
) {
  const dims = dimensionsFor(story.aspectRatio);
  const { width: W, height: H } = dims;
  const layout = layoutFor(dims);
  const settled = options.settled ?? false;

  const timeLine = assets.timeLine ?? estimateLine;
  const moment = locateStory(story, time, timeLine);
  const scene = story.scenes[moment.sceneIndex];
  const line = moment.lineIndex >= 0 ? scene.lines[moment.lineIndex] : null;
  const timing = line ? timeLine(line) : null;

  /* The stage. At the start of a scene the last moment of the one before fades softly into it. */
  const fade = settled || moment.sceneIndex === 0 ? 1 : clamp01(moment.sceneLocal / CROSSFADE_SEC);
  const scratch = options.scratch;
  const scratchCtx = fade < 1 ? (scratch?.getContext("2d") ?? null) : null;
  if (fade < 1 && scratch && scratchCtx) {
    paintStage(ctx, story, Math.max(0, time - moment.sceneLocal - 0.001), assets, false, time);
    if (scratch.width !== W || scratch.height !== H) {
      scratch.width = W;
      scratch.height = H;
    }
    paintStage(scratchCtx, story, time, assets, false, time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = easeInOutCubic(fade);
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
  } else {
    paintStage(ctx, story, time, assets, settled, time);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  /* Film bars slide in for an action scene, and out again at its end. */
  if (story.calm !== true && sceneFlyers(scene).length > 0) {
    const length = sceneDuration(scene, timeLine);
    const show = settled
      ? 1
      : easeInOutCubic(clamp01(moment.sceneLocal / 0.6)) * easeInOutCubic(clamp01((length - moment.sceneLocal) / 0.6));
    const bar = H * 0.05 * show;
    if (bar > 0.5) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
  }

  /* Exercise card: the picture of the exercise, its name and how much. */
  if (scene.card) {
    const appear = settled ? 1 : easeOutCubic(clamp01(moment.sceneLocal / (SCENE_LEAD_SEC * 0.9)));
    ctx.save();
    ctx.globalAlpha = appear;
    drawExerciseCard(ctx, scene.card, assets.cards?.get(scene.id), dims, assets.headingFont);
    ctx.restore();
  }

  /* The story's name over the first seconds (not when an exercise card fills the top). */
  if (options.title !== false && !story.scenes[0].card) {
    drawOpeningTitle(ctx, story.title, dims, layout, assets.headingFont, time, settled);
  }

  /* Caption: the chunk being "said" right now. */
  if (line && timing) {
    const chunks = captionChunks(line.text);
    if (chunks.length > 0) {
      // Longer chunks take longer to say, so time is shared out by length.
      const weight = (chunk: { text: string }) => chunk.text.length + 2;
      const totalWeight = chunks.reduce((sum, chunk) => sum + weight(chunk), 0);
      const spoken = Math.max(0.2, timing.speechEnd - timing.speechStart);
      let start = timing.speechStart;
      let current = chunks[chunks.length - 1];
      for (const chunk of chunks) {
        const length = (weight(chunk) / totalWeight) * spoken;
        if (moment.lineLocal < start + length) {
          current = chunk;
          break;
        }
        start += length;
      }
      // Each group of words simply appears, without growing or popping.
      const kind: CaptionKind = line.speaker === NARRATOR ? "narrator" : line.thought ? "thought" : "speech";
      drawCaption(ctx, current.text, kind, dims, layout, assets.headingFont);
    }
  }

}

/** A text description of the moment, for screen readers. */
export function describeStoryMoment(
  story: Story,
  time: number,
  timeLine: TimeLine = estimateLine,
): { index: number; count: number; text: string } {
  const moment = locateStory(story, time, timeLine);
  const scene = story.scenes[moment.sceneIndex];
  const place = story.locations.find((location) => location.id === scene.locationId)?.name ?? "";
  const who = scene.onStage.map((id) => characterName(story, id)).join(", ");
  const dialogue = scene.lines
    .map((line) => `${characterName(story, line.speaker)}${line.thought ? " (thinking)" : ""}: ${line.text}`)
    .join(" ");
  return {
    index: moment.sceneIndex,
    count: story.scenes.length,
    text: `${place ? `${place}. ` : ""}${who ? `On screen: ${who}. ` : ""}${dialogue}`,
  };
}
