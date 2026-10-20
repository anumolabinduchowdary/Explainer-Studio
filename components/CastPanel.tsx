"use client";

import { useId, useRef } from "react";
import type { CastFile } from "@/lib/cast";
import type { Story } from "@/lib/story";
import { Button } from "./ui";

export type CastChoice = { characters: Array<string | null>; places: Array<string | null> };

type Props = {
  story: Story;
  /** Whether any character or place has a finished picture to save. */
  canSave: boolean;
  disabled: boolean;
  /** A cast file that was opened, with the suggested matches, waiting to be confirmed. */
  offer: { cast: CastFile; choice: CastChoice } | null;
  error: string | null;
  onSave: () => void;
  onOpen: (file: File) => void;
  onChoose: (choice: CastChoice) => void;
  onUse: () => void;
  onCancel: () => void;
};

/**
 * Save cast / Load cast: keeps a story's characters (every picture of them),
 * their voices, the places and the drawing style in a file on this computer,
 * and puts them into a new story so a series looks the same in every episode.
 */
export function CastPanel(props: Props) {
  const { story, offer } = props;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 id={`${id}-title`} className="font-display text-xl font-bold">
        Your cast
      </h2>
      <p className="mt-1 text-muted">
        Save these characters and places to a file on your computer, then load them into your next story. They keep
        exactly the same look (and voices), and their pictures don&apos;t need drawing again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button compact disabled={!props.canSave || props.disabled} onClick={props.onSave}>
          Save cast
        </Button>
        <Button compact disabled={props.disabled} onClick={() => input.current?.click()}>
          Load cast
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a saved cast file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) props.onOpen(file);
          }}
        />
      </div>
      {props.error && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {props.error}
        </p>
      )}

      {offer && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <p>
            <span className="font-semibold">Saved cast from &ldquo;{offer.cast.title || "a story"}&rdquo;.</span> Choose who
            each saved character becomes in this story. Their description, voice and pictures replace the ones here, and
            the story uses the saved drawing style.
          </p>
          {offer.cast.characters.length > 0 && (
            <fieldset>
              <legend className="mb-2 font-semibold">Characters</legend>
              <ul className="space-y-2">
                {offer.cast.characters.map((saved, i) => (
                  <li key={`${saved.name}-${i}`} className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL from the saved file */}
                    <img
                      src={saved.pictures.character}
                      alt={`Saved picture of ${saved.name}`}
                      className="h-16 w-12 shrink-0 rounded-lg border border-line bg-white object-contain"
                    />
                    <label htmlFor={`${id}-c${i}`} className="min-w-0 flex-1 font-semibold">
                      {saved.name || "Character"}
                    </label>
                    <select
                      id={`${id}-c${i}`}
                      value={offer.choice.characters[i] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value || null;
                        // A story character can only take one saved character.
                        const characters = offer.choice.characters.map((current, j) =>
                          j === i ? value : current === value ? null : current,
                        );
                        props.onChoose({ ...offer.choice, characters });
                      }}
                      className="min-h-11 max-w-[55%] rounded-xl border border-line bg-white px-3"
                    >
                      <option value="">Don&apos;t use</option>
                      {story.characters.map((character) => (
                        <option key={character.id} value={character.id}>
                          {character.name || "Character"}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {offer.cast.places.length > 0 && (
            <fieldset>
              <legend className="mb-2 font-semibold">Places</legend>
              <ul className="space-y-2">
                {offer.cast.places.map((saved, i) => {
                  const otherShape = saved.aspectRatio !== story.aspectRatio;
                  return (
                    <li key={`${saved.name}-${i}`} className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL from the saved file */}
                      <img
                        src={saved.picture}
                        alt={`Saved picture of ${saved.name}`}
                        className="h-12 w-16 shrink-0 rounded-lg border border-line object-cover"
                      />
                      <label htmlFor={`${id}-p${i}`} className="min-w-0 flex-1">
                        <span className="font-semibold">{saved.name || "Place"}</span>
                        {otherShape && (
                          <span className="block text-sm text-muted">
                            Saved for a {saved.aspectRatio} video, so it will be drawn again in this shape.
                          </span>
                        )}
                      </label>
                      <select
                        id={`${id}-p${i}`}
                        value={offer.choice.places[i] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value || null;
                          const places = offer.choice.places.map((current, j) =>
                            j === i ? value : current === value ? null : current,
                          );
                          props.onChoose({ ...offer.choice, places });
                        }}
                        className="min-h-11 max-w-[55%] rounded-xl border border-line bg-white px-3"
                      >
                        <option value="">Don&apos;t use</option>
                        {story.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name || "Place"}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={props.disabled || [...offer.choice.characters, ...offer.choice.places].every((item) => !item)}
              onClick={props.onUse}
            >
              Use these
            </Button>
            <Button onClick={props.onCancel}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
