"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorInfo } from "@/lib/api";
import { downloadText, slugify } from "@/lib/download";
import { assemblePrompt } from "@/lib/prompt";
import { dimensionsFor } from "@/lib/renderer";
import type { FiveStepPrompt } from "@/lib/schemas";
import {
  NARRATOR,
  clipKey,
  estimateLine,
  lineStarts,
  lineVoice,
  pictureKey,
  storyDuration,
  storySceneStart,
  type Story,
  type StoryLine,
  type TimeLine,
} from "@/lib/story";
import { StoryAudio, isMouthOpen, type Clip, type ScheduledClip } from "@/lib/storyAudio";
import {
  loadSprite,
  referencePng,
  requestPicture,
  requestSpeech,
  type PictureMap,
  type PictureState,
} from "@/lib/storyPictures";
import {
  describeStoryMoment,
  drawStoryFrame,
  type CharacterSprites,
  type Sprite,
  type StoryRenderAssets,
} from "@/lib/storyRenderer";
import { useRecording } from "@/lib/useRecording";
import { useCanvasFonts } from "@/lib/useRenderAssets";
import { ExportPanel } from "./ExportPanel";
import { Player, type DrawFunction, type PlayerHandle, type Transport } from "./Player";
import { StoryPictures, needsDrawing, pictureSource } from "./StoryPictures";
import { StoryScenes } from "./StoryScenes";
import { StoryVoices, clipKeysNeeded, type ClipMap, type ClipState } from "./StoryVoices";
import { VideoDetails } from "./VideoDetails";
import { Button } from "./ui";

/** A short breath after each spoken line. */
const VOICE_PAUSE_SEC = 0.35;

type Batch = { done: number; total: number } | null;

type Props = {
  prompt: FiveStepPrompt;
  story: Story;
  /** False while another step or section is showing (this one stays mounted to keep its pictures). */
  active: boolean;
  apiKey: string;
  onStoryChange: (update: (current: Story) => Story) => void;
  onBackToPrompt: () => void;
  onStartOver: () => void;
  onUseOwnKey: () => void;
};

/** Runs jobs a few at a time and reports progress. */
async function runJobs(
  jobs: Array<() => Promise<void>>,
  atOnce: number,
  shouldStop: () => boolean,
  onProgress: (done: number) => void,
) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length && !shouldStop()) {
      await jobs[next++]();
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
}

