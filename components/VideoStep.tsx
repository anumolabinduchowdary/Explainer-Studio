"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import { downloadText, slugify } from "@/lib/download";
import type { ExportJob } from "@/lib/exportVideo";
import { useEndCardImage, withEndCard } from "@/lib/endCard";
import type { ErrorInfo } from "@/lib/errors";
import { assemblePrompt } from "@/lib/prompt";
import { dimensionsFor, drawFrame, locate, sceneStart, totalDuration } from "@/lib/renderer";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { suggestCaption } from "@/lib/share";
import { SceneResponseSchema, type FiveStepPrompt, type Storyboard } from "@/lib/schemas";
import { useRecording } from "@/lib/useRecording";
import { useRenderAssets } from "@/lib/useRenderAssets";
import { TranslateResponseSchema, storyboardTexts, withStoryboardTexts, type Texts } from "@/lib/translate";
import { getVisual } from "@/lib/visuals";
import { thumbnailFrom } from "@/lib/thumbnail";
import { checkFacts, textsKey, type FactsState } from "@/lib/checks";
import type { YouTubeInfo } from "@/lib/youtube";
import { ExportPanel } from "./ExportPanel";
import { LanguagePanel } from "./LanguagePanel";
import { QualityPanel } from "./QualityPanel";
import { Player, type DrawFunction, type PlayerHandle } from "./Player";
import { SceneList } from "./SceneList";
import { VideoDetails } from "./VideoDetails";
import { Button } from "./ui";

