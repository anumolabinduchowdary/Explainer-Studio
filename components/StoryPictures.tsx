"use client";

import { useId } from "react";
import {
  CHARACTER_SIZES,
  STORY_LIMITS,
  pictureKey,
  type Story,
  type StoryCharacter,
  type StoryLocation,
} from "@/lib/story";
import type { PictureMap, PictureState } from "@/lib/storyPictures";
import { ErrorNotice } from "./ErrorNotice";
import { Button, RefreshIcon, SparkIcon, Spinner, inputClass } from "./ui";

const SIZE_LABELS: Record<StoryCharacter["size"], string> = {
  small: "Small (child or object)",
  medium: "Medium (teenager)",
  large: "Large (adult)",
};

/** The text a picture was drawn from. If it no longer matches, the picture is out of date. */
export const pictureSource = {
  character: (story: Story, character: StoryCharacter) => `${story.artStyle}|${character.look}`,
  place: (story: Story, location: StoryLocation) =>
    `${story.artStyle}|${story.aspectRatio}|${location.look}`,
};

export function needsDrawing(state: PictureState | undefined, source: string): boolean {
  if (!state || state.status === "failed") return true;
  return state.status === "ready" && state.picture.source !== source;
}

/** A character needs drawing if its standing pose (or, with gestures on, its gesture pose) is missing or out of date. */
export function characterNeedsDrawing(
  story: Story,
  character: StoryCharacter,
  pictures: PictureMap,
  gesturesOn: boolean,
): boolean {
  const source = pictureSource.character(story, character);
  if (needsDrawing(pictures[pictureKey.character(character.id)], source)) return true;
  return gesturesOn && needsDrawing(pictures[pictureKey.gesture(character.id)], source);
}

type Props = {
  story: Story;
  pictures: PictureMap;
  /** Characters whose mouth animation is switched off. */
  mouthOff: ReadonlySet<string>;
  /** Whether characters get a second, hand-raised pose to use while talking. */
  gesturesOn: boolean;
  /** Characters whose gestures are switched off. */
  gestureOff: ReadonlySet<string>;
  onToggleGestures: () => void;
  onToggleGesture: (characterId: string) => void;
  /** True while the video is being recorded. */
  disabled: boolean;
  /** Progress of "draw the pictures", or null when it is not running. */
  batch: { done: number; total: number } | null;
  onStoryChange: (update: (current: Story) => Story) => void;
  onDrawCharacter: (characterId: string) => void;
  onDrawPlace: (locationId: string) => void;
  onDrawMissing: () => void;
  onStop: () => void;
  onToggleMouth: (characterId: string) => void;
  onUseOwnKey: () => void;
};

