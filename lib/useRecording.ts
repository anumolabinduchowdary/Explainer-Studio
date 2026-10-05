"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerHandle } from "@/components/Player";
import { buildVideo, canBuildVideo, type ExportJob } from "./exportVideo";
import {
  pickRecordingFormat,
  startRecording,
  type Recording,
  type RecordingFormat,
  type RecordingState,
} from "./recorder";

/**
 * Turns the video on screen into a file. Shared by both kinds of video, and
 * only ever used in the browser, after the user has acted.
 *
 * The normal way builds the file frame by frame (see exportVideo.ts). Browsers
 * that cannot do that fall back to recording the player live as it plays.
 */

/** Sound for the live-recording fallback. */
export type RecordingSound = {
  /** Returns the sound to record with the picture, or null for a silent video. */
  stream: () => MediaStream | null;
  /** Resolves when the sound is ready to play, so recording can begin. */
  prepare: () => Promise<void>;
};

/** What to build: asked for at the moment the user presses the button. */
export type ExportSource = () => Promise<ExportJob | null>;

const BUILT_FORMAT: RecordingFormat = {
  mimeType: "video/mp4",
  withSound: "video/mp4",
  extension: "mp4",
  label: "MP4",
};

export function useRecording(
  playerRef: RefObject<PlayerHandle | null>,
  sound?: RecordingSound,
  exportSource?: ExportSource,
) {
  const soundRef = useRef(sound);
  const exportRef = useRef(exportSource);
  useEffect(() => {
    soundRef.current = sound;
    exportRef.current = exportSource;
  });

  const recordingRef = useRef<Recording | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  // Changes whenever a video is started or cancelled.
  const sessionRef = useRef(0);
  // Set if building frame by frame failed once, so the next try records live instead.
  const buildFailedRef = useRef(false);
  // True while the live fallback is running: only then does the player's clock drive progress.
  const liveRef = useRef(false);

  const [liveFormat] = useState(() => pickRecordingFormat());
  const [canBuild, setCanBuild] = useState(false);
  const [state, setState] = useState<RecordingState>({ status: "idle" });
  const [live, setLive] = useState(false);

  // Whether this browser can build videos is only known after asking it.
  useEffect(() => {
    let active = true;
    void canBuildVideo(1080, 1920, true).then((ok) => {
      if (active) setCanBuild(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const releaseVideo = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
  }, []);

  // Stop any work in progress and free the video file when leaving the page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      recordingRef.current?.cancel();
      recordingRef.current = null;
      releaseVideo();
    },
    [releaseVideo],
  );

  const finish = useCallback((blob: Blob, format: RecordingFormat) => {
    const url = URL.createObjectURL(blob);
    videoUrlRef.current = url;
    setState({ status: "done", url, size: blob.size, format, video: blob });
  }, []);

  /** The fallback: plays the video on screen from the start and records it as it goes. */
  const recordLive = useCallback(
    (session: number) => {
      const player = playerRef.current;
      const canvas = player?.getCanvas();
      if (!player || !canvas) {
        setState({ status: "error" });
        return;
      }
      liveRef.current = true;
      setLive(true);
      player.pause();
      player.seek(0);
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
    },
    [playerRef],
  );

  const start = useCallback(async () => {
    releaseVideo();
    playerRef.current?.pause();
    liveRef.current = false;
    setLive(false);
    setState({ status: "recording", time: 0 });
    const session = ++sessionRef.current;

    let job: ExportJob | null = null;
    if (!buildFailedRef.current) {
      try {
        job = (await exportRef.current?.()) ?? null;
        if (job && !(await canBuildVideo(job.width, job.height, job.sound !== null))) job = null;
      } catch {
        job = null;
      }
    }
    if (session !== sessionRef.current) return;
    if (!job) {
      recordLive(session);
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const blob = await buildVideo(job, {
        signal: abort.signal,
        onProgress: (time) => {
          if (session === sessionRef.current) setState({ status: "recording", time });
        },
      });
      if (session === sessionRef.current) finish(blob, BUILT_FORMAT);
    } catch (err) {
      if (session !== sessionRef.current) return; // cancelled: the state is already reset
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        buildFailedRef.current = true;
        setState({ status: "error" });
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [playerRef, releaseVideo, recordLive, finish]);

  const cancel = useCallback(() => {
    sessionRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    recordingRef.current?.cancel();
    recordingRef.current = null;
    playerRef.current?.pause();
    // A finished video is kept; only one in progress is thrown away.
    setState((current) => (current.status === "recording" ? { status: "idle" } : current));
  }, [playerRef]);

  /** Pass to the player's onEnded: finishes a live recording when playback reaches the end. */
  const handleEnded = useCallback(() => {
    const active = recordingRef.current;
    if (!active) return;
    recordingRef.current = null;
    // Hold the last frame briefly so it is included in the file.
    setTimeout(async () => {
      try {
        const blob = await active.stop();
        if (blob.size === 0) throw new Error("Empty recording");
        finish(blob, active.format);
      } catch {
        setState({ status: "error" });
      }
    }, 400);
  }, [finish]);

  /** Pass to the player's onProgress. Only a live recording follows the player's clock. */
  const handleProgress = useCallback((time: number) => {
    if (!liveRef.current) return;
    setState((current) =>
      current.status === "recording" && current.time !== time
        ? { status: "recording", time }
        : current,
    );
  }, []);

  /** Call after any edit: an already made video is now out of date. */
  const invalidate = useCallback(() => {
    setState((current) => {
      if (current.status !== "done") return current;
      releaseVideo();
      return { status: "idle" };
    });
  }, [releaseVideo]);

  return {
    /** The kind of file that will be made, or null if this browser can make none. */
    format: canBuild ? BUILT_FORMAT : liveFormat,
    state,
    isRecording: state.status === "recording",
    /** True while the live-recording fallback is running (the player must stay visible). */
    live,
    start,
    cancel,
    handleEnded,
    handleProgress,
    invalidate,
  };
}
