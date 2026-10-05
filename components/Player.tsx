"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { formatTime, type FrameOptions } from "@/lib/renderer";
import { IconButton, PauseIcon, PlayIcon, RestartIcon } from "./ui";

export type PlayerHandle = {
  getCanvas: () => HTMLCanvasElement | null;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  seekToScene: (index: number) => void;
};

/** Paints one moment of a video onto the canvas. */
export type DrawFunction = (
  ctx: CanvasRenderingContext2D,
  time: number,
  options: FrameOptions,
) => void;

export type MomentInfo = { index: number; count: number; text: string };

/**
 * Sound that plays along with the picture. While it is running, its clock
 * drives the picture, which keeps the two exactly in step.
 */
export type Transport = {
  start: (time: number) => void;
  stop: () => void;
  /** Position in seconds by the sound's clock, or null when it is not running. */
  now: () => number | null;
};

type Props = {
  width: number;
  height: number;
  /** Length of the video in seconds. */
  duration: number;
  /**
   * Null until fonts and pictures are ready. Pass a new function whenever the
   * picture would change (an edit, a new image): that is what triggers a repaint.
   */
  draw: DrawFunction | null;
  /** Which scene is showing at a time, described in words for screen readers. */
  describe: (time: number) => MomentInfo;
  /** When scene `index` starts, in seconds. */
  sceneStart: (index: number) => number;
  /** Sound to play with the picture (cartoon voices). Omit for a silent video. */
  transport?: Transport;
  ref?: Ref<PlayerHandle>;
  /** True while exporting: controls are disabled and playback is always fully animated. */
  locked?: boolean;
  onEnded?: () => void;
  onSceneChange?: (index: number) => void;
  onProgress?: (time: number) => void;
};

/**
 * Plays a video on a canvas. It knows nothing about what is drawn: both kinds
 * of video hand it a draw function. The same canvas is recorded for export,
 * so the download always matches the preview.
 */
export function Player(props: Props) {
  const { width, height, duration, draw, describe, ref, locked = false } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const dirtyRef = useRef(true);
  const refreshInfoRef = useRef(true);
  // The animation loop reads the latest props through this ref.
  const liveRef = useRef(props);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [info, setInfo] = useState<MomentInfo>(() => describe(0));
  const ready = draw !== null;

  useEffect(() => {
    liveRef.current = props;
  });

  // Edits, a new shape or freshly loaded pictures all need a repaint.
  useEffect(() => {
    timeRef.current = Math.min(timeRef.current, duration);
    dirtyRef.current = true;
    refreshInfoRef.current = true;
  }, [draw, describe, duration, width, height, locked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !ready) return;

    scratchRef.current ??= document.createElement("canvas");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    let lastUiUpdate = 0;
    let lastIndex = -1;
    let lastText = "";

    const tick = (now: number) => {
      const live = liveRef.current;
      const total = live.duration;
      // Clamped so a background tab resumes where it left off instead of jumping.
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (playingRef.current) {
        // With sound, follow the sound's clock; otherwise count frame time.
        const heard = live.transport?.now() ?? null;
        timeRef.current = Math.min(total, heard ?? timeRef.current + elapsed);
        dirtyRef.current = true;
      }

      if (dirtyRef.current && live.draw) {
        dirtyRef.current = false;
        const atEnd = timeRef.current >= total;
        // Paused mid-video (or reduced motion): show each scene fully arrived.
        const settled =
          !live.locked && ((!playingRef.current && !atEnd) || reducedMotion.matches);
        live.draw(ctx, timeRef.current, { scratch: scratchRef.current, settled });

        const moment = live.describe(timeRef.current);
        if (moment.index !== lastIndex || moment.text !== lastText || refreshInfoRef.current) {
          if (moment.index !== lastIndex) live.onSceneChange?.(moment.index);
          lastIndex = moment.index;
          lastText = moment.text;
          refreshInfoRef.current = false;
          setInfo(moment);
        }
        if (!playingRef.current || now - lastUiUpdate > 120) {
          lastUiUpdate = now;
          setTime(timeRef.current);
          live.onProgress?.(timeRef.current);
        }
      }

      if (playingRef.current && timeRef.current >= total) {
        playingRef.current = false;
        live.transport?.stop();
        setPlaying(false);
        setTime(total);
        live.onProgress?.(total);
        live.onEnded?.();
      }
      frame = requestAnimationFrame(tick);
    };

    dirtyRef.current = true;
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  const pause = useCallback(() => {
    playingRef.current = false;
    dirtyRef.current = true;
    liveRef.current.transport?.stop();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (timeRef.current >= liveRef.current.duration - 0.05) timeRef.current = 0;
    playingRef.current = true;
    liveRef.current.transport?.start(timeRef.current);
    setPlaying(true);
  }, []);

  const seek = useCallback((next: number) => {
    timeRef.current = Math.min(Math.max(next, 0), liveRef.current.duration);
    dirtyRef.current = true;
  }, []);

  const seekToScene = useCallback(
    (index: number) => {
      pause();
      // Land just inside the scene so the right one is selected.
      seek(liveRef.current.sceneStart(index) + 0.01);
    },
    [pause, seek],
  );

  useImperativeHandle(
    ref,
    () => ({ getCanvas: () => canvasRef.current, play, pause, seek, seekToScene }),
    [play, pause, seek, seekToScene],
  );

  // Don't keep playing in a hidden tab (unless a recording is in progress).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && !liveRef.current.locked) pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pause]);

  const sceneLabel = `Scene ${Math.min(info.index + 1, info.count)} of ${info.count}`;
  const description = `${sceneLabel}. ${info.text}`;

  return (
    <div>
      <div className="flex justify-center rounded-3xl border border-line bg-surface p-2 shadow-sm">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          role="img"
          aria-label={`Video preview. ${description}`}
          className="h-auto max-h-[62dvh] w-auto max-w-full rounded-2xl bg-canvas lg:max-h-[70dvh]"
        >
          {description}
        </canvas>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <IconButton
          label={playing ? "Pause" : "Play"}
          onClick={playing ? pause : play}
          disabled={locked || !ready}
          className="bg-brand text-white hover:bg-brand-strong hover:text-white"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton
          label="Back to the start"
          onClick={() => {
            pause();
            seek(0);
          }}
          disabled={locked || !ready}
        >
          <RestartIcon />
        </IconButton>
        <input
          type="range"
          min={0}
          max={Math.round(duration * 10) / 10}
          step={0.1}
          // Kept on the slider's 0.1s steps so the browser never has to round it.
          value={Math.round(Math.min(time, duration) * 10) / 10}
          disabled={locked || !ready}
          onChange={(event) => {
            const next = Number(event.target.value);
            pause();
            seek(next);
            // Update straight away so the thumb doesn't snap back before the next frame.
            setTime(next);
          }}
          aria-label="Position in video"
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}, ${sceneLabel}`}
          className="mx-2 h-11 min-w-0 flex-1 accent-brand disabled:opacity-50"
        />
        <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted" aria-live="off">
        {sceneLabel}
        {locked ? " · Recording, please keep this tab open" : ""}
      </p>
    </div>
  );
}
