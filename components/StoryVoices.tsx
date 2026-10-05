"use client";

import { useId } from "react";
import type { ErrorInfo } from "@/lib/errors";
import {
  NARRATOR,
  STORY_LIMITS,
  VOICES,
  clipKey,
  type Story,
  type StoryCharacter,
  type VoiceId,
} from "@/lib/story";
import type { Clip } from "@/lib/storyAudio";
import { ErrorNotice } from "./ErrorNotice";
import { Button, PlayIcon, SparkIcon, inputClass } from "./ui";

export type ClipState =
  | { status: "recording" }
  | { status: "ready"; clip: Clip }
  | { status: "failed"; error: ErrorInfo };

export type ClipMap = Record<string, ClipState>;

/** The distinct clips a story needs: one per line, shared by identical lines. */
export function clipKeysNeeded(story: Story): string[] {
  const keys = new Set<string>();
  for (const scene of story.scenes) {
    for (const line of scene.lines) {
      if (line.text.trim()) keys.add(clipKey(story, line));
    }
  }
  return [...keys];
}

type Props = {
  story: Story;
  clips: ClipMap;
  /** Whether voices play (and are recorded) with the video. */
  voicesOn: boolean;
  /** True while the video is being recorded. */
  disabled: boolean;
  /** Progress of "record the voices", or null when it is not running. */
  batch: { done: number; total: number } | null;
  /** The speaker whose "Listen" sample is being prepared, if any. */
  listeningTo: string | null;
  onStoryChange: (update: (current: Story) => Story) => void;
  onRecordMissing: () => void;
  onStop: () => void;
  onToggleVoices: () => void;
  onListen: (speaker: string) => void;
  onUseOwnKey: () => void;
};

export function StoryVoices(props: Props) {
  const { story, clips, batch, disabled, onStoryChange } = props;
  const id = useId();

  const needed = clipKeysNeeded(story);
  const ready = needed.filter((key) => clips[key]?.status === "ready").length;
  const waiting = needed.filter((key) => clips[key]?.status !== "ready" && clips[key]?.status !== "recording").length;
  const firstFailure = needed
    .map((key) => clips[key])
    .find((state): state is Extract<ClipState, { status: "failed" }> => state?.status === "failed");

  const updateCharacter = (characterId: string, patch: Partial<StoryCharacter>) =>
    onStoryChange((current) => ({
      ...current,
      characters: current.characters.map((c) => (c.id === characterId ? { ...c, ...patch } : c)),
    }));

  return (
    <section aria-labelledby={`${id}-title`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold">
          Voices
        </h2>
        <p className="text-muted">
          {ready} of {needed.length} lines recorded
        </p>
      </div>
      <p className="mt-0.5 text-muted">
        An AI voice speaks each line, and the speaker&apos;s mouth follows the sound. The voices
        are computer-generated, not real people: please say so wherever you share the video. Each
        line is charged to the OpenAI account in use.
      </p>

      <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Voices for this story</legend>

        {batch ? (
          <div className="rounded-2xl bg-brand-soft p-3">
            <label htmlFor={`${id}-progress`} className="font-semibold">
              Recording… {batch.done} of {batch.total} lines finished
            </label>
            <progress
              id={`${id}-progress`}
              value={batch.done}
              max={batch.total}
              className="mt-2 block h-3 w-full overflow-hidden rounded-full accent-brand"
            />
            <Button compact className="mt-2" onClick={props.onStop}>
              Stop after the current lines
            </Button>
          </div>
        ) : (
          waiting > 0 && (
            <Button variant="primary" onClick={props.onRecordMissing}>
              <SparkIcon />
              {ready === 0 ? "Record the voices" : "Record the remaining lines"} ({waiting})
            </Button>
          )
        )}
        <p aria-live="polite" className="sr-only">
          {batch ? `Recording voices: ${batch.done} of ${batch.total} lines finished.` : ""}
        </p>

        {!batch && firstFailure && (
          <ErrorNotice
            error={firstFailure.error}
            onRetry={props.onRecordMissing}
            onUseOwnKey={props.onUseOwnKey}
          />
        )}

        {ready > 0 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={props.voicesOn}
              onChange={props.onToggleVoices}
              className="size-5 accent-brand"
            />
            Play the voices in the video
          </label>
        )}
        {ready > 0 && ready < needed.length && props.voicesOn && !batch && (
          <p className="rounded-xl bg-sun-soft px-3 py-2">
            Some lines have no voice yet. They will be silent, with captions only, until you
            record them.
          </p>
        )}

        <ul className="space-y-2">
          <VoiceRow
            name="Narrator"
            voice={story.narratorVoice}
            busy={props.listeningTo === NARRATOR}
            onVoiceChange={(voice) => onStoryChange((current) => ({ ...current, narratorVoice: voice }))}
            onListen={() => props.onListen(NARRATOR)}
          />
          {story.characters.map((character) => (
            <VoiceRow
              key={character.id}
              name={character.name || "Character"}
              voice={character.voice}
              style={character.voiceStyle}
              busy={props.listeningTo === character.id}
              onVoiceChange={(voice) => updateCharacter(character.id, { voice })}
              onStyleChange={(voiceStyle) => updateCharacter(character.id, { voiceStyle })}
              onListen={() => props.onListen(character.id)}
            />
          ))}
        </ul>
      </fieldset>
    </section>
  );
}

type RowProps = {
  name: string;
  voice: VoiceId;
  /** Characters have a manner of speaking; the narrator does not. */
  style?: string;
  busy: boolean;
  onVoiceChange: (voice: VoiceId) => void;
  onStyleChange?: (style: string) => void;
  onListen: () => void;
};

function VoiceRow(props: RowProps) {
  const id = useId();
  return (
    <li className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <p className="font-display text-lg font-bold">{props.name}</p>
      <div className="mt-1 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-voice`} className="mb-1 block font-semibold">
            Voice
          </label>
          <select
            id={`${id}-voice`}
            value={props.voice}
            onChange={(event) => props.onVoiceChange(event.target.value as VoiceId)}
            className={`${inputClass} min-h-11`}
          >
            {VOICES.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.id[0].toUpperCase() + voice.id.slice(1)} ({voice.hint})
              </option>
            ))}
          </select>
        </div>
        <Button compact loading={props.busy} onClick={props.onListen} aria-label={`Listen to ${props.name}`}>
          {!props.busy && <PlayIcon />}
          Listen
        </Button>
      </div>
      {props.onStyleChange && (
        <>
          <label htmlFor={`${id}-style`} className="mb-1 mt-3 block font-semibold">
            How they sound
          </label>
          <input
            id={`${id}-style`}
            type="text"
            value={props.style ?? ""}
            maxLength={STORY_LIMITS.voiceStyle}
            placeholder="e.g. a cheerful six-year-old boy, bright and quick"
            onChange={(event) => props.onStyleChange?.(event.target.value)}
            className={inputClass}
          />
        </>
      )}
    </li>
  );
}
