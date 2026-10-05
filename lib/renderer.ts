import type { AspectRatio, Scene, Storyboard } from "./schemas";
import type { VisualId } from "./visuals";

/**
 * Draws the video. One function, drawFrame(), paints any moment of a
 * storyboard onto a canvas. The on-screen player and the exported recording
 * both use it, so what you preview is exactly what you download.
 */

export type Dimensions = { width: number; height: number };

export function dimensionsFor(aspectRatio: AspectRatio): Dimensions {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default:
      return { width: 1080, height: 1920 };
  }
}

export function totalDuration(storyboard: Storyboard): number {
  return storyboard.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
}

export function sceneStart(storyboard: Storyboard, index: number): number {
  let start = 0;
  for (let i = 0; i < index && i < storyboard.scenes.length; i++) {
    start += storyboard.scenes[i].durationSec;
  }
  return start;
}

/** Which scene is showing at time t, and how far into it we are. */
export function locate(storyboard: Storyboard, time: number): { index: number; local: number } {
  const { scenes } = storyboard;
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const duration = scenes[i].durationSec;
    if (time < start + duration || i === scenes.length - 1) {
      return { index: i, local: Math.min(Math.max(time - start, 0), duration) };
    }
    start += duration;
  }
  return { index: 0, local: 0 };
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type RenderAssets = {
  images: ReadonlyMap<VisualId, CanvasImageSource>;
  /** CSS font-family lists for headings and body text. */
  headingFont: string;
  bodyFont: string;
  /** Bumped when fonts finish loading so cached text layouts are rebuilt. */
  version: number;
};

export type FrameOptions = {
  /** Offscreen canvas used to blend scene transitions. */
  scratch?: HTMLCanvasElement | null;
  /** When true, entrance animations are skipped and scenes are shown fully arrived (used while paused). */
  settled?: boolean;
};

/* ------------------------------------------------------------------ */
/* Look and feel                                                       */
/* ------------------------------------------------------------------ */

type Palette = { top: string; bottom: string; glow: string; accent: string; ink: string };

// Soft, warm backgrounds with dark text: every pair is well above 7:1 contrast.
const PALETTES: Palette[] = [
  { top: "#FFF7ED", bottom: "#FFE4C7", glow: "#FDBA74", accent: "#C2410C", ink: "#431407" },
  { top: "#F0FDFA", bottom: "#CCFBF1", glow: "#5EEAD4", accent: "#0F766E", ink: "#042F2E" },
  { top: "#F0F9FF", bottom: "#D6EEFF", glow: "#7DD3FC", accent: "#0369A1", ink: "#0C2D48" },
  { top: "#F5F3FF", bottom: "#E4DCFF", glow: "#C4B5FD", accent: "#6D28D9", ink: "#2E1065" },
  { top: "#FFFBEB", bottom: "#FEEFB3", glow: "#FCD34D", accent: "#B45309", ink: "#451A03" },
  { top: "#FFF1F2", bottom: "#FFD9DF", glow: "#FDA4AF", accent: "#BE123C", ink: "#4C0519" },
];

export const TRANSITION_SEC = 0.7;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const progress = (time: number, start: number, length: number) => clamp01((time - start) / length);

/* ------------------------------------------------------------------ */
/* Text layout                                                         */
/* ------------------------------------------------------------------ */

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    // A single word wider than the line: break it by character.
    let chunk = "";
    for (const char of Array.from(word)) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

type TextBlock = { lines: string[]; font: string; size: number; lineHeight: number; top: number };

type SceneLayout = {
  align: "center" | "left";
  textX: number;
  textWidth: number;
  icon: { cx: number; cy: number; size: number };
  rule: { y: number; width: number; height: number };
  heading: TextBlock | null;
  body: TextBlock | null;
  bullets: { items: TextBlock[]; markerRadius: number; indent: number; blockX: number } | null;
};

const layoutCache = new WeakMap<Scene, { key: string; layout: SceneLayout }>();

function layoutScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  dims: Dimensions,
  assets: RenderAssets,
): SceneLayout {
  const key = `${dims.width}x${dims.height}:${assets.version}`;
  const cached = layoutCache.get(scene);
  if (cached?.key === key) return cached.layout;

  const { width: W, height: H } = dims;
  const landscape = W > H;
  const square = W === H;

  // Base sizes for each shape; `scale` shrinks them until the text fits.
  const unit = landscape ? H : W;
  const base = landscape
    ? { heading: 0.076, body: 0.044, bullet: 0.04 }
    : square
      ? { heading: 0.066, body: 0.04, bullet: 0.037 }
      : { heading: 0.08, body: 0.047, bullet: 0.043 };

  const pad = landscape ? W * 0.06 : W * 0.085;
  const top = H * (landscape ? 0.1 : 0.07);
  const bottom = H * (landscape ? 0.13 : 0.09);
  const available = H - top - bottom;

  let iconSize = landscape ? H * 0.5 : square ? W * 0.3 : W * 0.5;
  const iconGap = landscape ? W * 0.05 : H * (square ? 0.035 : 0.04);
  const textX = landscape ? pad + iconSize + iconGap : pad;
  const textWidth = W - pad - textX;
  const ruleHeight = Math.max(8, unit * 0.009);
  const ruleGap = unit * 0.028;

  const measure = (scale: number) => {
    const blocks: { heading: TextBlock | null; body: TextBlock | null; bullets: TextBlock[] } = {
      heading: null,
      body: null,
      bullets: [],
    };
    let y = ruleHeight + ruleGap;

    if (scene.heading) {
      const size = unit * base.heading * scale;
      const font = `700 ${size}px ${assets.headingFont}`;
      ctx.font = font;
      const lines = wrapText(ctx, scene.heading, textWidth);
      blocks.heading = { lines, font, size, lineHeight: size * 1.18, top: y };
      y += lines.length * size * 1.18 + size * 0.42;
    }
    if (scene.body) {
      const size = unit * base.body * scale;
      const font = `500 ${size}px ${assets.bodyFont}`;
      ctx.font = font;
      const lines = wrapText(ctx, scene.body, textWidth);
      blocks.body = { lines, font, size, lineHeight: size * 1.4, top: y };
      y += lines.length * size * 1.4 + size * 0.7;
    }
    const size = unit * base.bullet * scale;
    const indent = size * 1.15;
    const font = `600 ${size}px ${assets.bodyFont}`;
    ctx.font = font;
    let widest = 0;
    for (const bullet of scene.bullets) {
      const lines = wrapText(ctx, bullet, textWidth - indent);
      for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
      blocks.bullets.push({ lines, font, size, lineHeight: size * 1.32, top: y });
      y += lines.length * size * 1.32 + size * 0.45;
    }
    return { ...blocks, height: y, indent, markerRadius: size * 0.17, widest };
  };

  // Shrink the text (and, for stacked layouts, the picture) until everything fits.
  let scale = 1;
  let measured = measure(scale);
  const textRoom = () => (landscape ? available : available - iconSize - iconGap);
  while (measured.height > textRoom() && scale > 0.5) {
    scale -= 0.06;
    measured = measure(scale);
  }
  if (!landscape) {
    while (measured.height > textRoom() && iconSize > W * 0.2) iconSize -= W * 0.03;
  }

  let icon: SceneLayout["icon"];
  let textTop: number;
  if (landscape) {
    icon = { cx: pad + iconSize / 2, cy: top + available / 2, size: iconSize };
    textTop = top + Math.max(0, (available - measured.height) / 2);
  } else {
    const total = iconSize + iconGap + measured.height;
    const start = top + Math.max(0, (available - total) / 2);
    icon = { cx: W / 2, cy: start + iconSize / 2, size: iconSize };
    textTop = start + iconSize + iconGap;
  }

  const place = (block: TextBlock | null) => (block ? { ...block, top: block.top + textTop } : null);
  const bulletBlockWidth = measured.widest + measured.indent;

  const layout: SceneLayout = {
    align: landscape ? "left" : "center",
    textX,
    textWidth,
    icon,
    rule: { y: textTop, width: unit * 0.11, height: ruleHeight },
    heading: place(measured.heading),
    body: place(measured.body),
    bullets:
      measured.bullets.length > 0
        ? {
            items: measured.bullets.map((b) => ({ ...b, top: b.top + textTop })),
            markerRadius: measured.markerRadius,
            indent: measured.indent,
            // Bullets stay left-aligned; in centred layouts the whole list is centred.
            blockX: landscape ? textX : textX + Math.max(0, (textWidth - bulletBlockWidth) / 2),
          }
        : null,
  };
  layoutCache.set(scene, { key, layout });
  return layout;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function drawBackground(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  dims: Dimensions,
  time: number,
  seed: number,
) {
  const { width: W, height: H } = dims;
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(1, palette.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Two soft glows that drift slowly so the picture never feels frozen.
  const radius = Math.max(W, H) * 0.42;
  const glows = [
    {
      x: W * (0.12 + 0.07 * Math.sin(time * 0.23 + seed)),
      y: H * (0.1 + 0.05 * Math.cos(time * 0.19 + seed)),
      alpha: 0.5,
    },
    {
      x: W * (0.9 + 0.06 * Math.cos(time * 0.21 + seed * 2)),
      y: H * (0.88 + 0.05 * Math.sin(time * 0.17 + seed)),
      alpha: 0.38,
    },
  ];
  for (const glow of glows) {
    const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, radius);
    g.addColorStop(0, palette.glow);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = glow.alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = 1;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  x: number,
  align: CanvasTextAlign,
  offsetY: number,
) {
  ctx.font = block.font;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  block.lines.forEach((line, i) => {
    ctx.fillText(line, x, block.top + offsetY + block.size * 0.86 + i * block.lineHeight);
  });
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  storyboard: Storyboard,
  index: number,
  local: number,
  time: number,
  assets: RenderAssets,
  dims: Dimensions,
  settled: boolean,
) {
  const scene = storyboard.scenes[index];
  const palette = PALETTES[index % PALETTES.length];
  drawBackground(ctx, palette, dims, time, index);

  const layout = layoutScene(ctx, scene, dims, assets);
  // Entrances are compressed for very short scenes so everything still arrives.
  const pace = Math.min(1, scene.durationSec / 5);
  const t0 = (index > 0 ? 0.3 : 0.1) * pace;
  const enter = (start: number, length: number) =>
    settled ? 1 : progress(local, t0 + start * pace, length * pace);

  /* Illustration: pops in, then bobs gently. */
  const { icon } = layout;
  const pIcon = enter(0, 0.6);
  if (pIcon > 0) {
    const scale = 0.6 + 0.4 * easeOutBack(pIcon);
    const bob = settled ? 0 : Math.sin(time * 1.4 + index) * icon.size * 0.012;
    const tilt = settled ? 0 : Math.sin(time * 0.9 + index) * 0.022;
    ctx.save();
    ctx.globalAlpha = clamp01(pIcon * 1.8);
    ctx.translate(icon.cx, icon.cy + bob);
    ctx.scale(scale, scale);

    ctx.shadowColor = "rgba(43, 33, 24, 0.16)";
    ctx.shadowBlur = icon.size * 0.08;
    ctx.shadowOffsetY = icon.size * 0.03;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(0, 0, icon.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.globalAlpha *= 0.28;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(3, icon.size * 0.012);
    ctx.beginPath();
    ctx.arc(0, 0, icon.size / 2 - ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = clamp01(pIcon * 1.8);

    const image = assets.images.get(scene.visual);
    if (image) {
      const size = icon.size * 0.74;
      ctx.rotate(tilt);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
    }
    ctx.restore();
  }

  const centred = layout.align === "center";
  const anchorX = centred ? layout.textX + layout.textWidth / 2 : layout.textX;
  const textAlign: CanvasTextAlign = centred ? "center" : "left";

  /* Accent rule and heading slide up together. */
  const pHeading = enter(0.25, 0.6);
  if (pHeading > 0) {
    const eased = easeOutCubic(pHeading);
    const ruleWidth = layout.rule.width * eased;
    ctx.globalAlpha = eased;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.roundRect(
      centred ? anchorX - ruleWidth / 2 : anchorX,
      layout.rule.y,
      ruleWidth,
      layout.rule.height,
      layout.rule.height / 2,
    );
    ctx.fill();
    if (layout.heading) {
      ctx.fillStyle = palette.ink;
      drawLines(ctx, layout.heading, anchorX, textAlign, (1 - eased) * layout.heading.size * 0.6);
    }
  }

  const pBody = enter(0.6, 0.6);
  if (layout.body && pBody > 0) {
    const eased = easeOutCubic(pBody);
    ctx.globalAlpha = eased * 0.9;
    ctx.fillStyle = palette.ink;
    drawLines(ctx, layout.body, anchorX, textAlign, (1 - eased) * layout.body.size * 0.6);
  }

  /* Bullets arrive one after another. */
  if (layout.bullets) {
    const { items, markerRadius, indent, blockX } = layout.bullets;
    items.forEach((item, i) => {
      const p = enter(1.0 + i * 0.4, 0.5);
      if (p <= 0) return;
      const eased = easeOutCubic(p);
      const slide = (1 - eased) * item.size * 0.8;
      ctx.globalAlpha = eased;
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(blockX + markerRadius + slide, item.top + item.size * 0.56, markerRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.ink;
      ctx.globalAlpha = eased * 0.95;
      drawLines(ctx, item, blockX + indent + slide, "left", 0);
    });
  }
  ctx.globalAlpha = 1;
}

function drawProgress(ctx: CanvasRenderingContext2D, dims: Dimensions, fraction: number) {
  const { width: W, height: H } = dims;
  const pad = W > H ? W * 0.06 : W * 0.085;
  const height = Math.max(8, Math.min(W, H) * 0.008);
  const y = H - H * (W > H ? 0.07 : 0.045);
  const width = W - pad * 2;
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = "#2B2118";
  ctx.beginPath();
  ctx.roundRect(pad, y, width, height, height / 2);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.roundRect(pad, y, Math.max(height, width * clamp01(fraction)), height, height / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Paints the storyboard at `time` seconds onto the canvas context. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  storyboard: Storyboard,
  time: number,
  assets: RenderAssets,
  options: FrameOptions = {},
) {
  const dims = dimensionsFor(storyboard.aspectRatio);
  const { width: W, height: H } = dims;
  const settled = options.settled ?? false;
  const total = totalDuration(storyboard);
  const { index, local } = locate(storyboard, time);
  const scene = storyboard.scenes[index];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  const mix = index > 0 && !settled ? clamp01(local / TRANSITION_SEC) : 1;
  if (mix >= 1) {
    drawScene(ctx, storyboard, index, local, time, assets, dims, settled);
  } else {
    const eased = easeInOutCubic(mix);
    const previous = storyboard.scenes[index - 1];
    const drawPrevious = () =>
      drawScene(ctx, storyboard, index - 1, previous.durationSec, time, assets, dims, false);
    const drawCurrent = (target: CanvasRenderingContext2D) =>
      drawScene(target, storyboard, index, local, time, assets, dims, false);

    const scratch = options.scratch;
    const scratchCtx = scratch?.getContext("2d") ?? null;
    const slide = scene.transition === "slide-left" || scene.transition === "slide-up";

    if (slide || !scratch || !scratchCtx) {
      // Slides: the old scene moves out as the new one moves in.
      const dx = scene.transition === "slide-left" ? W : 0;
      const dy = scene.transition === "slide-up" ? H : 0;
      if (dx === 0 && dy === 0) {
        // No scratch canvas available for a blend: fall back to a clean cut.
        drawCurrent(ctx);
      } else {
        ctx.save();
        ctx.translate(-eased * dx, -eased * dy);
        drawPrevious();
        ctx.restore();
        ctx.save();
        ctx.translate((1 - eased) * dx, (1 - eased) * dy);
        drawCurrent(ctx);
        ctx.restore();
      }
    } else {
      // Fade and zoom: paint the new scene offscreen, then blend it over the old one.
      if (scratch.width !== W || scratch.height !== H) {
        scratch.width = W;
        scratch.height = H;
      }
      drawPrevious();
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
      scratchCtx.globalAlpha = 1;
      drawCurrent(scratchCtx);
      ctx.save();
      ctx.globalAlpha = eased;
      if (scene.transition === "zoom") {
        const zoom = 1.12 - 0.12 * eased;
        ctx.translate(W / 2, H / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-W / 2, -H / 2);
      }
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }
  }

  drawProgress(ctx, dims, total > 0 ? time / total : 0);
}
