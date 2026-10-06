"use client";

import { useId } from "react";
import type { ErrorInfo } from "@/lib/errors";
import {
  NARRATOR,
  STORY_LIMITS,
  VOICE_AGES,
  VOICE_AGE_SETTINGS,
  clipKey,
  type Story,
  type StoryCharacter,
  type VoiceAge,
} from "@/lib/story";
import type { Clip } from "@/lib/storyAudio";
import { voiceMenu, type VoiceList, type VoiceOption } from "@/lib/voices";
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
  /** The voices that can be chosen, from the voice service the server uses. */
  voiceList: VoiceList;
  voiceListState: "loading" | "ready" | "failed";
  onReloadVoices: () => void;
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
  const { provider, voices } = props.voiceList;
  const hasRealAges = voices.some((voice) => voice.age !== "adult");

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
        line is charged to the {provider === "speechgen" ? "SpeechGen" : "OpenAI"} account in use.
      </p>
      <p className="mt-1 text-muted">
        {hasRealAges
          ? "Voices listed under children or older voices really are that age. For any other voice, set the age: its pitch is then raised or lowered to match. Press Listen to check it."
          : "All the voices are adults. For a child or an older person, set the age: the voice then acts that age and its pitch is raised or lowered to match. Press Listen to check it."}
      </p>
      {props.voiceListState === "failed" && (
        <div className="mt-2 rounded-xl bg-sun-soft px-3 py-2" role="alert">
          <p>The list of voices could not be loaded, so voices can&apos;t be recorded yet.</p>
          <Button compact className="mt-2" onClick={props.onReloadVoices}>
            Try again
          </Button>
        </div>
      )}

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
            <Button
              variant="primary"
              onClick={props.onRecordMissing}
              disabled={props.voiceListState !== "ready"}
            >
              <SparkIcon />
              {props.voiceListState === "loading"
                ? "Getting the voices ready…"
                : `${ready === 0 ? "Record the voices" : "Record the remaining lines"} (${waiting})`}
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
            voices={voices}
            canListen={props.voiceListState === "ready"}
            busy={props.listeningTo === NARRATOR}
            onVoiceChange={(voice) => onStoryChange((current) => ({ ...current, narratorVoice: voice }))}
            onListen={() => props.onListen(NARRATOR)}
          />
          {story.characters.map((character) => (
            <VoiceRow
              key={character.id}
              name={character.name || "Character"}
              voice={character.voice}
              voices={voices}
              canListen={props.voiceListState === "ready"}
              age={character.voiceAge}
              onAgeChange={(voiceAge) => updateCharacter(character.id, { voiceAge })}
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
  voice: string;
  voices: ReadonlyArray<VoiceOption>;
  /** False until the list of voices has arrived. */
  canListen: boolean;
  /** Characters have an age and a manner of speaking; the narrator does not. */
  age?: VoiceAge;
  onAgeChange?: (age: VoiceAge) => void;
  style?: string;
  busy: boolean;
  onVoiceChange: (voice: string) => void;
  onStyleChange?: (style: string) => void;
  onListen: () => void;
};

function VoiceRow(props: RowProps) {
  const id = useId();
  const listed = props.voices.some((voice) => voice.id === props.voice);
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
            onChange={(event) => props.onVoiceChange(event.target.value)}
            className={`${inputClass} min-h-11`}
          >
            {/* Shown only until the speaker has been given a voice from this list. */}
            {!listed && <option value={props.voice}>{props.voice}</option>}
            {voiceMenu(props.voices).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Button
          compact
          loading={props.busy}
          disabled={!props.canListen}
          onClick={props.onListen}
          aria-label={`Listen to ${props.name}`}
        >
          {!props.busy && <PlayIcon />}
          Listen
        </Button>
      </div>
      {props.onAgeChange && (
        <>
          <label htmlFor={`${id}-age`} className="mb-1 mt-3 block font-semibold">
            Age
          </label>
          <select
            id={`${id}-age`}
            value={props.age ?? "adult"}
            onChange={(event) => props.onAgeChange?.(event.target.value as VoiceAge)}
            className={`${inputClass} min-h-11`}
          >
            {VOICE_AGES.map((age) => (
              <option key={age} value={age}>
                {VOICE_AGE_SETTINGS[age].label}
              </option>
            ))}
          </select>
        </>
      )}
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
            placeholder="e.g. cheerful, quick and proud"
            onChange={(event) => props.onStyleChange?.(event.target.value)}
            className={inputClass}
          />
        </>
      )}
    </li>
  );
}
