"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerHandle } from "@/components/Player";
import {
  pickRecordingFormat,
  startRecording,
  type Recording,
  type RecordingState,
} from "./recorder";

/**
 * Records the player's canvas from start to finish. Shared by both kinds of
 * video. Only ever used in the browser, after the user has acted.
 */
export type RecordingSound = {
  /** Returns the sound to record with the picture, or null for a silent video. */
  stream: () => MediaStream | null;
  /** Resolves when the sound is ready to play, so recording can begin. */
  prepare: () => Promise<void>;
};

export function useRecording(playerRef: RefObject<PlayerHandle | null>, sound?: RecordingSound) {
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  });

  const recordingRef = useRef<Recording | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  // Changes whenever a recording is started or cancelled.
  const sessionRef = useRef(0);
  const [format] = useState(() => pickRecordingFormat());
  const [state, setState] = useState<RecordingState>({ status: "idle" });

  const releaseVideo = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
  }, []);

  // Stop any recording and free the video file when leaving the page.
  useEffect(
    () => () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
      releaseVideo();
    },
    [releaseVideo],
  );

  const start = useCallback(() => {
    const player = playerRef.current;
    const canvas = player?.getCanvas();
    if (!player || !canvas) return;
    releaseVideo();
    player.pause();
    player.seek(0);
    setState({ status: "recording", time: 0 });
    const session = ++sessionRef.current;
    // Give the first frame a moment to paint before the recorder starts.
    const begin = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (session !== sessionRef.current) return; // cancelled in the meantime
          try {
            recordingRef.current = startRecording(canvas, soundRef.current?.stream() ?? null);
            player.play();
          } catch {
            setState({ status: "error" });
          }
        }),
      );
    const ready = soundRef.current?.prepare();
    if (ready) void ready.then(begin, begin);
    else begin();
  }, [playerRef, releaseVideo]);

  const cancel = useCallback(() => {
    sessionRef.current++;
    recordingRef.current?.cancel();
    recordingRef.current = null;
    playerRef.current?.pause();
    // A finished video is kept; only a recording in progress is thrown away.
    setState((current) => (current.status === "recording" ? { status: "idle" } : current));
  }, [playerRef]);

  /** Pass to the player's onEnded: finishes the file when playback reaches the end. */
  const handleEnded = useCallback(() => {
    const active = recordingRef.current;
    if (!active) return;
    recordingRef.current = null;
    // Hold the last frame briefly so it is included in the file.
    setTimeout(async () => {
      try {
        const blob = await active.stop();
        if (blob.size === 0) throw new Error("Empty recording");
        const url = URL.createObjectURL(blob);
        videoUrlRef.current = url;
        setState({ status: "done", url, size: blob.size, format: active.format });
      } catch {
        setState({ status: "error" });
      }
    }, 400);
  }, []);

  /** Pass to the player's onProgress. */
  const handleProgress = useCallback((time: number) => {
    setState((current) =>
      current.status === "recording" && current.time !== time
        ? { status: "recording", time }
        : current,
    );
  }, []);

  /** Call after any edit: an already recorded video is now out of date. */
  const invalidate = useCallback(() => {
    setState((current) => {
      if (current.status !== "done") return current;
      releaseVideo();
      return { status: "idle" };
    });
  }, [releaseVideo]);

  return {
    format,
    state,
    isRecording: state.status === "recording",
    start,
    cancel,
    handleEnded,
    handleProgress,
    invalidate,
  };
}