export function StoryPictures(props: Props) {
  const { story, pictures, batch, disabled, onStoryChange } = props;
  const id = useId();

  const waiting =
    story.characters.filter((character) =>
      characterNeedsDrawing(story, character, pictures, props.gesturesOn),
    ).length +
    story.locations.filter((location) =>
      needsDrawing(pictures[pictureKey.place(location.id)], pictureSource.place(story, location)),
    ).length;
  const total = story.characters.length + story.locations.length;
  // The headline count is about the main pictures; gesture poses are an extra on top.
  const mainWaiting =
    story.characters.filter((character) =>
      needsDrawing(pictures[pictureKey.character(character.id)], pictureSource.character(story, character)),
    ).length +
    story.locations.filter((location) =>
      needsDrawing(pictures[pictureKey.place(location.id)], pictureSource.place(story, location)),
    ).length;
  const anyDrawing = Object.values(pictures).some((state) => state.status === "drawing");

  const updateCharacter = (characterId: string, patch: Partial<StoryCharacter>) =>
    onStoryChange((current) => ({
      ...current,
      characters: current.characters.map((c) => (c.id === characterId ? { ...c, ...patch } : c)),
    }));
  const updateLocation = (locationId: string, patch: Partial<StoryLocation>) =>
    onStoryChange((current) => ({
      ...current,
      locations: current.locations.map((l) => (l.id === locationId ? { ...l, ...patch } : l)),
    }));

  return (
    <section aria-labelledby={`${id}-title`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold">
          Pictures
        </h2>
        <p className="text-muted">
          {total - mainWaiting} of {total} drawn
        </p>
      </div>
      <p className="mt-0.5 text-muted">
        The AI draws each character and background from its description. Please check every
        picture: AI drawings can contain mistakes. Each one is charged to the OpenAI account in
        use.
      </p>

      <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Pictures for this story</legend>

        {batch ? (
          <div className="rounded-2xl bg-brand-soft p-3">
            <label htmlFor={`${id}-progress`} className="font-semibold">
              Drawing… {batch.done} of {batch.total} finished
            </label>
            <progress
              id={`${id}-progress`}
              value={batch.done}
              max={batch.total}
              className="mt-2 block h-3 w-full overflow-hidden rounded-full accent-brand"
            />
            <p className="mt-2 text-muted">
              Each picture can take up to a minute. You can keep editing while you wait.
            </p>
            <Button compact className="mt-2" onClick={props.onStop}>
              Stop after the current pictures
            </Button>
          </div>
        ) : (
          waiting > 0 && (
            <Button variant="primary" onClick={props.onDrawMissing} disabled={anyDrawing}>
              <SparkIcon />
              {mainWaiting === total ? "Draw the pictures" : "Draw the remaining pictures"} ({waiting})
            </Button>
          )
        )}
        <p aria-live="polite" className="sr-only">
          {batch ? `Drawing pictures: ${batch.done} of ${batch.total} finished.` : ""}
        </p>

        <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={props.gesturesOn}
              onChange={props.onToggleGestures}
              className="size-5 accent-brand"
            />
            Hand gestures while talking
          </label>
          <p className="text-sm text-muted">
            Draws each character a second time with a hand raised, and switches to it now and
            then while they speak. Adds 2 pictures per character.
          </p>
        </div>

        <details className="rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-11 content-center font-semibold">Drawing style</summary>
          <label htmlFor={`${id}-style`} className="sr-only">
            Drawing style
          </label>
          <textarea
            id={`${id}-style`}
            value={story.artStyle}
            rows={3}
            maxLength={STORY_LIMITS.artStyle}
            aria-describedby={`${id}-style-help`}
            onChange={(event) =>
              onStoryChange((current) => ({ ...current, artStyle: event.target.value }))
            }
            className={`${inputClass} field-sizing-content mt-1 min-h-20 resize-y leading-relaxed`}
          />
          <p id={`${id}-style-help`} className="mt-1 text-sm text-muted">
            Describe the look in your own words. Changing it means redrawing every picture.
          </p>
        </details>

        <div>
          <h3 className="font-display text-xl font-bold">Characters</h3>
          <ul className="mt-2 space-y-2">
            {story.characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                picture={pictures[pictureKey.character(character.id)]}
                talking={pictures[pictureKey.talking(character.id)]}
                gesture={props.gesturesOn ? pictures[pictureKey.gesture(character.id)] : undefined}
                gestureOn={!props.gestureOff.has(character.id)}
                onToggleGesture={() => props.onToggleGesture(character.id)}
                stale={isStale(
                  pictures[pictureKey.character(character.id)],
                  pictureSource.character(story, character),
                )}
                mouthOn={!props.mouthOff.has(character.id)}
                busy={batch !== null}
                onUpdate={(patch) => updateCharacter(character.id, patch)}
                onDraw={() => props.onDrawCharacter(character.id)}
                onToggleMouth={() => props.onToggleMouth(character.id)}
                onUseOwnKey={props.onUseOwnKey}
              />
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-display text-xl font-bold">Backgrounds</h3>
          <ul className="mt-2 space-y-2">
            {story.locations.map((location) => (
              <PlaceCard
                key={location.id}
                location={location}
                picture={pictures[pictureKey.place(location.id)]}
                stale={isStale(
                  pictures[pictureKey.place(location.id)],
                  pictureSource.place(story, location),
                )}
                busy={batch !== null}
                onUpdate={(patch) => updateLocation(location.id, patch)}
                onDraw={() => props.onDrawPlace(location.id)}
                onUseOwnKey={props.onUseOwnKey}
              />
            ))}
          </ul>
        </div>
      </fieldset>
    </section>
  );
}

function isStale(state: PictureState | undefined, source: string): boolean {
  return state?.status === "ready" && state.picture.source !== source;
}

/* ------------------------------------------------------------------ */

function Thumb({ state, alt, wide }: { state: PictureState | undefined; alt: string; wide?: boolean }) {
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-canvas text-center text-sm text-muted ${
    wide ? "aspect-[4/3] w-28" : "aspect-[3/4] w-24"
  }`;
  if (state?.status === "ready") {
    return (
      <div className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated picture held in memory */}
        <img
          src={state.picture.sprite.previewUrl ?? state.picture.dataUrl}
          alt={alt}
          className={`size-full ${wide ? "object-cover" : "object-contain"}`}
        />
      </div>
    );
  }
  if (state?.status === "drawing") {
    return (
      <div className={`${box} flex-col gap-1 p-1 text-brand-strong`} role="status">
        <Spinner />
        <span>{state.note ?? "Drawing…"}</span>
      </div>
    );
  }
  return (
    <div className={`${box} p-1`}>
      {state?.status === "failed" ? "Could not be drawn" : "Not drawn yet"}
    </div>
  );
}

type CharacterCardProps = {
  character: StoryCharacter;
  picture: PictureState | undefined;
  talking: PictureState | undefined;
  /** The hand-raised pose, when gestures are on for the story. */
  gesture: PictureState | undefined;
  gestureOn: boolean;
  onToggleGesture: () => void;
  stale: boolean;
  mouthOn: boolean;
  busy: boolean;
  onUpdate: (patch: Partial<StoryCharacter>) => void;
  onDraw: () => void;
  onToggleMouth: () => void;
  onUseOwnKey: () => void;
};

function CharacterCard(props: CharacterCardProps) {
  const { character, picture, talking, gesture } = props;
  const id = useId();
  const drawing =
    picture?.status === "drawing" || talking?.status === "drawing" || gesture?.status === "drawing";
  const name = character.name || "This character";

  return (
    <li className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex gap-3">
        <div className="space-y-2">
          <Thumb state={picture} alt={`Drawing of ${name}`} />
          {gesture && picture?.status === "ready" && (
            <Thumb state={gesture} alt={`${name} with a hand raised`} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block font-semibold">
              Name
            </label>
            <input
              id={`${id}-name`}
              type="text"
              value={character.name}
              maxLength={STORY_LIMITS.name}
              onChange={(event) => props.onUpdate({ name: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-size`} className="mb-1 block font-semibold">
              Size on screen
            </label>
            <select
              id={`${id}-size`}
              value={character.size}
              onChange={(event) =>
                props.onUpdate({ size: event.target.value as StoryCharacter["size"] })
              }
              className={`${inputClass} min-h-11`}
            >
              {CHARACTER_SIZES.map((size) => (
                <option key={size} value={size}>
                  {SIZE_LABELS[size]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <label htmlFor={`${id}-look`} className="mb-1 mt-3 block font-semibold">
        What to draw
      </label>
      <textarea
        id={`${id}-look`}
        value={character.look}
        rows={3}
        maxLength={STORY_LIMITS.look}
        onChange={(event) => props.onUpdate({ look: event.target.value })}
        className={`${inputClass} field-sizing-content min-h-20 resize-y leading-relaxed`}
      />

      {props.stale && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
          The description has changed. Redraw to update the picture.
        </p>
      )}
      {picture?.status === "failed" && (
        <ErrorNotice
          className="mt-2"
          error={picture.error}
          onRetry={props.onDraw}
          onUseOwnKey={props.onUseOwnKey}
        />
      )}
      {picture?.status === "ready" && gesture?.status === "failed" && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
          The hand-gesture pose could not be drawn, so {name} will keep their hands still. Redraw
          to try again.
        </p>
      )}
      {picture?.status === "ready" && talking?.status === "failed" && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
          The talking pose could not be drawn, so {name} will bounce while speaking instead of
          moving their mouth. Redraw to try again.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button compact loading={drawing} disabled={props.busy && !drawing} onClick={props.onDraw}>
          {!drawing && <RefreshIcon />}
          {drawing ? "Drawing…" : picture?.status === "ready" ? "Redraw" : "Draw"}
        </Button>
        {talking?.status === "ready" && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={props.mouthOn}
              onChange={props.onToggleMouth}
              className="size-5 accent-brand"
            />
            Mouth moves when talking
          </label>
        )}
        {gesture?.status === "ready" && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={props.gestureOn}
              onChange={props.onToggleGesture}
              className="size-5 accent-brand"
            />
            Uses hand gestures
          </label>
        )}
      </div>
    </li>
  );
}

type PlaceCardProps = {
  location: StoryLocation;
  picture: PictureState | undefined;
  stale: boolean;
  busy: boolean;
  onUpdate: (patch: Partial<StoryLocation>) => void;
  onDraw: () => void;
  onUseOwnKey: () => void;
};

function PlaceCard(props: PlaceCardProps) {
  const { location, picture } = props;
  const id = useId();
  const drawing = picture?.status === "drawing";

  return (
    <li className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex gap-3">
        <Thumb state={picture} alt={`Background: ${location.name || "place"}`} wide />
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-name`} className="mb-1 block font-semibold">
            Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={location.name}
            maxLength={STORY_LIMITS.name}
            onChange={(event) => props.onUpdate({ name: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <label htmlFor={`${id}-look`} className="mb-1 mt-3 block font-semibold">
        What to draw
      </label>
      <textarea
        id={`${id}-look`}
        value={location.look}
        rows={2}
        maxLength={STORY_LIMITS.look}
        onChange={(event) => props.onUpdate({ look: event.target.value })}
        className={`${inputClass} field-sizing-content min-h-16 resize-y leading-relaxed`}
      />

      {props.stale && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
          The description, style or shape has changed. Redraw to update the picture.
        </p>
      )}
      {picture?.status === "failed" && (
        <ErrorNotice
          className="mt-2"
          error={picture.error}
          onRetry={props.onDraw}
          onUseOwnKey={props.onUseOwnKey}
        />
      )}

      <div className="mt-3">
        <Button compact loading={drawing} disabled={props.busy && !drawing} onClick={props.onDraw}>
          {!drawing && <RefreshIcon />}
          {drawing ? "Drawing…" : picture?.status === "ready" ? "Redraw" : "Draw"}
        </Button>
      </div>
    </li>
  );
}
