"use client";

import { useEffect, useState } from "react";
import type { DrawFunction, MomentInfo } from "@/components/Player";
import type { Dimensions } from "./renderer";

/**
 * The closing card shown at the end of every video: the Special Parenting
 * Instagram QR code. To change it, replace public/end-card.webp (any image
 * works) and update the description below.
 */
export const END_CARD = {
  src: "/end-card.webp",
  /** How long the card stays on screen: long enough to point a phone at it. */
  seconds: 4,
  description: "Closing card: scan the QR code to follow @specialparenting on Instagram.",
} as const;

const FADE_SEC = 0.5;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

let imagePromise: Promise<HTMLImageElement | null> | null = null;

function loadEndCard(): Promise<HTMLImageElement | null> {
  imagePromise ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // Without the picture the videos simply end as before.
    image.onerror = () => resolve(null);
    image.src = END_CARD.src;
  });
  return imagePromise;
}

/** The closing card's picture, or null until it has loaded (or if it is missing). */
export function useEndCardImage(): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let active = true;
    void loadEndCard().then((loaded) => {
      if (active) setImage(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return image;
}

/** Paints the closing card. `local` is seconds since the card began. */
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  { width: W, height: H }: Dimensions,
  local: number,
  image: HTMLImageElement,
  settled: boolean,
) {
  const arrive = settled ? 1 : easeOutCubic(clamp01(local / FADE_SEC));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Fades in over the last frame of the video.
  ctx.globalAlpha = arrive;
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, "#F3F7FF");
  background.addColorStop(1, "#DCE8FF");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  // As large as fits comfortably, so the code is easy to scan from another phone.
  const aspect = image.naturalWidth / image.naturalHeight;
  let height = Math.min(H * 0.8, (W * 0.8) / aspect);
  let width = height * aspect;
  const scale = 0.94 + 0.06 * arrive;
  width *= scale;
  height *= scale;
  const x = (W - width) / 2;
  const y = (H - height) / 2;
  const radius = width * 0.05;

  ctx.shadowColor = "rgba(30, 58, 138, 0.25)";
  ctx.shadowBlur = width * 0.06;
  ctx.shadowOffsetY = width * 0.02;
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

/**
 * Extends a video with the closing card. Returns the pieces the player
 * needs: a longer duration and wrapped draw and describe functions. With no
 * picture (or the card switched off) everything is returned unchanged.
 */
export function withEndCard(
  video: {
    dims: Dimensions;
    duration: number;
    draw: DrawFunction | null;
    describe: (time: number) => MomentInfo;
  },
  image: HTMLImageElement | null,
): { duration: number; draw: DrawFunction | null; describe: (time: number) => MomentInfo } {
  const { dims, duration, draw, describe } = video;
  if (!image || !draw) return { duration, draw, describe };

  return {
    duration: duration + END_CARD.seconds,
    draw: (ctx, time, options) => {
      const settled = options.settled ?? false;
      const sinceCard = time - duration;
      // The video's own last frame stays underneath while the card fades in.
      const covered = sinceCard >= 0 && (settled || sinceCard >= FADE_SEC);
      if (!covered) draw(ctx, Math.min(time, duration), options);
      if (sinceCard >= 0) drawEndCard(ctx, dims, sinceCard, image, settled);
    },
    describe: (time) => {
      const moment = describe(Math.min(time, duration));
      return time >= duration ? { ...moment, text: END_CARD.description } : moment;
    },
  };
}
