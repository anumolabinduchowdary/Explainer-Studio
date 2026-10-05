"use client";

import { useId, useState } from "react";
import {
  NARRATOR,
  STORY_LIMITS,
  sceneDuration,
  type Story,
  type StoryLine,
  type StoryScene,
} from "@/lib/story";
import { Button, ChevronIcon, DownIcon, IconButton, TrashIcon, UpIcon, inputClass } from "./ui";

type Props = {
  story: Story;
  activeIndex: number;
  /** True while the video is being recorded. */
  disabled: boolean;
  onChange: (update: (current: Story) => Story) => void;
  onSelect: (index: number) => void;
};

/** The scene editor for cartoon stories: who is on screen, where, and what they say. */
export function StoryScenes({ story, activeIndex, disabled, onChange, onSelect }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const count = story.scenes.length;

  const updateScene = (sceneId: string, update: (scene: StoryScene) => StoryScene) =>
    onChange((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === sceneId ? update(scene) : scene)),
    }));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= count) return;
    onChange((current) => {
      const scenes = [...current.scenes];
      [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
      return { ...current, scenes };
    });
    setAnnouncement(`Scene moved to position ${target + 1} of ${count}.`);
  };

  const remove = (index: number) => {
    if (!window.confirm(`Delete scene ${index + 1}? This cannot be undone.`)) return;
    const sceneId = story.scenes[index].id;
    onChange((current) => ({
      ...current,
      scenes: current.scenes.filter((scene) => scene.id !== sceneId),
    }));
    setAnnouncement(`Scene ${index + 1} deleted.`);
  };

  return (
    <section aria-labelledby="story-scenes-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="story-scenes-title" className="font-display text-2xl font-bold">
          Scenes
        </h2>
        <p className="text-muted">
          {count} {count === 1 ? "scene" : "scenes"}
        </p>
      </div>
      <p className="mt-0.5 text-muted">Open a scene to change who is in it and what they say.</p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <fieldset disabled={disabled} className="mt-3 min-w-0 disabled:opacity-60">
        <legend className="sr-only">Scenes in this story</legend>
        <ol className="space-y-2">
          {story.scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              story={story}
              scene={scene}
              index={index}
              count={count}
              active={index === activeIndex}
              open={openId === scene.id}
              onToggle={() => {
                setOpenId(openId === scene.id ? null : scene.id);
                onSelect(index);
              }}
              onUpdate={(update) => updateScene(scene.id, update)}
              onMove={(direction) => move(index, direction)}
              onDelete={() => remove(index)}
            />
          ))}
        </ol>
      </fieldset>
    </section>
  );
}

type CardProps = {
  story: Story;
  scene: StoryScene;
  index: number;
  count: number;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onUpdate: (update: (scene: StoryScene) => StoryScene) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
};

