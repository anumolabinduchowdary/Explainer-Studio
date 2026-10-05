"use client";

import { useId, useState } from "react";
import type { ErrorInfo } from "@/lib/errors";
import { LIMITS, TRANSITIONS, type Scene, type Storyboard, type Transition } from "@/lib/schemas";
import { visualDataUrl } from "@/lib/visualArt";
import { VISUALS, getVisual } from "@/lib/visuals";
import { ErrorNotice } from "./ErrorNotice";
import {
  Button,
  ChevronIcon,
  DownIcon,
  IconButton,
  RefreshIcon,
  TrashIcon,
  UpIcon,
  inputClass,
} from "./ui";

const TRANSITION_LABELS: Record<Transition, string> = {
  fade: "Fade in",
  "slide-left": "Slide in from the right",
  "slide-up": "Slide up",
  zoom: "Gentle zoom",
};

type Props = {
  storyboard: Storyboard;
  activeIndex: number;
  /** True while the video is being recorded. */
  disabled: boolean;
  regeneratingId: string | null;
  sceneError: { sceneId: string; error: ErrorInfo } | null;
  onChange: (update: (current: Storyboard) => Storyboard) => void;
  onSelect: (index: number) => void;
  onRegenerate: (sceneId: string, instruction: string) => void;
  onUseOwnKey: () => void;
};

export function SceneList(props: Props) {
  const { storyboard, activeIndex, disabled, onChange } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ scene: Scene; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const count = storyboard.scenes.length;

  const updateScene = (id: string, patch: Partial<Scene>) =>
    onChange((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
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
    const scene = storyboard.scenes[index];
    setDeleted({ scene, index });
    setAnnouncement(`Scene ${index + 1} deleted.`);
    onChange((current) => ({
      ...current,
      scenes: current.scenes.filter((s) => s.id !== scene.id),
    }));
  };

  const undoDelete = () => {
    if (!deleted) return;
    onChange((current) => {
      if (current.scenes.some((s) => s.id === deleted.scene.id)) return current;
      const scenes = [...current.scenes];
      scenes.splice(Math.min(deleted.index, scenes.length), 0, deleted.scene);
      return { ...current, scenes };
    });
    setAnnouncement("Scene restored.");
    setDeleted(null);
  };

  return (
    <section aria-labelledby="scenes-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="scenes-title" className="font-display text-2xl font-bold">
          Scenes
        </h2>
        <p className="text-muted">
          {count} {count === 1 ? "scene" : "scenes"}
        </p>
      </div>
      <p className="mt-0.5 text-muted">Open a scene to edit its words, picture or timing.</p>

      {deleted && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-sun-soft px-3 py-2">
          <p>Scene deleted.</p>
          <Button compact onClick={undoDelete} disabled={disabled}>
            Undo
          </Button>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* A disabled fieldset locks every control inside it while recording. */}
      <fieldset disabled={disabled} className="mt-3 min-w-0 disabled:opacity-60">
        <legend className="sr-only">Scenes in this video</legend>
        <ol className="space-y-2">
          {storyboard.scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={index}
              count={count}
              active={index === activeIndex}
              open={openId === scene.id}
              regenerating={props.regeneratingId === scene.id}
              busyElsewhere={props.regeneratingId !== null && props.regeneratingId !== scene.id}
              error={props.sceneError?.sceneId === scene.id ? props.sceneError.error : null}
              onToggle={() => {
                setOpenId(openId === scene.id ? null : scene.id);
                props.onSelect(index);
              }}
              onUpdate={(patch) => updateScene(scene.id, patch)}
              onMove={(direction) => move(index, direction)}
              onDelete={() => remove(index)}
              onRegenerate={(instruction) => props.onRegenerate(scene.id, instruction)}
              onUseOwnKey={props.onUseOwnKey}
            />
          ))}
        </ol>
      </fieldset>
    </section>
  );
}

