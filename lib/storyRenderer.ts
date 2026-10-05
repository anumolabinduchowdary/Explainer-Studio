import { dimensionsFor, type Dimensions, type FrameOptions } from "./renderer";
import {
  NARRATOR,
  SCENE_LEAD_SEC,
  captionChunks,
  characterName,
  estimateLine,
  locateStory,
  type Story,
  type StoryCharacter,
  type StoryLine,
  type TimeLine,
} from "./story";

/**
 * Draws a cartoon story: a background, up to three characters standing in
 * it, and word-by-word captions. The speaker bounces and (when a talking
 * pose has been drawn) opens and closes their mouth.
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
};

export type CharacterSprites = { idle: Sprite; talk?: Sprite };

export type StoryRenderAssets = {
  characters: ReadonlyMap<string, CharacterSprites>;
  places: ReadonlyMap<string, Sprite>;
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
};

function layoutFor({ width: W, height: H }: Dimensions): Layout {
  if (W > H) {
    return {
      floor: 0.9,
      heights: { large: 0.62, medium: 0.52, small: 0.41 },
      captionY: 0.82,
      captionSize: H * 0.085,
    };
  }
  if (W === H) {
    return {
      floor: 0.88,
      heights: { large: 0.56, medium: 0.47, small: 0.37 },
      captionY: 0.79,
      captionSize: W * 0.072,
    };
  }
  // Tall videos keep the bottom clear, where phone apps put their own buttons and titles.
  return {
    floor: 0.84,
    heights: { large: 0.5, medium: 0.42, small: 0.33 },
    captionY: 0.735,
    captionSize: W * 0.092,
  };
}

const SLOTS: Record<number, number[]> = { 1: [0.5], 2: [0.29, 0.71], 3: [0.2, 0.5, 0.8] };
const SLOT_WIDTH: Record<number, number> = { 1: 0.8, 2: 0.46, 3: 0.32 };

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

const PLACEHOLDER_COLOURS = ["#F9A8D4", "#93C5FD", "#FCD34D", "#86EFAC"];

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

function drawSpeechMarks(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  for (const [colour, width] of [
    ["#2B2118", size * 0.34],
    ["#FFD43B", size * 0.2],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (const angle of [-0.15, -0.75, -1.35]) {
      const a = direction > 0 ? angle : Math.PI - angle;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.5, Math.sin(a) * size * 0.5);
      ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Captions                                                            */
/* ------------------------------------------------------------------ */

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  narrator: boolean,
  dims: Dimensions,
  layout: Layout,
  headingFont: string,
  pop: number,
) {
  const { width: W, height: H } = dims;
  const label = text.toLocaleUpperCase();
  let size = layout.captionSize;
  ctx.font = `700 ${size}px ${headingFont}`;
  const widest = W * 0.86;
  const measured = ctx.measureText(label).width;
  if (measured > widest) {
    size *= widest / measured;
    ctx.font = `700 ${size}px ${headingFont}`;
  }

  ctx.save();
  ctx.translate(W / 2, H * layout.captionY);
  ctx.scale(pop, pop);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // A dark outline keeps the words readable over any background.
  ctx.strokeStyle = "#1F1410";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(label, 0, size * 0.05);
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = narrator ? "#FFE8A3" : "#FFFFFF";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

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
  const speakerId = line && line.speaker !== NARRATOR ? line.speaker : null;
  const speaking =
    timing !== null &&
    !settled &&
    moment.lineLocal >= timing.speechStart &&
    moment.lineLocal < timing.speechEnd;
  // Follow the real voice when there is one; otherwise flap at a talking rhythm.
  const heard = line && speaking ? (assets.mouthOpen?.(line, moment.lineLocal) ?? null) : null;
  const mouthOpen = speaking && (heard ?? Math.sin(moment.lineLocal * Math.PI * 2 * 3.4) > -0.15);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  // A slow push-in keeps a still background from feeling frozen.
  const zoom = settled ? 1.05 : 1.03 + 0.012 * Math.min(moment.sceneLocal, 6);
  drawBackdrop(ctx, assets.places.get(scene.locationId), dims, layout.floor, zoom);

  /* Characters, back to front is simply left to right here. */
  const cast = scene.onStage
    .map((id) => story.characters.find((character) => character.id === id))
    .filter((character): character is StoryCharacter => Boolean(character))
    .slice(0, 3);
  const slots = SLOTS[cast.length] ?? [];
  const maxWidth = W * (SLOT_WIDTH[cast.length] ?? 0.8);
  const arrive = settled ? 1 : easeOutCubic(clamp01(moment.sceneLocal / (SCENE_LEAD_SEC * 0.9)));

  cast.forEach((character, i) => {
    const sprites = assets.characters.get(character.id);
    const isSpeaker = character.id === speakerId;
    const aspect = sprites ? sprites.idle.width / sprites.idle.height : 0.42;

    let h = H * layout.heights[character.size];
    let w = h * aspect;
    if (w > maxWidth) {
      h *= maxWidth / w;
      w = maxWidth;
    }

    const x = W * slots[i];
    const facing = slots[i] > 0.5 ? -1 : 1; // pictures are drawn facing right
    const bounce = isSpeaker && speaking ? -Math.abs(Math.sin(moment.lineLocal * Math.PI * 2.4)) * h * 0.018 : 0;
    const breathe = settled ? 1 : 1 + 0.006 * Math.sin(time * 1.7 + i * 1.3);
    const y = H * layout.floor + bounce + (1 - arrive) * h * 0.08;

    ctx.save();
    ctx.globalAlpha = arrive;

    ctx.fillStyle = "rgba(31, 20, 16, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x, H * layout.floor, w * 0.36, Math.max(6, h * 0.022), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, y);
    ctx.scale(facing, breathe);
    if (sprites) {
      // Both poses are drawn into the same box, which lines them up even if the
      // talking pose came back slightly shifted or resized.
      const pose = isSpeaker && mouthOpen && sprites.talk ? sprites.talk : sprites.idle;
      ctx.drawImage(pose.source, -w / 2, -h, w, h);
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

    if (isSpeaker && speaking && Math.sin(moment.lineLocal * Math.PI * 2 * 1.7) > -0.3) {
      drawSpeechMarks(ctx, x + facing * w * 0.3, y - h * 0.94, h * 0.07, facing);
    }
  });

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
      let sinceStart = moment.lineLocal;
      for (const chunk of chunks) {
        const length = (weight(chunk) / totalWeight) * spoken;
        if (moment.lineLocal < start + length) {
          current = chunk;
          sinceStart = moment.lineLocal - start;
          break;
        }
        start += length;
      }
      const pop = settled ? 1 : 0.86 + 0.14 * easeOutCubic(clamp01(sinceStart / 0.09));
      drawCaption(ctx, current.text, line.speaker === NARRATOR, dims, layout, assets.headingFont, pop);
    }
  }

  /* A quick soft flash marks each change of scene. */
  if (!settled && moment.sceneIndex > 0 && moment.sceneLocal < 0.22) {
    ctx.globalAlpha = 0.85 * (1 - moment.sceneLocal / 0.22);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
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
  const dialogue = scene.lines.map((line) => `${characterName(story, line.speaker)}: ${line.text}`).join(" ");
  return {
    index: moment.sceneIndex,
    count: story.scenes.length,
    text: `${place ? `${place}. ` : ""}${who ? `On screen: ${who}. ` : ""}${dialogue}`,
  };
}