function SceneCard(props: CardProps) {
  const { story, scene, index, count, open } = props;
  const panelId = useId();
  const number = index + 1;
  const place = story.locations.find((location) => location.id === scene.locationId)?.name;
  const preview = scene.lines.find((line) => line.text.trim())?.text ?? "(no lines yet)";

  return (
    <li
      className={`rounded-2xl border bg-surface shadow-sm transition-colors duration-200 ${
        props.active ? "border-brand" : "border-line"
      }`}
    >
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left transition-colors duration-200 hover:bg-brand-soft"
        >
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-canvas font-display text-lg font-bold text-brand-strong"
            aria-hidden="true"
          >
            {number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-muted">
              Scene {number} · {Math.round(sceneDuration(scene))}s{place ? ` · ${place}` : ""}
            </span>
            <span className="line-clamp-2 font-semibold">{preview}</span>
          </span>
          <ChevronIcon open={open} />
        </button>
        <IconButton
          label={`Move scene ${number} up`}
          onClick={() => props.onMove(-1)}
          disabled={index === 0}
        >
          <UpIcon />
        </IconButton>
        <IconButton
          label={`Move scene ${number} down`}
          onClick={() => props.onMove(1)}
          disabled={index === count - 1}
        >
          <DownIcon />
        </IconButton>
      </div>

      <div id={panelId} hidden={!open}>
        {open && <SceneEditor {...props} />}
      </div>
    </li>
  );
}

function SceneEditor({ story, scene, index, count, onUpdate, onDelete }: CardProps) {
  const id = useId();
  const speakers = new Set(scene.lines.map((line) => line.speaker));
  const stageFull = scene.onStage.length >= STORY_LIMITS.onStage;

  const setLine = (lineIndex: number, patch: Partial<StoryLine>) =>
    onUpdate((current) => {
      const lines = current.lines.map((line, i) => (i === lineIndex ? { ...line, ...patch } : line));
      // Whoever speaks must be on screen.
      const speaker = patch.speaker;
      const onStage =
        speaker && speaker !== NARRATOR && !current.onStage.includes(speaker)
          ? [...current.onStage, speaker]
          : current.onStage;
      return { ...current, lines, onStage };
    });

  return (
    <div className="space-y-4 border-t border-line p-3 sm:p-4">
      <div>
        <label htmlFor={`${id}-place`} className="mb-1 block font-semibold">
          Background
        </label>
        <select
          id={`${id}-place`}
          value={scene.locationId}
          onChange={(event) => onUpdate((current) => ({ ...current, locationId: event.target.value }))}
          className={`${inputClass} min-h-11`}
        >
          {story.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name || "Place"}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="mb-1 font-semibold">Who is on screen (up to {STORY_LIMITS.onStage})</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {story.characters.map((character) => {
            const checked = scene.onStage.includes(character.id);
            const speaks = speakers.has(character.id);
            return (
              <label key={character.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={(checked && speaks) || (!checked && stageFull)}
                  onChange={() =>
                    onUpdate((current) => ({
                      ...current,
                      onStage: checked
                        ? current.onStage.filter((item) => item !== character.id)
                        : [...current.onStage, character.id],
                    }))
                  }
                  className="size-5 accent-brand"
                />
                {character.name || "Character"}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-sm text-muted">
          Anyone who speaks in the scene stays on screen.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-semibold">Lines</legend>
        <ol className="space-y-3">
          {scene.lines.map((line, lineIndex) => (
            <li key={lineIndex} className="rounded-xl bg-canvas p-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`${id}-speaker-${lineIndex}`} className="mb-1 block text-sm font-semibold">
                    Line {lineIndex + 1}: who says it
                  </label>
                  <select
                    id={`${id}-speaker-${lineIndex}`}
                    value={line.speaker}
                    onChange={(event) => setLine(lineIndex, { speaker: event.target.value })}
                    className={`${inputClass} min-h-11`}
                  >
                    <option value={NARRATOR}>Narrator (nobody on screen)</option>
                    {story.characters.map((character) => (
                      <option
                        key={character.id}
                        value={character.id}
                        disabled={stageFull && !scene.onStage.includes(character.id)}
                      >
                        {character.name || "Character"}
                      </option>
                    ))}
                  </select>
                </div>
                <IconButton
                  label={`Delete line ${lineIndex + 1}`}
                  disabled={scene.lines.length <= 1}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      lines: current.lines.filter((_, i) => i !== lineIndex),
                    }))
                  }
                >
                  <TrashIcon />
                </IconButton>
              </div>
              <label htmlFor={`${id}-text-${lineIndex}`} className="sr-only">
                Line {lineIndex + 1}: what they say
              </label>
              <textarea
                id={`${id}-text-${lineIndex}`}
                value={line.text}
                rows={2}
                maxLength={STORY_LIMITS.lineText}
                placeholder="What they say"
                onChange={(event) => setLine(lineIndex, { text: event.target.value })}
                className={`${inputClass} field-sizing-content mt-2 min-h-11 resize-y leading-relaxed`}
              />
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            compact
            disabled={scene.lines.length >= STORY_LIMITS.linesPerScene}
            onClick={() =>
              onUpdate((current) => ({
                ...current,
                lines: [...current.lines, { speaker: NARRATOR, text: "" }],
              }))
            }
          >
            Add a line
          </Button>
          <Button compact variant="danger" disabled={count <= 1} onClick={onDelete}>
            <TrashIcon />
            Delete scene {index + 1}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
