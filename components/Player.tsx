"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  dimensionsFor,
  drawFrame,
  formatTime,
  locate,
  sceneStart,
  totalDuration,
} from "@/lib/renderer";
import type { Storyboard } from "@/lib/schemas";
import { useRenderAssets } from "@/lib/useRenderAssets";
import { getVisual } from "@/lib/visuals";
import { IconButton, PauseIcon, PlayIcon, RestartIcon } from "./ui";

export type PlayerHandle = {
  getCanvas: () => HTMLCanvasElement | null;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  seekToScene: (index: number) => void;
};

type Props = {
  storyboard: Storyboard;
  ref?: Ref<PlayerHandle>;
  /** True while exporting: controls are disabled and playback is always fully animated. */
  locked?: boolean;
  onEnded?: () => void;
  onSceneChange?: (index: number) => void;
  onProgress?: (time: number) => void;
};

/**
 * Plays a storyboard on a canvas. The same canvas is recorded for export, so
 * the download always matches the preview.
 */
export function Player({ storyboard, ref, locked = false, onEnded, onSceneChange, onProgress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const dirtyRef = useRef(true);
  // The animation loop reads the latest props through this ref.
  const liveRef = useRef({ storyboard, locked, onEnded, onSceneChange, onProgress });

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [sceneIndex, setSceneIndex] = useState(0);

  const storyboardText = useMemo(
    () =>
      storyboard.scenes.flatMap((scene) => [scene.heading, scene.body, ...scene.bullets]).join(" "),
    [storyboard],
  );
  const assets = useRenderAssets(storyboardText);
  const dims = dimensionsFor(storyboard.aspectRatio);
  const duration = totalDuration(storyboard);

  useEffect(() => {
    liveRef.current = { storyboard, locked, onEnded, onSceneChange, onProgress };
  });

  // Edits, a new shape or freshly loaded fonts all need a repaint.
  useEffect(() => {
    timeRef.current = Math.min(timeRef.current, totalDuration(storyboard));
    dirtyRef.current = true;
  }, [storyboard, locked, assets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !assets) return;

    scratchRef.current ??= document.createElement("canvas");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    let lastUiUpdate = 0;
    let lastIndex = -1;

    const tick = (now: number) => {
      const live = liveRef.current;
      const total = totalDuration(live.storyboard);
      // Clamped so a background tab resumes where it left off instead of jumping.
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (playingRef.current) {
        timeRef.current = Math.min(total, timeRef.current + elapsed);
        dirtyRef.current = true;
      }

      if (dirtyRef.current) {
        dirtyRef.current = false;
        const atEnd = timeRef.current >= total;
        // Paused mid-video (or reduced motion): show each scene fully arrived.
        const settled =
          !live.locked && ((!playingRef.current && !atEnd) || reducedMotion.matches);
        drawFrame(ctx, live.storyboard, timeRef.current, assets, {
          scratch: scratchRef.current,
          settled,
        });

        const index = locate(live.storyboard, timeRef.current).index;
        if (index !== lastIndex) {
          lastIndex = index;
          setSceneIndex(index);
          live.onSceneChange?.(index);
        }
        if (!playingRef.current || now - lastUiUpdate > 120) {
          lastUiUpdate = now;
          setTime(timeRef.current);
          live.onProgress?.(timeRef.current);
        }
      }

      if (playingRef.current && timeRef.current >= total) {
        playingRef.current = false;
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
  }, [assets]);

  const pause = useCallback(() => {
    playingRef.current = false;
    dirtyRef.current = true;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (timeRef.current >= totalDuration(liveRef.current.storyboard) - 0.05) timeRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  }, []);

  const seek = useCallback((next: number) => {
    const total = totalDuration(liveRef.current.storyboard);
    timeRef.current = Math.min(Math.max(next, 0), total);
    dirtyRef.current = true;
  }, []);

  const seekToScene = useCallback(
    (index: number) => {
      pause();
      // Land just inside the scene so the right one is selected.
      seek(sceneStart(liveRef.current.storyboard, index) + 0.01);
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

  const scene = storyboard.scenes[Math.min(sceneIndex, storyboard.scenes.length - 1)];
  const sceneLabel = `Scene ${Math.min(sceneIndex + 1, storyboard.scenes.length)} of ${storyboard.scenes.length}`;
  const description = `${sceneLabel}. ${scene.heading}. ${scene.body} ${scene.bullets.join(". ")} Picture: ${getVisual(scene.visual).alt}.`;

  return (
    <div>
      <div className="flex justify-center rounded-3xl border border-line bg-surface p-2 shadow-sm">
        <canvas
          ref={canvasRef}
          width={dims.width}
          height={dims.height}
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
          disabled={locked || !assets}
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
          disabled={locked || !assets}
        >
          <RestartIcon />
        </IconButton>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          // Kept on the slider's 0.1s steps so the browser never has to round it.
          value={Math.round(Math.min(time, duration) * 10) / 10}
          disabled={locked || !assets}
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
