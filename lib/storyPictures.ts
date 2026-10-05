import { ApiError, postJson, toErrorInfo } from "./api";
import type { ErrorInfo } from "./errors";
import {
  ImageResponseSchema,
  MAX_REFERENCE_CHARS,
  SpeechResponseSchema,
  type ImageRequest,
  type SpeechRequest,
} from "./story";
import type { Sprite } from "./storyRenderer";

/** One AI-drawn picture, as the app keeps it (in memory only). */
export type Picture = {
  dataUrl: string;
  sprite: Sprite;
  /** The description it was drawn from, so we can tell when it is out of date. */
  source: string;
};

export type PictureState =
  | { status: "drawing"; note?: string }
  | { status: "ready"; picture: Picture }
  | { status: "failed"; error: ErrorInfo };

export type PictureMap = Record<string, PictureState>;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The picture could not be read."));
    image.src = dataUrl;
  });
}

/**
 * Prepares a picture for drawing. Characters are cropped to their visible
 * pixels so that sizes and feet line up, whatever margin the model left.
 */
export async function loadSprite(dataUrl: string, trimTransparent: boolean): Promise<Sprite> {
  const image = await loadImage(dataUrl);
  const full: Sprite = { source: image, width: image.naturalWidth, height: image.naturalHeight };
  if (!trimTransparent) return full;

  const canvas = document.createElement("canvas");
  canvas.width = full.width;
  canvas.height = full.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return full;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, full.width, full.height);

  let left = full.width;
  let right = -1;
  let top = full.height;
  let bottom = -1;
  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      if (data[(y * full.width + x) * 4 + 3] > 24) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  // Nothing visible, or nothing to trim: use the picture as it is.
  if (right < left || bottom < top) return full;
  const width = right - left + 1;
  const height = bottom - top + 1;
  // Where the feet are: the middle of whatever is drawn in the lowest strip.
  let feetSum = 0;
  let feetCount = 0;
  for (let y = Math.max(top, bottom - Math.ceil(height * 0.06)); y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * full.width + x) * 4 + 3] > 24) {
        feetSum += x - left;
        feetCount++;
      }
    }
  }
  const feetX = feetCount > 0 ? feetSum / feetCount : width / 2;

  const cropped = document.createElement("canvas");
  cropped.width = width;
  cropped.height = height;
  cropped.getContext("2d")?.drawImage(canvas, left, top, width, height, 0, 0, width, height);
  return {
    source: cropped,
    width,
    height,
    feetX,
    previewUrl: cropped.toDataURL("image/webp", 0.85),
  };
}

/** Re-encodes a picture as a PNG data URL small enough to send as a reference. */
export async function referencePng(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  for (const scale of [1, 0.75, 0.5]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_REFERENCE_CHARS) return png;
  }
  throw new ApiError("invalid_input", "That picture is too large to use as a reference.");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RequestOptions = {
  apiKey?: string;
  /** Called while waiting out a rate limit, so the UI can say so. */
  onWaiting?: (seconds: number) => void;
  /** Lets the caller stop a queued retry (for example when leaving the page). */
  shouldStop?: () => boolean;
};

/**
 * Runs a request, waiting out "too many requests" answers and trying again.
 * Image and speech models have low per-minute limits on new accounts.
 */
async function retryWhenBusy<T>(run: () => Promise<T>, options: RequestOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const info = toErrorInfo(err);
      const busy = info.code === "rate_limited" || info.code === "upstream_busy";
      if (!busy || attempt >= 3 || options.shouldStop?.()) throw err;
      const wait = Math.min(65, Math.max(5, info.retryAfterSec ?? 20));
      options.onWaiting?.(wait);
      await sleep(wait * 1000);
      if (options.shouldStop?.()) throw err;
    }
  }
}

/** Asks the server to draw one picture; resolves to an image data URL. */
export function requestPicture(request: ImageRequest, options: RequestOptions = {}): Promise<string> {
  return retryWhenBusy(async () => {
    const { image } = await postJson("/api/image", request, ImageResponseSchema, {
      apiKey: options.apiKey,
      timeoutMs: 125_000,
    });
    return image;
  }, options);
}

/** Asks the server to speak one line; resolves to an MP3 data URL. */
export function requestSpeech(request: SpeechRequest, options: RequestOptions = {}): Promise<string> {
  return retryWhenBusy(async () => {
    const { audio } = await postJson("/api/speech", request, SpeechResponseSchema, {
      apiKey: options.apiKey,
      timeoutMs: 65_000,
    });
    return audio;
  }, options);
}
