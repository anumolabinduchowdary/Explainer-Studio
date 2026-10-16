"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { downloadText, slugify } from "@/lib/download";
import type { ExportJob } from "@/lib/exportVideo";
import { useEndCardImage, withEndCard } from "@/lib/endCard";
import { HEALTH_DISCLAIMER } from "@/lib/config";
import { assemblePlan, type StoryPlan } from "@/lib/plan";
import { suggestCaption } from "@/lib/share";
import { dimensionsFor } from "@/lib/renderer";
import {
  NARRATOR,
  characterName,
  clipKey,
  estimateLine,
  lineStarts,
  lineVoice,
  pictureKey,
  storyDuration,
  SCENE_LEAD_SEC,
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
  requestVoices,
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
import { OPENAI_VOICE_LIST, ageRate, castVoices, type VoiceList } from "@/lib/voices";
import { thumbnailFrom } from "@/lib/thumbnail";
import { checkDrawing, checkFacts, textsKey, type FactsState } from "@/lib/checks";
import type { PictureCheck } from "@/lib/quality";
import { TranslateResponseSchema, storyTexts, withStoryTexts, type Texts } from "@/lib/translate";
import type { YouTubeInfo } from "@/lib/youtube";
import { useCanvasFonts } from "@/lib/useRenderAssets";
import { ExportPanel } from "./ExportPanel";
import { LanguagePanel } from "./LanguagePanel";
import { QualityPanel, type PictureSummary, type VoiceSummary } from "./QualityPanel";
import { Player, type DrawFunction, type PlayerHandle, type Transport } from "./Player";
import { StoryPictures, cardScenes, characterNeedsDrawing, needsDrawing, pictureSource } from "./StoryPictures";
import { StoryScenes } from "./StoryScenes";
import { StoryVoices, clipKeysNeeded, type ClipMap, type ClipState } from "./StoryVoices";
import { VideoDetails } from "./VideoDetails";
import { Button } from "./ui";

/**
 * A short breath after each spoken line. An answer follows a question a little
 * faster, as it does in real conversation, so the exchange does not sound
 * like turns being read out.
 */
const pauseAfter = (line: StoryLine, calm = false) =>
  (line.text.trim().endsWith("?") ? 0.22 : 0.35) + (calm ? 0.5 : 0);

type Batch = { done: number; total: number } | null;

type Props = {
  /** The plan the story was written from, offered as a download. */
  plan: StoryPlan;
  /** The automatic fact check made when the story was written. */
  initialFacts: FactsState;
  story: Story;
  /** False while another step or section is showing (this one stays mounted to keep its pictures). */
  active: boolean;
  apiKey: string;
  /** Whether finished videos can be posted straight to YouTube. */
  youtubeEnabled: boolean;
  onStoryChange: (update: (current: Story) => Story) => void;
  onBackToPlan: () => void;
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
  const { plan, story, apiKey, onStoryChange } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const audioRef = useRef<StoryAudio | null>(null);
  const hasVoicesRef = useRef(false);

  /** The audio player is created on first use, which must be inside a click (browser rule). */
  const getAudio = useCallback(() => (audioRef.current ??= new StoryAudio()), []);
  // What to build when the user asks for the file; filled in below, once the video is known.
  const exportJob = useRef<() => Promise<ExportJob | null>>(async () => null);
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
    useCallback(() => exportJob.current(), []),
  );
  const { isRecording, invalidate, cancel } = recording;

  // Pictures and voice clips live in memory only: nothing is uploaded or saved anywhere.
  const [pictures, setPictures] = useState<PictureMap>({});
  // The result of comparing each standing pose and background with its description.
  const [pictureChecks, setPictureChecks] = useState<
    Record<string, { source: string; matches: boolean | null; problems: string[]; redraws: number }>
  >({});
  const [mouthOff, setMouthOff] = useState<ReadonlySet<string>>(() => new Set());
  // Hand gestures: an extra pose per character. On for the story, with a switch per character.
  const [gesturesOn, setGesturesOn] = useState(true);
  const [gestureOff, setGestureOff] = useState<ReadonlySet<string>>(() => new Set());
  const [pictureBatch, setPictureBatch] = useState<Batch>(null);
  const [clips, setClips] = useState<ClipMap>({});
  const [voicesOn, setVoicesOn] = useState(true);
  const [voiceBatch, setVoiceBatch] = useState<Batch>(null);
  const [listeningTo, setListeningTo] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Which voices exist depends on the voice service the server uses, so the list is asked for.
  const [voiceList, setVoiceList] = useState<VoiceList>(OPENAI_VOICE_LIST);
  const [voiceListState, setVoiceListState] = useState<"loading" | "ready" | "failed">("loading");

  // Drawing and recording take a while, so the jobs read the latest values through refs.
  const live = useRef({ story, apiKey, pictures, clips, gesturesOn, voiceList, language: plan.language, pictureChecks });
  const aliveRef = useRef(true);
  const stopPicturesRef = useRef(false);
  const stopVoicesRef = useRef(false);
  useEffect(() => {
    live.current = { ...live.current, story, apiKey, pictures, clips, gesturesOn, voiceList, pictureChecks };
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
        duration: clip.duration + pauseAfter(line, story.calm === true),
        speechStart: clip.speechStart,
        speechEnd: clip.speechEnd,
      };
    },
    [readyClip, story.calm],
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
      const mouth = !mouthOff.has(character.id);
      const talk = mouth ? ready(pictureKey.talking(character.id)) : undefined;
      // Each gesture pose that has been drawn, with its mouth-open twin when there is one.
      const gestures: NonNullable<CharacterSprites["gestures"]> = [];
      if (gesturesOn && !gestureOff.has(character.id)) {
        for (const [still, talking] of [
          [pictureKey.gesture(character.id), pictureKey.gestureTalking(character.id)],
          [pictureKey.explain(character.id), pictureKey.explainTalking(character.id)],
        ]) {
          const pose = ready(still);
          if (pose) gestures.push({ idle: pose, talk: mouth ? ready(talking) : undefined });
        }
      }
      characters.set(character.id, { idle, talk, gestures });
    }
    for (const location of story.locations) {
      const sprite = ready(pictureKey.place(location.id));
      if (sprite) places.set(location.id, sprite);
    }
    const cards = new Map<string, Sprite>();
    for (const scene of story.scenes) {
      const sprite = scene.card ? ready(pictureKey.card(scene.id)) : undefined;
      if (sprite) cards.set(scene.id, sprite);
    }
    return {
      characters,
      places,
      cards,
      headingFont: fonts.heading,
      timeLine,
      mouthOpen: (line, lineLocal) => {
        const clip = readyClip(line);
        return clip ? isMouthOpen(clip, lineLocal) : null;
      },
    };
  }, [
    fonts,
    pictures,
    mouthOff,
    gesturesOn,
    gestureOff,
    story.characters,
    story.locations,
    story.scenes,
    timeLine,
    readyClip,
  ]);

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

  // Videos about special parenting close with the Instagram QR card; it can be switched either way.
  const endCardImage = useEndCardImage();
  const [endCardOn, setEndCardOn] = useState(plan.specialParenting);
  const video = useMemo(
    () =>
      withEndCard(
        { dims: { width: dims.width, height: dims.height }, duration, draw, describe },
        endCardOn ? endCardImage : null,
      ),
    [dims.width, dims.height, duration, draw, describe, endCardOn, endCardImage],
  );

  useEffect(() => {
    exportJob.current = async () => {
      if (!video.draw) return null;
      return {
        width: dims.width,
        height: dims.height,
        duration: video.duration,
        draw: video.draw,
        // All the voice clips, placed at their moments, as one sound track.
        sound: hasVoices ? await getAudio().mixdown(schedule, video.duration) : null,
      };
    };
  });

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

  /**
   * Compares a fresh drawing with its description, and redraws it with the
   * corrections (at most twice) until it matches. Resolves to the final
   * drawing's data URL. If the check cannot be made, the drawing is kept.
   */
  async function checkUntilRight(
    key: string,
    kind: "character" | "background" | "exercise",
    look: string,
    image: string,
    source: string,
    redraw: (fix: string) => Promise<string | null>,
  ): Promise<string> {
    let current = image;
    let redraws = 0;
    let check: PictureCheck | null = await checkDrawing(kind, look, current, live.current.apiKey);
    while (check && !check.matches && redraws < 2 && aliveRef.current) {
      redraws += 1;
      const again = await redraw(check.problems.join(" "));
      if (!again) break;
      current = again;
      check = await checkDrawing(kind, look, current, live.current.apiKey);
    }
    if (aliveRef.current) {
      setPictureChecks((all) => ({
        ...all,
        [key]: { source, matches: check ? check.matches : null, problems: check?.problems ?? [], redraws },
      }));
    }
    return current;
  }

  /**
   * Draws a character's pictures as a chain: standing, then the same with the
   * mouth open, then (with gestures on) a hand raised and both hands open,
   * each also with the mouth open. Each is redrawn from the one it is based
   * on, so they match.
   * With `onlyMissing`, pictures that are already up to date are kept.
   */
  const drawCharacter = useCallback(
    async (characterId: string, onlyMissing = false) => {
      const current = live.current.story;
      const character = current.characters.find((c) => c.id === characterId);
      if (!character) return;
      const keys = {
        idle: pictureKey.character(characterId),
        talk: pictureKey.talking(characterId),
        gesture: pictureKey.gesture(characterId),
        gestureTalk: pictureKey.gestureTalking(characterId),
        explain: pictureKey.explain(characterId),
        explainTalk: pictureKey.explainTalking(characterId),
      };
      const source = pictureSource.character(current, character);
      const request = {
        look: character.look,
        artStyle: current.artStyle,
        aspectRatio: current.aspectRatio,
      };
      const before = live.current.pictures;

      /** Draws one picture of the chain. Resolves to its data URL, or null if it failed. */
      const step = async (
        key: string,
        kind: "character" | "talking" | "gesture" | "explain",
        from?: string,
        fix?: string,
      ): Promise<string | null> => {
        const existing = before[key];
        if (!fix && onlyMissing && existing?.status === "ready" && existing.picture.source === source) {
          return existing.picture.dataUrl;
        }
        setPicture(key, { status: "drawing", ...(fix ? { note: "Drawing again to fix a mistake…" } : {}) });
        try {
          const reference = from ? await referencePng(from) : undefined;
          const dataUrl = await requestPicture(
            { kind, ...request, ...(reference ? { reference } : {}), ...(fix ? { fix } : {}) },
            pictureOptions(key),
          );
          const sprite = await loadSprite(dataUrl, true);
          setPicture(key, { status: "ready", picture: { dataUrl, sprite, source } });
          return dataUrl;
        } catch (err) {
          setPicture(key, { status: "failed", error: toErrorInfo(err) });
          return null;
        }
      };

      if (!onlyMissing) {
        for (const key of [keys.talk, keys.gesture, keys.gestureTalk, keys.explain, keys.explainTalk]) {
          setPicture(key, null);
        }
      }
      let idle = await step(keys.idle, "character");
      if (!idle) return;
      // The standing pose is compared with its description and redrawn (at most twice) if it is wrong.
      // The other poses are drawn from it, so they inherit the fixes.
      const known = live.current.pictureChecks[keys.idle];
      if (!known || known.source !== source || !onlyMissing) {
        const checked = await checkUntilRight(keys.idle, "character", character.look, idle, source, (fix) =>
          step(keys.idle, "character", undefined, fix),
        );
        if (checked) idle = checked;
      }
      // Everything after the standing pose is a bonus: if it fails, the character still works.
      await step(keys.talk, "talking", idle);
      if (!live.current.gesturesOn) return;
      const gesture = await step(keys.gesture, "gesture", idle);
      if (gesture) await step(keys.gestureTalk, "talking", gesture);
      const explain = await step(keys.explain, "explain", idle);
      if (explain) await step(keys.explainTalk, "talking", explain);
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

      const draw = async (fix?: string): Promise<string | null> => {
        setPicture(key, { status: "drawing", ...(fix ? { note: "Drawing again to fix a mistake…" } : {}) });
        try {
          const dataUrl = await requestPicture(
            {
              kind: "background",
              look: location.look,
              artStyle: current.artStyle,
              aspectRatio: current.aspectRatio,
              ...(fix ? { fix } : {}),
            },
            pictureOptions(key),
          );
          const sprite = await loadSprite(dataUrl, false);
          setPicture(key, { status: "ready", picture: { dataUrl, sprite, source } });
          return dataUrl;
        } catch (err) {
          setPicture(key, { status: "failed", error: toErrorInfo(err) });
          return null;
        }
      };
      const first = await draw();
      if (first) await checkUntilRight(key, "background", location.look, first, source, draw);
    },
    [pictureOptions, setPicture],
  );

  /** Draws (and checks) the picture on a scene's exercise card. */
  const drawCard = useCallback(
    async (sceneId: string) => {
      const current = live.current.story;
      const scene = current.scenes.find((item) => item.id === sceneId);
      if (!scene?.card) return;
      const key = pictureKey.card(sceneId);
      const source = pictureSource.card(current, scene);
      const look = scene.card.look;
      const draw = async (fix?: string): Promise<string | null> => {
        setPicture(key, { status: "drawing", ...(fix ? { note: "Drawing again to fix a mistake…" } : {}) });
        try {
          const dataUrl = await requestPicture(
            { kind: "exercise", look, artStyle: current.artStyle, aspectRatio: current.aspectRatio, ...(fix ? { fix } : {}) },
            pictureOptions(key),
          );
          const sprite = await loadSprite(dataUrl, false);
          setPicture(key, { status: "ready", picture: { dataUrl, sprite, source } });
          return dataUrl;
        } catch (err) {
          setPicture(key, { status: "failed", error: toErrorInfo(err) });
          return null;
        }
      };
      const first = await draw();
      if (first) await checkUntilRight(key, "exercise", look, first, source, draw);
    },
    [pictureOptions, setPicture],
  );

  /** Draws everything that is missing, failed or out of date, two at a time. */
  const drawMissing = async () => {
    const { story: current, pictures: drawn, gesturesOn: withGestures } = live.current;
    const jobs: Array<() => Promise<void>> = [];
    for (const character of current.characters) {
      if (characterNeedsDrawing(current, character, drawn, withGestures)) {
        jobs.push(() => drawCharacter(character.id, true));
      }
    }
    for (const location of current.locations) {
      const state = drawn[pictureKey.place(location.id)];
      if (needsDrawing(state, pictureSource.place(current, location))) {
        jobs.push(() => drawPlace(location.id));
      }
    }
    for (const scene of cardScenes(current)) {
      if (needsDrawing(drawn[pictureKey.card(scene.id)], pictureSource.card(current, scene))) {
        jobs.push(() => drawCard(scene.id));
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

  /**
   * Fetches the voices for the story's language. A story is first cast with
   * OpenAI's voices; if the server speaks with another service, every speaker
   * is given one of that service's voices of the same gender and age.
   */
  // The language the lines are in: the plan's when the story arrives, then whichever version is showing.
  const [language, setLanguage] = useState(() => plan.language.trim() || "Original");
  useEffect(() => {
    live.current.language = language;
  });
  const [voiceAttempt, setVoiceAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    requestVoices(language).then(
      (list) => {
        if (cancelled) return;
        setVoiceList(list);
        setVoiceListState("ready");
        onStoryChange((current) => castVoices(current, list.voices));
      },
      () => {
        if (!cancelled) setVoiceListState("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [language, onStoryChange, voiceAttempt]);
  const loadVoices = () => {
    setVoiceListState("loading");
    setVoiceAttempt((attempt) => attempt + 1);
  };

  /* ---------------- Quality ---------------- */

  const [facts, setFacts] = useState<FactsState>(props.initialFacts);
  const currentTexts = useMemo(() => textsKey(storyTexts(story)), [story]);
  const factsOutOfDate = facts.status === "checked" && facts.texts !== currentTexts;

  /** Checks the words again (for example after edits) and applies any fixes. */
  const recheckFacts = async () => {
    setFacts({ status: "checking" });
    const current = live.current.story;
    try {
      const result = await checkFacts("story", language === "Original" ? "" : language, storyTexts(current), apiKey);
      if (!aliveRef.current) return;
      const fixed = withStoryTexts(current, result.texts);
      if (Object.keys(result.texts).length) changeStory((latest) => withStoryTexts(latest, result.texts));
      setFacts({ status: "checked", result, texts: textsKey(storyTexts(fixed)) });
    } catch (err) {
      if (aliveRef.current) setFacts({ status: "failed", message: toErrorInfo(err).message });
    }
  };

  const pictureSummary = useMemo<PictureSummary>(() => {
    const main = [
      ...story.characters.map((character) => ({
        key: pictureKey.character(character.id),
        name: character.name || "A character",
        source: pictureSource.character(story, character),
      })),
      ...story.locations.map((location) => ({
        key: pictureKey.place(location.id),
        name: location.name || "A place",
        source: pictureSource.place(story, location),
      })),
      ...cardScenes(story).map((scene) => ({
        key: pictureKey.card(scene.id),
        name: `Exercise "${scene.card?.title ?? ""}"`,
        source: pictureSource.card(story, scene),
      })),
    ];
    const drawn = main.filter((item) => {
      const state = pictures[item.key];
      return state?.status === "ready" && state.picture.source === item.source;
    });
    const checks = drawn
      .map((item) => ({ item, check: pictureChecks[item.key] }))
      .filter(({ check, item }) => check?.source === item.source);
    return {
      total: main.length,
      drawn: drawn.length,
      checked: checks.filter(({ check }) => check.matches !== null).length,
      redrawn: checks.filter(({ check }) => check.redraws > 0).length,
      problems: checks
        .filter(({ check }) => check.matches === false)
        .map(({ item, check }) => ({ name: item.name, problems: check.problems })),
    };
  }, [story, pictures, pictureChecks]);

  const voiceSummary = useMemo<VoiceSummary>(() => {
    const seen = new Set<string>();
    const unique = story.scenes
      .flatMap((scene) => scene.lines)
      .filter((line) => {
        const key = clipKey(story, line);
        if (!line.text.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const ready = unique
      .map((line) => ({ line, state: clips[clipKey(story, line)] }))
      .filter(
        (entry): entry is { line: StoryLine; state: Extract<ClipState, { status: "ready" }> } =>
          entry.state?.status === "ready",
      );
    return {
      total: unique.length,
      recorded: ready.length,
      checked: ready.filter(({ state }) => state.check && state.check.result !== "skipped").length,
      retried: ready.filter(({ state }) => state.check?.retried).length,
      unclear: ready
        .filter(({ state }) => state.check?.result === "unclear")
        .map(({ line }) => ({ who: characterName(story, line.speaker), text: line.text })),
    };
  }, [story, clips]);

  /* ---------------- Make my video, in one go ---------------- */

  const [making, setMaking] = useState<string | null>(null);
  /** Draws and checks the pictures, records and checks the voices, then builds the video file. */
  const makeVideo = async () => {
    getAudio(); // created inside the click, as browsers require
    setMaking("Drawing and checking the pictures…");
    await drawMissing();
    if (!aliveRef.current) return;
    if (stopPicturesRef.current) {
      setMaking(null);
      return;
    }
    setMaking("Recording and checking the voices…");
    await recordMissing();
    if (!aliveRef.current) return;
    if (stopVoicesRef.current) {
      setMaking(null);
      return;
    }
    setMaking("Creating the video file…");
    // Let the page catch up with the last picture and voice before the file is built from them.
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!aliveRef.current) return;
    setMaking(null);
    await recording.start();
  };

  /* ---------------- YouTube ---------------- */

  /**
   * The thumbnail: the scene with the most people in it, drawn wide (16:9) with
   * everyone in place and no caption, and the title written large across it.
   */
  const makeThumbnail = useCallback(async (): Promise<string | null> => {
    if (!assets || !fonts) return null;
    const wide: Story = { ...story, aspectRatio: "16:9" };
    const busiest = wide.scenes.reduce(
      (best, scene, index) => (scene.onStage.length > wide.scenes[best].onStage.length ? index : best),
      0,
    );
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Just before the first line, when everyone has arrived and nobody is speaking yet.
    const time = storySceneStart(wide, busiest, timeLine) + SCENE_LEAD_SEC * 0.95;
    drawStoryFrame(ctx, wide, time, assets, { settled: true });
    return thumbnailFrom(canvas, story.title, fonts.heading);
  }, [assets, fonts, story, timeLine]);

  const youtube = useMemo<YouTubeInfo | undefined>(
    () =>
      props.youtubeEnabled
        ? {
            kind: "story",
            title: story.title,
            script: story.scenes.flatMap((scene) => scene.lines.map((line) => line.text)).join("\n"),
            language: language === "Original" ? "" : language,
            health: story.scenes.some((scene) => scene.lines.some((line) => line.text.includes(HEALTH_DISCLAIMER))),
            aiVoices: hasVoices,
            sources: facts.status === "checked" ? facts.result.sources : [],
            follow: endCardOn,
            apiKey,
            makeThumbnail,
          }
        : undefined,
    [props.youtubeEnabled, story, language, hasVoices, apiKey, makeThumbnail, facts, endCardOn],
  );

  /* ---------------- Other languages ---------------- */

  // Each language's lines, so switching back keeps its words and its recorded voices.
  const [versions, setVersions] = useState<string[]>(() => [plan.language.trim() || "Original"]);
  const savedTexts = useRef(new Map<string, Texts>());
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<ErrorInfo | null>(null);

  const translateTo = async (target: string) => {
    const current = live.current.story;
    setTranslating(true);
    setTranslateError(null);
    try {
      const { texts } = await postJson(
        "/api/translate",
        { language: target, kind: "story", texts: storyTexts(current) },
        TranslateResponseSchema,
        { apiKey: live.current.apiKey || undefined, timeoutMs: 75_000 },
      );
      if (!aliveRef.current) return;
      savedTexts.current.set(language, storyTexts(live.current.story));
      savedTexts.current.set(target, texts);
      changeStory((latest) => withStoryTexts(latest, texts));
      // The voice list follows the language, so voices for it are offered (and given to speakers if needed).
      setVoiceListState("loading");
      setLanguage(target);
      setVersions((names) => (names.includes(target) ? names : [...names, target]));
    } catch (err) {
      if (aliveRef.current) setTranslateError(toErrorInfo(err));
    } finally {
      if (aliveRef.current) setTranslating(false);
    }
  };

  const switchTo = (name: string) => {
    const texts = savedTexts.current.get(name);
    if (!texts || name === language) return;
    savedTexts.current.set(language, storyTexts(live.current.story));
    playerRef.current?.pause();
    changeStory((latest) => withStoryTexts(latest, texts));
    setVoiceListState("loading");
    setLanguage(name);
  };

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
      const { voice, age, style, delivery } = lineVoice(current, line);
      setClip(key, { status: "recording" });
      try {
        const spoken = live.current.language === "Original" ? "" : live.current.language;
        const { audio: dataUrl, check } = await requestSpeech(
          {
            text: line.text.trim(),
            voice,
            age,
            ...(style ? { style } : {}),
            ...(delivery ? { delivery } : {}),
            ...(spoken ? { language: spoken } : {}),
          },
          {
            apiKey: live.current.apiKey || undefined,
            shouldStop: () => !aliveRef.current || stopVoicesRef.current,
          },
        );
        // A real child's or older person's voice is left as it is; an adult voice is pitched to the age.
        const option = live.current.voiceList.voices.find((item) => item.id === voice);
        const clip = await audio.decode(dataUrl, ageRate(age, option));
        setClip(key, { status: "ready", clip, ...(check ? { check } : {}) });
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

  // A missing gesture pose is only a missed extra; stand-ins appear only without the main pictures.
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
        Press Make my video to draw, record, check and create the video in one go, or do each part
        yourself below. Everything is checked automatically before it is ready to post.
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
            transport={transport}
            locked={isRecording}
            onEnded={recording.handleEnded}
            onSceneChange={setActiveIndex}
            onProgress={recording.handleProgress}
          />
          <div className="rounded-2xl border border-brand/30 bg-brand-soft p-4">
            <h2 className="font-display text-xl font-bold">Make my video</h2>
            <p className="mt-1">
              One press draws and checks every picture, records and checks every voice, and
              creates the video file, ready to post.
            </p>
            <Button
              variant="primary"
              className="mt-3 w-full sm:w-auto"
              loading={making !== null}
              disabled={isRecording || pictureBatch !== null || voiceBatch !== null}
              onClick={() => void makeVideo()}
            >
              {making ?? "Make my video"}
            </Button>
            <p aria-live="polite" className="sr-only">
              {making ?? ""}
            </p>
          </div>
          <ExportPanel
            format={recording.format}
            state={recording.state}
            duration={video.duration}
            fileBase={fileBase}
            scriptLabel="Story (.json)"
            live={recording.live}
            title={story.title}
            youtube={youtube}
            caption={suggestCaption({
              title: story.title,
              health: story.scenes.some((scene) =>
                scene.lines.some((line) => line.text.includes(HEALTH_DISCLAIMER)),
              ),
              aiVoices: hasVoices,
              follow: endCardOn,
            })}
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
            promptLabel="Plan (.txt)"
            onDownloadPrompt={() =>
              downloadText(`${fileBase}.plan.txt`, assemblePlan(plan), "text/plain")
            }
          />
        </div>

        <div className="min-w-0 space-y-6">
          <QualityPanel
            facts={facts}
            factsOutOfDate={factsOutOfDate}
            pictures={pictureSummary}
            voices={voiceSummary}
            onCheckFacts={() => void recheckFacts()}
          />

          <VideoDetails
            title={story.title}
            aspectRatio={story.aspectRatio}
            disabled={isRecording}
            endCard={endCardImage ? endCardOn : null}
            onEndCardChange={(on) => {
              setEndCardOn(on);
              invalidate();
            }}
            onTitleChange={(title) => changeStory((current) => ({ ...current, title }))}
            onAspectRatioChange={(aspectRatio) =>
              changeStory((current) => ({ ...current, aspectRatio }))
            }
          />

          <LanguagePanel
            current={language}
            versions={versions}
            busy={translating}
            error={translateError}
            disabled={isRecording || voiceBatch !== null}
            hasVoices
            onTranslate={translateTo}
            onSwitch={switchTo}
            onUseOwnKey={props.onUseOwnKey}
          />

          <StoryPictures
            story={story}
            pictures={pictures}
            mouthOff={mouthOff}
            gesturesOn={gesturesOn}
            gestureOff={gestureOff}
            onToggleGestures={() => {
              setGesturesOn((on) => !on);
              invalidate();
            }}
            onToggleGesture={(characterId) => {
              setGestureOff((current) => {
                const next = new Set(current);
                if (next.has(characterId)) next.delete(characterId);
                else next.add(characterId);
                return next;
              });
              invalidate();
            }}
            disabled={isRecording}
            batch={pictureBatch}
            onStoryChange={changeStory}
            onDrawCharacter={drawCharacter}
            onDrawPlace={drawPlace}
            onDrawCard={drawCard}
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
            voiceList={voiceList}
            voiceListState={voiceListState}
            language={language}
            onReloadVoices={loadVoices}
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
            <Button disabled={isRecording} onClick={props.onBackToPlan}>
              Back to plan
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