type CardProps = {
  scene: Scene;
  index: number;
  count: number;
  active: boolean;
  open: boolean;
  regenerating: boolean;
  busyElsewhere: boolean;
  error: ErrorInfo | null;
  onToggle: () => void;
  onUpdate: (patch: Partial<Scene>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onRegenerate: (instruction: string) => void;
  onUseOwnKey: () => void;
};

function SceneCard(props: CardProps) {
  const { scene, index, count, open } = props;
  const panelId = useId();
  const number = index + 1;

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
          {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
          <img
            src={visualDataUrl(scene.visual)}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-full bg-canvas"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-muted">
              Scene {number} · {scene.durationSec}s · {getVisual(scene.visual).label}
            </span>
            <span className="line-clamp-2 font-semibold">{scene.heading || "(no heading)"}</span>
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

function parseBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().slice(0, LIMITS.bullet))
    .filter(Boolean)
    .slice(0, LIMITS.bullets);
}

function SceneEditor(props: CardProps) {
  const { scene, index, count, onUpdate, regenerating } = props;
  const id = useId();
  const [instruction, setInstruction] = useState("");

  // The bullets box keeps its own raw text so blank lines survive while typing.
  // If the scene's bullets change from outside (for example a rewrite), reset it.
  const [bulletText, setBulletText] = useState(scene.bullets.join("\n"));
  const [syncedBullets, setSyncedBullets] = useState(scene.bullets);
  if (syncedBullets !== scene.bullets) {
    setSyncedBullets(scene.bullets);
    if (parseBullets(bulletText).join("\n") !== scene.bullets.join("\n")) {
      setBulletText(scene.bullets.join("\n"));
    }
  }

  return (
    <div className="space-y-4 border-t border-line p-3 sm:p-4">
      <div>
        <label htmlFor={`${id}-heading`} className="mb-1 block font-semibold">
          Heading
        </label>
        <input
          id={`${id}-heading`}
          type="text"
          value={scene.heading}
          maxLength={LIMITS.heading}
          onChange={(event) => onUpdate({ heading: event.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${id}-body`} className="mb-1 block font-semibold">
          Text
        </label>
        <textarea
          id={`${id}-body`}
          value={scene.body}
          rows={3}
          maxLength={LIMITS.body}
          onChange={(event) => onUpdate({ body: event.target.value })}
          className={`${inputClass} field-sizing-content min-h-20 resize-y leading-relaxed`}
        />
      </div>

      <div>
        <label htmlFor={`${id}-bullets`} className="mb-1 block font-semibold">
          Bullet points <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={`${id}-bullets`}
          value={bulletText}
          rows={3}
          aria-describedby={`${id}-bullets-help`}
          onChange={(event) => {
            setBulletText(event.target.value);
            onUpdate({ bullets: parseBullets(event.target.value) });
          }}
          className={`${inputClass} field-sizing-content min-h-20 resize-y leading-relaxed`}
        />
        <p id={`${id}-bullets-help`} className="mt-1 text-sm text-muted">
          One point per line, up to {LIMITS.bullets}.
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-duration`} className="mb-1 block font-semibold">
          Time on screen: {scene.durationSec} seconds
        </label>
        <input
          id={`${id}-duration`}
          type="range"
          min={LIMITS.minSceneSec}
          max={LIMITS.maxSceneSec}
          step={1}
          value={scene.durationSec}
          onChange={(event) => onUpdate({ durationSec: Number(event.target.value) })}
          className="h-11 w-full accent-brand"
        />
      </div>

      <fieldset>
        <legend className="mb-1 font-semibold">Picture</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
          {VISUALS.map((visual) => (
            <label key={visual.id} className="block cursor-pointer" title={visual.label}>
              <input
                type="radio"
                name={`${id}-visual`}
                value={visual.id}
                checked={scene.visual === visual.id}
                onChange={() => onUpdate({ visual: visual.id })}
                className="peer sr-only"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img
                src={visualDataUrl(visual.id)}
                alt={visual.label}
                width={52}
                height={52}
                className="aspect-square w-full rounded-xl border-2 border-transparent bg-canvas p-0.5 transition-colors duration-200 hover:border-line peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted">Selected: {getVisual(scene.visual).label}</p>
      </fieldset>

      <div>
        <label htmlFor={`${id}-transition`} className="mb-1 block font-semibold">
          How this scene arrives
        </label>
        <select
          id={`${id}-transition`}
          value={scene.transition}
          onChange={(event) => onUpdate({ transition: event.target.value as Transition })}
          className={`${inputClass} min-h-11`}
        >
          {TRANSITIONS.map((transition) => (
            <option key={transition} value={transition}>
              {TRANSITION_LABELS[transition]}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl bg-canvas p-3">
        <label htmlFor={`${id}-instruction`} className="mb-1 block font-semibold">
          Ask the AI to rewrite this scene
        </label>
        <input
          id={`${id}-instruction`}
          type="text"
          value={instruction}
          maxLength={LIMITS.instruction}
          placeholder="Optional: what should change? e.g. make it simpler"
          onChange={(event) => setInstruction(event.target.value)}
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            compact
            loading={regenerating}
            disabled={props.busyElsewhere}
            onClick={() => props.onRegenerate(instruction.trim())}
          >
            {!regenerating && <RefreshIcon />}
            {regenerating ? "Rewriting…" : "Rewrite scene"}
          </Button>
          <Button
            compact
            variant="danger"
            disabled={count <= 1 || regenerating}
            onClick={props.onDelete}
          >
            <TrashIcon />
            Delete scene {index + 1}
          </Button>
        </div>
        <p aria-live="polite" className="sr-only">
          {regenerating ? "Rewriting this scene." : ""}
        </p>
        {props.error && (
          <ErrorNotice
            className="mt-3"
            error={props.error}
            onRetry={() => props.onRegenerate(instruction.trim())}
            onUseOwnKey={props.onUseOwnKey}
          />
        )}
      </div>
    </div>
  );
}
