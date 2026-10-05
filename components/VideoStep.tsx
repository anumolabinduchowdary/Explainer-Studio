"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import { downloadText, slugify } from "@/lib/download";
import type { ErrorInfo } from "@/lib/errors";
import { assemblePrompt } from "@/lib/prompt";
import { pickRecordingFormat, startRecording, type Recording } from "@/lib/recorder";
import { totalDuration } from "@/lib/renderer";
import {
  ASPECT_RATIOS,
  LIMITS,
  SceneResponseSchema,
  type AspectRatio,
  type FiveStepPrompt,
  type Storyboard,
} from "@/lib/schemas";
import { ExportPanel, type RecordingState } from "./ExportPanel";
import { Player, type PlayerHandle } from "./Player";
import { SceneList } from "./SceneList";
import { Button, inputClass } from "./ui";

const SHAPE_LABELS: Record<AspectRatio, string> = {
  "9:16": "Tall (9:16)",
  "16:9": "Wide (16:9)",
  "1:1": "Square (1:1)",
};

type Props = {
  prompt: FiveStepPrompt;
  storyboard: Storyboard;
  apiKey: string;
  onStoryboardChange: (update: (current: Storyboard) => Storyboard) => void;
  onBackToPrompt: () => void;
  onStartOver: () => void;
  onUseOwnKey: () => void;
};

export function VideoStep(props: Props) {
  const { prompt, storyboard, apiKey, onStoryboardChange } = props;
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const recordingRef = useRef<Recording | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  // This step only ever renders in the browser, after the user has acted.
  const [format] = useState(() => pickRecordingFormat());
  const [recording, setRecording] = useState<RecordingState>({ status: "idle" });
  const [activeIndex, setActiveIndex] = useState(0);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<{ sceneId: string; error: ErrorInfo } | null>(null);

  const isRecording = recording.status === "recording";
  const duration = totalDuration(storyboard);
  const fileBase = slugify(storyboard.title);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const releaseVideo = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
  }, []);

  // Stop any recording and free the video file when leaving this step.
  useEffect(
    () => () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
      releaseVideo();
    },
    [releaseVideo],
  );

  /** Any edit makes an already recorded video out of date. */
  const changeStoryboard = useCallback(
    (update: (current: Storyboard) => Storyboard) => {
      onStoryboardChange(update);
      setRecording((state) => {
        if (state.status !== "done") return state;
        releaseVideo();
        return { status: "idle" };
      });
    },
    [onStoryboardChange, releaseVideo],
  );

  const startRecord = () => {
    const player = playerRef.current;
    const canvas = player?.getCanvas();
    if (!player || !canvas) return;
    releaseVideo();
    player.pause();
    player.seek(0);
    setRecording({ status: "recording", time: 0 });
    // Give the first frame a moment to paint before the recorder starts.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          recordingRef.current = startRecording(canvas);
          player.play();
        } catch {
          setRecording({ status: "error" });
        }
      }),
    );
  };

  const cancelRecord = () => {
    recordingRef.current?.cancel();
    recordingRef.current = null;
    playerRef.current?.pause();
    setRecording({ status: "idle" });
  };

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
        setRecording({ status: "done", url, size: blob.size, format: active.format });
      } catch {
        setRecording({ status: "error" });
      }
    }, 400);
  }, []);

  const handleProgress = useCallback((time: number) => {
    setRecording((state) =>
      state.status === "recording" && state.time !== time ? { status: "recording", time } : state,
    );
  }, []);

  const regenerate = async (sceneId: string, instruction: string) => {
    setRegeneratingId(sceneId);
    setSceneError(null);
    try {
      const { scene } = await postJson(
        "/api/scene",
        { prompt, storyboard, sceneId, ...(instruction ? { instruction } : {}) },
        SceneResponseSchema,
        { apiKey: apiKey || undefined },
      );
      changeStoryboard((current) => ({
        ...current,
        scenes: current.scenes.map((s) => (s.id === sceneId ? scene : s)),
      }));
    } catch (err) {
      setSceneError({ sceneId, error: toErrorInfo(err) });
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold sm:text-4xl">
        Your video
      </h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        Press play to watch it. Edit any scene, then record and download.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Player
            ref={playerRef}
            storyboard={storyboard}
            locked={isRecording}
            onEnded={handleEnded}
            onSceneChange={setActiveIndex}
            onProgress={handleProgress}
          />
          <ExportPanel
            format={format}
            state={recording}
            duration={duration}
            fileBase={fileBase}
            onRecord={startRecord}
            onCancel={cancelRecord}
            onDownloadStoryboard={() =>
              downloadText(
                `${fileBase}.storyboard.json`,
                JSON.stringify(storyboard, null, 2),
                "application/json",
              )
            }
            onDownloadPrompt={() =>
              downloadText(`${fileBase}.prompt.txt`, assemblePrompt(prompt), "text/plain")
            }
          />
        </div>

        <div className="min-w-0 space-y-6">
          <fieldset disabled={isRecording} className="min-w-0 space-y-4 disabled:opacity-60">
            <legend className="sr-only">Video details</legend>
            <div>
              <label htmlFor={`${id}-title`} className="mb-1 block font-semibold">
                Video title
              </label>
              <input
                id={`${id}-title`}
                type="text"
                value={storyboard.title}
                maxLength={LIMITS.title}
                onChange={(event) =>
                  changeStoryboard((current) => ({ ...current, title: event.target.value }))
                }
                className={inputClass}
              />
            </div>
            <fieldset>
              <legend className="mb-1 font-semibold">Shape</legend>
              <div className="flex flex-wrap gap-2">
                {ASPECT_RATIOS.map((ratio) => (
                  <label key={ratio} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`${id}-shape`}
                      value={ratio}
                      checked={storyboard.aspectRatio === ratio}
                      onChange={() =>
                        changeStoryboard((current) => ({ ...current, aspectRatio: ratio }))
                      }
                      className="peer sr-only"
                    />
                    <span className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 font-semibold transition-colors duration-200 hover:border-brand peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand-strong peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                      {SHAPE_LABELS[ratio]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>

          <SceneList
            storyboard={storyboard}
            activeIndex={activeIndex}
            disabled={isRecording}
            regeneratingId={regeneratingId}
            sceneError={sceneError}
            onChange={changeStoryboard}
            onSelect={(index) => playerRef.current?.seekToScene(index)}
            onRegenerate={regenerate}
            onUseOwnKey={props.onUseOwnKey}
          />

          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            <Button disabled={isRecording} onClick={props.onBackToPrompt}>
              Back to prompt
            </Button>
            <Button variant="ghost" disabled={isRecording} onClick={props.onStartOver}>
              Start a new video
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
