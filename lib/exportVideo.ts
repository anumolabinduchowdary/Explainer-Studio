import type { DrawFunction } from "@/components/Player";

/**
 * Builds the finished video one frame at a time.
 *
 * Earlier versions recorded the screen live, which meant a slow phone, a
 * dimmed screen or a switch to another app could leave the picture frozen
 * while the sound carried on. Here every frame is drawn and encoded at its
 * exact time, however long that takes, so the picture and sound cannot drift
 * and no frame is ever skipped. The result is a standard MP4 (H.264 + AAC)
 * with a steady frame rate, which phones and social apps play reliably.
 */

/**
 * 25 frames a second: the standard in India (PAL), smooth for cartoons, and a
 * sixth fewer frames than 30, so videos are built about 17% faster (the
 * graphics chip's encoder sets the pace, at about 5 ms a frame).
 */
export const EXPORT_FPS = 25;

export type ExportJob = {
  width: number;
  height: number;
  /** Length in seconds. */
  duration: number;
  draw: DrawFunction;
  /**
   * The sound for the whole video, or null for a silent video. It may still be
   * mixing: the frames are built meanwhile and the sound joins when it is ready.
   */
  sound: AudioBuffer | Promise<AudioBuffer> | null;
};

type ExportOptions = {
  /** Called with the number of seconds built so far. */
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
};

/** The library that writes the MP4 is only downloaded when a video is made. */
const loadEncoder = () => import("mediabunny");

function videoBitrate(width: number, height: number): number {
  // Flat cartoon pictures compress well; this keeps a one-minute video around 20 MB.
  return Math.round(width * height * 1.6);
}

const support = new Map<string, Promise<boolean>>();

/**
 * Whether this browser can build videos this way. If not, the app falls back
 * to live recording. The answer is remembered, so asking again costs nothing.
 */
export function canBuildVideo(width: number, height: number, withSound: boolean): Promise<boolean> {
  const key = `${width}x${height}:${withSound}`;
  let answer = support.get(key);
  if (!answer) {
    answer = checkSupport(width, height, withSound);
    support.set(key, answer);
  }
  return answer;
}

async function checkSupport(width: number, height: number, withSound: boolean): Promise<boolean> {
  try {
    if (typeof VideoEncoder === "undefined") return false;
    if (withSound && typeof AudioEncoder === "undefined") return false;
    const { canEncodeVideo, canEncodeAudio } = await loadEncoder();
    const picture = await canEncodeVideo("avc", {
      width,
      height,
      bitrate: videoBitrate(width, height),
      frameRate: EXPORT_FPS,
    });
    if (!picture) return false;
    return !withSound || (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }));
  } catch {
    return false;
  }
}

/** Lets the page repaint (progress bar, Cancel button) between batches of frames. */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

function cancelled(): DOMException {
  return new DOMException("The video was cancelled.", "AbortError");
}

/** Draws and encodes every frame of the video and returns the finished MP4. */
export async function buildVideo(job: ExportJob, options: ExportOptions = {}): Promise<Blob> {
  const { width, height, duration, draw, sound } = job;
  const { onProgress, signal } = options;
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource } = await loadEncoder();

  // A canvas of its own, so the on-screen preview is left alone.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare a drawing surface.");
  const scratch = document.createElement("canvas");

  const target = new BufferTarget();
  const output = new Output({
    // "in-memory" writes an ordinary MP4 with its index at the front, the most widely supported kind.
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const picture = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: videoBitrate(width, height),
    // A full picture every two seconds keeps seeking and trimming in other apps quick.
    keyFrameInterval: 2,
  });
  output.addVideoTrack(picture, { frameRate: EXPORT_FPS });
  const voices = sound ? new AudioBufferSource({ codec: "aac", bitrate: 128_000 }) : null;
  if (voices) output.addAudioTrack(voices);

  try {
    await output.start();
    // Sound goes in alongside the picture (as soon as it has been mixed); the library keeps the two interleaved.
    const soundAdded =
      voices && sound
        ? Promise.resolve(sound)
            .then((buffer) => voices.add(buffer))
            .then(() => voices.close())
        : Promise.resolve();
    // If mixing fails, the error is reported when the video is finished, not as an unhandled rejection.
    soundAdded.catch(() => undefined);

    const frames = Math.max(1, Math.round(duration * EXPORT_FPS));
    for (let frame = 0; frame < frames; frame++) {
      if (signal?.aborted) throw cancelled();
      const time = frame / EXPORT_FPS;
      draw(ctx, Math.min(time, duration), { settled: false, scratch });
      await picture.add(time, 1 / EXPORT_FPS);
      if (frame % 6 === 0) {
        onProgress?.(time);
        await breathe();
      }
    }
    picture.close();
    await soundAdded;
    if (signal?.aborted) throw cancelled();
    await output.finalize();
  } catch (err) {
    if (output.state !== "finalized" && output.state !== "canceled") {
      await output.cancel().catch(() => undefined);
    }
    throw err;
  }

  if (!target.buffer) throw new Error("The video file came out empty.");
  onProgress?.(duration);
  return new Blob([target.buffer], { type: "video/mp4" });
}