/** Step 3 for cartoon stories: draw the pictures, record the voices, watch, edit and download. */
export function StoryStep(props: Props) {
  const { prompt, story, apiKey, onStoryChange } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const audioRef = useRef<StoryAudio | null>(null);
  const hasVoicesRef = useRef(false);

  /** The audio player is created on first use, which must be inside a click (browser rule). */
  const getAudio = useCallback(() => (audioRef.current ??= new StoryAudio()), []);
  const recording = useRecording(
    playerRef,
    useMemo(
      () => ({
        stream: () => (hasVoicesRef.current ? getAudio().recordingStream() : null),
        prepare: async () => {
          if (hasVoicesRef.current) await getAudio().whenRunning();
        },
      }),
      [getAudio],
    ),
  );
  const { isRecording, invalidate, cancel } = recording;

  // Pictures and voice clips live in memory only: nothing is uploaded or saved anywhere.
  const [pictures, setPictures] = useState<PictureMap>({});
  const [mouthOff, setMouthOff] = useState<ReadonlySet<string>>(() => new Set());
  const [pictureBatch, setPictureBatch] = useState<Batch>(null);
  const [clips, setClips] = useState<ClipMap>({});
  const [voicesOn, setVoicesOn] = useState(true);
  const [voiceBatch, setVoiceBatch] = useState<Batch>(null);
  const [listeningTo, setListeningTo] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Drawing and recording take a while, so the jobs read the latest values through refs.
  const live = useRef({ story, apiKey, pictures, clips });
  const aliveRef = useRef(true);
  const stopPicturesRef = useRef(false);
  const stopVoicesRef = useRef(false);
  useEffect(() => {
    live.current = { story, apiKey, pictures, clips };
  });
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (props.active) {
      headingRef.current?.focus();
    } else {
      cancel();
      playerRef.current?.pause();
    }
  }, [props.active, cancel]);

  const dims = dimensionsFor(story.aspectRatio);
  const fileBase = slugify(story.title, "cartoon-story");

  /* ---------------- Timing: real clip lengths once voices exist ---------------- */

  const readyClip = useCallback(
    (line: StoryLine): Clip | null => {
      if (!voicesOn || !line.text.trim()) return null;
      const state = clips[clipKey(story, line)];
      return state?.status === "ready" ? state.clip : null;
    },
    [story, clips, voicesOn],
  );

  const timeLine = useMemo<TimeLine>(
    () => (line) => {
      const clip = readyClip(line);
      if (!clip) return estimateLine(line);
      return {
        duration: clip.duration + VOICE_PAUSE_SEC,
        speechStart: clip.speechStart,
        speechEnd: clip.speechEnd,
      };
    },
    [readyClip],
  );
  const duration = storyDuration(story, timeLine);

  const schedule = useMemo<ScheduledClip[]>(
    () =>
      lineStarts(story, timeLine).flatMap(({ line, at }) => {
        const clip = readyClip(line);
        return clip ? [{ at, clip }] : [];
      }),
    [story, timeLine, readyClip],
  );
  const hasVoices = schedule.length > 0;
  const scheduleRef = useRef(schedule);
  useEffect(() => {
    scheduleRef.current = schedule;
    hasVoicesRef.current = hasVoices;
    // The sound already playing was timed for the old script, so stop and let the user press play again.
    if (hasVoices) playerRef.current?.pause();
  }, [schedule, hasVoices]);

  const transport = useMemo<Transport | undefined>(
    () =>
      hasVoices
        ? {
            start: (time) => getAudio().start(time, scheduleRef.current),
            stop: () => audioRef.current?.stop(),
            now: () => audioRef.current?.now() ?? null,
          }
        : undefined,
    [hasVoices, getAudio],
  );

  /* ---------------- What the player draws ---------------- */

  const allText = useMemo(
    () => story.scenes.flatMap((scene) => scene.lines.map((line) => line.text)).join(" "),
    [story.scenes],
  );
  const fonts = useCanvasFonts(allText);

  const assets = useMemo<StoryRenderAssets | null>(() => {
    if (!fonts) return null;
    const characters = new Map<string, CharacterSprites>();
    const places = new Map<string, Sprite>();
    const ready = (key: string) => {
      const state = pictures[key];
      return state?.status === "ready" ? state.picture.sprite : undefined;
    };
    for (const character of story.characters) {
      const idle = ready(pictureKey.character(character.id));
      if (!idle) continue;
      const talk = mouthOff.has(character.id) ? undefined : ready(pictureKey.talking(character.id));
      characters.set(character.id, { idle, talk });
    }
    for (const location of story.locations) {
      const sprite = ready(pictureKey.place(location.id));
      if (sprite) places.set(location.id, sprite);
    }
    return {
      characters,
      places,
      headingFont: fonts.heading,
      timeLine,
      mouthOpen: (line, lineLocal) => {
        const clip = readyClip(line);
        return clip ? isMouthOpen(clip, lineLocal) : null;
      },
    };
  }, [fonts, pictures, mouthOff, story.characters, story.locations, timeLine, readyClip]);

  const draw = useMemo<DrawFunction | null>(
    () => (assets ? (ctx, time, options) => drawStoryFrame(ctx, story, time, assets, options) : null),
    [story, assets],
  );
  const describe = useCallback(
    (time: number) => describeStoryMoment(story, time, timeLine),
    [story, timeLine],
  );
  const startOfScene = useCallback(
    (index: number) => storySceneStart(story, index, timeLine),
    [story, timeLine],
  );

  /** Any edit, new picture or new voice makes an already recorded video out of date. */
  const changeStory = useCallback(
    (update: (current: Story) => Story) => {
      onStoryChange(update);
      invalidate();
    },
    [onStoryChange, invalidate],
  );

  /* ---------------- Pictures ---------------- */

  const setPicture = useCallback(
    (key: string, state: PictureState | null) => {
      if (!aliveRef.current) return;
      setPictures((current) => {
        const next = { ...current };
        if (state) next[key] = state;
        else delete next[key];
        return next;
      });
      invalidate();
    },
    [invalidate],
  );

  const pictureOptions = useCallback(
    (key: string) => ({
      apiKey: live.current.apiKey || undefined,
      shouldStop: () => !aliveRef.current || stopPicturesRef.current,
      onWaiting: (seconds: number) =>
        setPicture(key, { status: "drawing", note: `Waiting ${seconds}s for a free slot…` }),
    }),
    [setPicture],
  );

  const drawCharacter = useCallback(
    async (characterId: string) => {
      const current = live.current.story;
      const character = current.characters.find((c) => c.id === characterId);
      if (!character) return;
      const key = pictureKey.character(characterId);
      const talkKey = pictureKey.talking(characterId);
      const source = pictureSource.character(current, character);
      const request = {
        look: character.look,
        artStyle: current.artStyle,
        aspectRatio: current.aspectRatio,
      };

      setPicture(talkKey, null);
      setPicture(key, { status: "drawing" });
      let dataUrl: string;
      try {
        dataUrl = await requestPicture({ kind: "character", ...request }, pictureOptions(key));
        const sprite = await loadSprite(dataUrl, true);
        setPicture(key, { status: "ready", picture: { dataUrl, sprite, source } });
      } catch (err) {
        setPicture(key, { status: "failed", error: toErrorInfo(err) });
        return;
      }

      // The talking pose is a bonus: if it fails, the character still works.
      setPicture(talkKey, { status: "drawing" });
      try {
        const reference = await referencePng(dataUrl);
        const talkUrl = await requestPicture(
          { kind: "talking", ...request, reference },
          pictureOptions(talkKey),
        );
        const sprite = await loadSprite(talkUrl, true);
        setPicture(talkKey, { status: "ready", picture: { dataUrl: talkUrl, sprite, source } });
      } catch (err) {
        setPicture(talkKey, { status: "failed", error: toErrorInfo(err) });
      }
    },
    [pictureOptions, setPicture],
  );

  const drawPlace = useCallback(
    async (locationId: string) => {
      const current = live.current.story;
      const location = current.locations.find((l) => l.id === locationId);
      if (!location) return;
      const key = pictureKey.place(locationId);
      const source = pictureSource.place(current, location);

      setPicture(key, { status: "drawing" });
      try {
        const dataUrl = await requestPicture(
          {
            kind: "background",
            look: location.look,
            artStyle: current.artStyle,
            aspectRatio: current.aspectRatio,
          },
          pictureOptions(key),
        );
        const sprite = await loadSprite(dataUrl, false);
        setPicture(key, { status: "ready", picture: { dataUrl, sprite, source } });
      } catch (err) {
        setPicture(key, { status: "failed", error: toErrorInfo(err) });
      }
    },
    [pictureOptions, setPicture],
  );

  /** Draws everything that is missing, failed or out of date, two at a time. */
  const drawMissing = async () => {
    const { story: current, pictures: drawn } = live.current;
    const jobs: Array<() => Promise<void>> = [];
    for (const character of current.characters) {
      const state = drawn[pictureKey.character(character.id)];
      if (needsDrawing(state, pictureSource.character(current, character))) {
        jobs.push(() => drawCharacter(character.id));
      }
    }
    for (const location of current.locations) {
      const state = drawn[pictureKey.place(location.id)];
      if (needsDrawing(state, pictureSource.place(current, location))) {
        jobs.push(() => drawPlace(location.id));
      }
    }
    if (jobs.length === 0) return;

    stopPicturesRef.current = false;
    setPictureBatch({ done: 0, total: jobs.length });
    await runJobs(
      jobs,
      2,
      () => stopPicturesRef.current || !aliveRef.current,
      (done) => aliveRef.current && setPictureBatch({ done, total: jobs.length }),
    );
    if (aliveRef.current) setPictureBatch(null);
  };

  /* ---------------- Voices ---------------- */

  const setClip = useCallback(
    (key: string, state: ClipState) => {
      if (!aliveRef.current) return;
      setClips((current) => ({ ...current, [key]: state }));
      invalidate();
    },
    [invalidate],
  );

  /** Records one line (unless it already has a clip) and returns the clip, or null if it failed. */
  const recordLine = useCallback(
    async (current: Story, line: StoryLine): Promise<Clip | null> => {
      const key = clipKey(current, line);
      const existing = live.current.clips[key];
      if (existing?.status === "ready") return existing.clip;
      const audio = getAudio();
      const { voice, style } = lineVoice(current, line);
      setClip(key, { status: "recording" });
      try {
        const dataUrl = await requestSpeech(
          { text: line.text.trim(), voice, ...(style ? { style } : {}) },
          {
            apiKey: live.current.apiKey || undefined,
            shouldStop: () => !aliveRef.current || stopVoicesRef.current,
          },
        );
        const clip = await audio.decode(dataUrl);
        setClip(key, { status: "ready", clip });
        return clip;
      } catch (err) {
        setClip(key, { status: "failed", error: toErrorInfo(err) });
        return null;
      }
    },
    [getAudio, setClip],
  );

  /** Records every line that has no voice yet, three at a time. */
  const recordMissing = async () => {
    getAudio(); // created inside the click, as browsers require
    const { story: current, clips: recorded } = live.current;
    const wanted = new Set(clipKeysNeeded(current).filter((key) => recorded[key]?.status !== "ready"));
    const jobs: Array<() => Promise<void>> = [];
    for (const scene of current.scenes) {
      for (const line of scene.lines) {
        const key = clipKey(current, line);
        if (!line.text.trim() || !wanted.delete(key)) continue;
        jobs.push(async () => void (await recordLine(current, line)));
      }
    }
    if (jobs.length === 0) return;

    setVoicesOn(true);
    stopVoicesRef.current = false;
    setVoiceBatch({ done: 0, total: jobs.length });
    await runJobs(
      jobs,
      3,
      () => stopVoicesRef.current || !aliveRef.current,
      (done) => aliveRef.current && setVoiceBatch({ done, total: jobs.length }),
    );
    if (aliveRef.current) setVoiceBatch(null);
  };

  /** Plays one of the speaker's own lines, so the user can judge the voice. */
  const listen = async (speaker: string) => {
    const audio = getAudio();
    playerRef.current?.pause();
    const current = live.current.story;
    const name = current.characters.find((c) => c.id === speaker)?.name || "your character";
    const line: StoryLine =
      current.scenes.flatMap((scene) => scene.lines).find((l) => l.speaker === speaker && l.text.trim()) ??
      {
        speaker,
        text: speaker === NARRATOR ? "Here is a story about a family like yours." : `Hello! I am ${name}.`,
      };
    setListeningTo(speaker);
    const clip = await recordLine(current, line);
    if (!aliveRef.current) return;
    setListeningTo(null);
    if (clip) audio.preview(clip);
  };

  const picturesWaiting =
    story.characters.some((character) =>
      needsDrawing(pictures[pictureKey.character(character.id)], pictureSource.character(story, character)),
    ) ||
    story.locations.some((location) =>
      needsDrawing(pictures[pictureKey.place(location.id)], pictureSource.place(story, location)),
    );

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold sm:text-4xl">
        Your cartoon story
      </h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        Draw the pictures and record the voices, press play to watch, then edit, record and
        download.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Player
            ref={playerRef}
            width={dims.width}
            height={dims.height}
            duration={duration}
            draw={draw}
            describe={describe}
            sceneStart={startOfScene}
            transport={transport}
            locked={isRecording}
            onEnded={recording.handleEnded}
            onSceneChange={setActiveIndex}
            onProgress={recording.handleProgress}
          />
          <ExportPanel
            format={recording.format}
            state={recording.state}
            duration={duration}
            fileBase={fileBase}
            scriptLabel="Story (.json)"
            notice={
              picturesWaiting
                ? "Some pictures are not drawn yet. Simple stand-ins will appear in the video until they are."
                : undefined
            }
            holdReason={
              pictureBatch || voiceBatch
                ? "Please wait until the pictures and voices have finished."
                : undefined
            }
            onRecord={recording.start}
            onCancel={recording.cancel}
            onDownloadStoryboard={() =>
              downloadText(`${fileBase}.story.json`, JSON.stringify(story, null, 2), "application/json")
            }
            onDownloadPrompt={() =>
              downloadText(`${fileBase}.prompt.txt`, assemblePrompt(prompt), "text/plain")
            }
          />
        </div>

        <div className="min-w-0 space-y-6">
          <VideoDetails
            title={story.title}
            aspectRatio={story.aspectRatio}
            disabled={isRecording}
            onTitleChange={(title) => changeStory((current) => ({ ...current, title }))}
            onAspectRatioChange={(aspectRatio) =>
              changeStory((current) => ({ ...current, aspectRatio }))
            }
          />

          <StoryPictures
            story={story}
            pictures={pictures}
            mouthOff={mouthOff}
            disabled={isRecording}
            batch={pictureBatch}
            onStoryChange={changeStory}
            onDrawCharacter={drawCharacter}
            onDrawPlace={drawPlace}
            onDrawMissing={drawMissing}
            onStop={() => {
              stopPicturesRef.current = true;
            }}
            onToggleMouth={(characterId) => {
              setMouthOff((current) => {
                const next = new Set(current);
                if (next.has(characterId)) next.delete(characterId);
                else next.add(characterId);
                return next;
              });
              invalidate();
            }}
            onUseOwnKey={props.onUseOwnKey}
          />

          <StoryVoices
            story={story}
            clips={clips}
            voicesOn={voicesOn}
            disabled={isRecording}
            batch={voiceBatch}
            listeningTo={listeningTo}
            onStoryChange={changeStory}
            onRecordMissing={recordMissing}
            onStop={() => {
              stopVoicesRef.current = true;
            }}
            onToggleVoices={() => {
              playerRef.current?.pause();
              setVoicesOn((on) => !on);
              invalidate();
            }}
            onListen={listen}
            onUseOwnKey={props.onUseOwnKey}
          />

          <StoryScenes
            story={story}
            activeIndex={activeIndex}
            disabled={isRecording}
            onChange={changeStory}
            onSelect={(index) => playerRef.current?.seekToScene(index)}
          />

          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            <Button disabled={isRecording} onClick={props.onBackToPrompt}>
              Back to prompt
            </Button>
            <Button variant="ghost" disabled={isRecording} onClick={props.onStartOver}>
              Start a new story
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