type Props = {
  prompt: FiveStepPrompt;
  /** The language chosen on the Describe step, if any. */
  language: string;
  storyboard: Storyboard;
  /** The automatic fact check made when the storyboard was written. */
  initialFacts: FactsState;
  /** False while another step or section is showing (this one stays mounted to keep its work). */
  active: boolean;
  apiKey: string;
  /** Whether finished videos can be posted straight to YouTube. */
  youtubeEnabled: boolean;
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
  // What to build when the user asks for the file; filled in below, once the video is known.
  const exportJob = useRef<() => ExportJob | null>(() => null);
  const recording = useRecording(
    playerRef,
    undefined,
    useCallback(async () => exportJob.current(), []),
  );
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

  // Videos about special parenting close with the Instagram QR card; it can be switched either way.
  const endCardImage = useEndCardImage();
  const [endCardOn, setEndCardOn] = useState(storyboard.specialParenting === true);
  const video = useMemo(
    () =>
      withEndCard(
        { dims: { width: dims.width, height: dims.height }, duration, draw, describe },
        endCardOn ? endCardImage : null,
      ),
    [dims.width, dims.height, duration, draw, describe, endCardOn, endCardImage],
  );

  useEffect(() => {
    exportJob.current = () =>
      video.draw
        ? { width: dims.width, height: dims.height, duration: video.duration, draw: video.draw, sound: null }
        : null;
  });

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

  /* ---------------- Quality: the words' fact check ---------------- */

  const [facts, setFacts] = useState<FactsState>(props.initialFacts);
  // Each language version keeps its own check, so switching back does not need checking again.
  const factsByLanguage = useRef(new Map<string, FactsState>());
  const currentTexts = useMemo(() => textsKey(storyboardTexts(storyboard)), [storyboard]);
  const factsOutOfDate = facts.status === "checked" && facts.texts !== currentTexts;

  /* ---------------- Other languages ---------------- */

  // Each language's words, so switching back does not need translating again.
  const [language, setLanguage] = useState(() => props.language.trim() || "Original");
  // The language showing right now, for checks that finish later.
  const languageRef = useRef(language);
  const [versions, setVersions] = useState<string[]>(() => [props.language.trim() || "Original"]);
  const saved = useRef(new Map<string, Texts>());
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<ErrorInfo | null>(null);

  const translateTo = async (target: string) => {
    setTranslating(true);
    setTranslateError(null);
    try {
      const { texts } = await postJson(
        "/api/translate",
        { language: target, kind: "storyboard", texts: storyboardTexts(storyboard) },
        TranslateResponseSchema,
        { apiKey: apiKey || undefined, timeoutMs: 75_000 },
      );
      saved.current.set(language, storyboardTexts(storyboard));
      saved.current.set(target, texts);
      factsByLanguage.current.set(language, facts);
      changeStoryboard((current) => withStoryboardTexts(current, texts));
      setLanguage(target);
      languageRef.current = target;
      setVersions((names) => (names.includes(target) ? names : [...names, target]));
      // The new words are checked straight away, so the translated video can be ready to post without a press.
      void checkWords(withStoryboardTexts(storyboard, texts), target);
    } catch (err) {
      setTranslateError(toErrorInfo(err));
    } finally {
      setTranslating(false);
    }
  };

  const switchTo = (name: string) => {
    const texts = saved.current.get(name);
    if (!texts || name === language) return;
    // Edits made in this language are kept for when it is shown again.
    saved.current.set(language, storyboardTexts(storyboard));
    factsByLanguage.current.set(language, facts);
    changeStoryboard((current) => withStoryboardTexts(current, texts));
    setLanguage(name);
    languageRef.current = name;
    // A version checked before keeps its result; one that never was is checked now.
    const known = factsByLanguage.current.get(name);
    if (known && known.status === "checked") setFacts(known);
    else void checkWords(withStoryboardTexts(storyboard, texts), name);
  };

  /* ---------------- Quality ---------------- */

  /**
   * Checks the words of one language version and applies any fixes. A check
   * that finishes after the person has switched to another language is
   * dropped, so fixes never land in the wrong language.
   */
  async function checkWords(base: Storyboard, lang: string) {
    setFacts({ status: "checking" });
    try {
      const result = await checkFacts("explainer", lang === "Original" ? "" : lang, storyboardTexts(base), apiKey);
      if (languageRef.current !== lang) return;
      const fixed = withStoryboardTexts(base, result.texts);
      if (Object.keys(result.texts).length) changeStoryboard((current) => withStoryboardTexts(current, result.texts));
      setFacts({ status: "checked", result, texts: textsKey(storyboardTexts(fixed)) });
    } catch (err) {
      if (languageRef.current === lang) setFacts({ status: "failed", message: toErrorInfo(err).message });
    }
  }
  /** Checks the words again, for example after edits. */
  const recheckFacts = () => checkWords(storyboard, language);

  /* ---------------- YouTube ---------------- */

  /** The first scene, drawn wide (16:9) and settled, as the YouTube thumbnail. */
  const makeThumbnail = useCallback(async (): Promise<string | null> => {
    if (!assets) return null;
    const wide: Storyboard = { ...storyboard, aspectRatio: "16:9" };
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const first = wide.scenes[0];
    drawFrame(ctx, wide, sceneStart(wide, 0) + Math.min(2, (first?.durationSec ?? 2) * 0.6), assets, { settled: true });
    return thumbnailFrom(canvas, storyboard.title, assets.headingFont);
  }, [assets, storyboard]);

  const youtube = useMemo<YouTubeInfo | undefined>(
    () =>
      props.youtubeEnabled
        ? {
            kind: "explainer",
            title: storyboard.title,
            script: storyboardText,
            language: language === "Original" ? "" : language,
            health: storyboard.scenes.some((scene) => scene.body.includes(HEALTH_DISCLAIMER)),
            aiVoices: false,
            sources: facts.status === "checked" ? facts.result.sources : [],
            follow: endCardOn,
            apiKey,
            makeThumbnail,
          }
        : undefined,
    [props.youtubeEnabled, storyboard, storyboardText, language, apiKey, makeThumbnail, facts, endCardOn],
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
            live={recording.live}
            title={storyboard.title}
            youtube={youtube}
            caption={suggestCaption({
              title: storyboard.title,
              health: storyboard.scenes.some((scene) => scene.body.includes(HEALTH_DISCLAIMER)),
              aiVoices: false,
              follow: endCardOn,
            })}
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
          <QualityPanel facts={facts} factsOutOfDate={factsOutOfDate} onCheckFacts={() => void recheckFacts()} />

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

          <LanguagePanel
            current={language}
            versions={versions}
            busy={translating}
            error={translateError}
            disabled={isRecording}
            hasVoices={false}
            onTranslate={translateTo}
            onSwitch={switchTo}
            onUseOwnKey={props.onUseOwnKey}
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
