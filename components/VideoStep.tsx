"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import { downloadText, slugify } from "@/lib/download";
import { useEndCardImage, withEndCard } from "@/lib/endCard";
import type { ErrorInfo } from "@/lib/errors";
import { assemblePrompt } from "@/lib/prompt";
import { dimensionsFor, drawFrame, locate, sceneStart, totalDuration } from "@/lib/renderer";
import { SceneResponseSchema, type FiveStepPrompt, type Storyboard } from "@/lib/schemas";
import { useRecording } from "@/lib/useRecording";
import { useRenderAssets } from "@/lib/useRenderAssets";
import { getVisual } from "@/lib/visuals";
import { ExportPanel } from "./ExportPanel";
import { Player, type DrawFunction, type PlayerHandle } from "./Player";
import { SceneList } from "./SceneList";
import { VideoDetails } from "./VideoDetails";
import { Button } from "./ui";

type Props = {
  prompt: FiveStepPrompt;
  storyboard: Storyboard;
  /** False while another step or section is showing (this one stays mounted to keep its work). */
  active: boolean;
  apiKey: string;
  onStoryboardChange: (update: (current: Storyboard) => Storyboard) => void;
  onBackToPrompt: () => void;
  onStartOver: () => void;
  onUseOwnKey: () => void;
};

/** Step 3 for explainer videos: watch, edit scenes, record and download. */
export function VideoStep(props: Props) {
  const { prompt, storyboard, apiKey, onStoryboardChange } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const recording = useRecording(playerRef);
  const { isRecording, invalidate, cancel } = recording;

  const [activeIndex, setActiveIndex] = useState(0);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<{ sceneId: string; error: ErrorInfo } | null>(null);

  const dims = dimensionsFor(storyboard.aspectRatio);
  const duration = totalDuration(storyboard);
  const fileBase = slugify(storyboard.title);

  const storyboardText = useMemo(
    () =>
      storyboard.scenes.flatMap((scene) => [scene.heading, scene.body, ...scene.bullets]).join(" "),
    [storyboard],
  );
  const assets = useRenderAssets(storyboardText);

  const draw = useMemo<DrawFunction | null>(
    () => (assets ? (ctx, time, options) => drawFrame(ctx, storyboard, time, assets, options) : null),
    [storyboard, assets],
  );
  const describe = useCallback(
    (time: number) => {
      const { index } = locate(storyboard, time);
      const scene = storyboard.scenes[index];
      return {
        index,
        count: storyboard.scenes.length,
        text: `${scene.heading}. ${scene.body} ${scene.bullets.join(". ")} Picture: ${getVisual(scene.visual).alt}.`,
      };
    },
    [storyboard],
  );
  const startOfScene = useCallback((index: number) => sceneStart(storyboard, index), [storyboard]);

  // Every video closes with the Instagram QR card unless it is switched off.
  const endCardImage = useEndCardImage();
  const [endCardOn, setEndCardOn] = useState(true);
  const video = useMemo(
    () =>
      withEndCard(
        { dims: { width: dims.width, height: dims.height }, duration, draw, describe },
        endCardOn ? endCardImage : null,
      ),
    [dims.width, dims.height, duration, draw, describe, endCardOn, endCardImage],
  );

  useEffect(() => {
    if (props.active) {
      headingRef.current?.focus();
    } else {
      cancel();
      playerRef.current?.pause();
    }
  }, [props.active, cancel]);

  /** Any edit makes an already recorded video out of date. */
  const changeStoryboard = useCallback(
    (update: (current: Storyboard) => Storyboard) => {
      onStoryboardChange(update);
      invalidate();
    },
    [onStoryboardChange, invalidate],
  );

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
            width={dims.width}
            height={dims.height}
            duration={video.duration}
            draw={video.draw}
            describe={video.describe}
            sceneStart={startOfScene}
            locked={isRecording}
            onEnded={recording.handleEnded}
            onSceneChange={setActiveIndex}
            onProgress={recording.handleProgress}
          />
          <ExportPanel
            format={recording.format}
            state={recording.state}
            duration={video.duration}
            fileBase={fileBase}
            onRecord={recording.start}
            onCancel={recording.cancel}
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
          <VideoDetails
            title={storyboard.title}
            aspectRatio={storyboard.aspectRatio}
            disabled={isRecording}
            endCard={endCardImage ? endCardOn : null}
            onEndCardChange={(on) => {
              setEndCardOn(on);
              invalidate();
            }}
            onTitleChange={(title) => changeStoryboard((current) => ({ ...current, title }))}
            onAspectRatioChange={(aspectRatio) =>
              changeStoryboard((current) => ({ ...current, aspectRatio }))
            }
          />

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
