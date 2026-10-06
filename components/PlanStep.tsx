"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo } from "@/lib/errors";
import {
  PLAN_LENGTHS,
  PLAN_LIMITS,
  StoryPlanSchema,
  nextId,
  picturesNeeded,
  type PlanCharacter,
  type PlanPlace,
  type StoryPlan,
} from "@/lib/plan";
import { ASPECT_RATIOS, type AspectRatio } from "@/lib/schemas";
import { VOICE_AGES, VOICE_AGE_SETTINGS, type VoiceAge } from "@/lib/story";
import { ErrorNotice } from "./ErrorNotice";
import { SHAPE_LABELS } from "./VideoDetails";
import { Button, Card, IconButton, SparkIcon, TrashIcon, inputClass } from "./ui";

type Props = {
  plan: StoryPlan;
  onChange: (plan: StoryPlan) => void;
  busy: boolean;
  error: ErrorInfo | null;
  /** True once a story has been written from a plan at least once. */
  hasResult: boolean;
  onBack: () => void;
  onGenerate: () => void;
  onUseOwnKey: () => void;
};

/** Field id for a path in the plan, e.g. ["characters", 0, "name"] -> "plan-characters-0-name". */
const fieldId = (path: ReadonlyArray<PropertyKey>) => `plan-${path.map(String).join("-")}`;

/** The first problem with each field, keyed by field id. */
function validate(plan: StoryPlan): Map<string, string> {
  const errors = new Map<string, string>();
  const result = StoryPlanSchema.safeParse(plan);
  if (result.success) return errors;
  for (const issue of result.error.issues) {
    const id = fieldId(issue.path);
    if (!errors.has(id)) errors.set(id, issue.message);
  }
  return errors;
}

function lengthLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const whole = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return rest ? `${whole} ${rest} seconds` : whole;
}

const AGE_COUNT_WORDS: Record<VoiceAge, [string, string]> = {
  child: ["child", "children"],
  teen: ["teenager", "teenagers"],
  adult: ["adult", "adults"],
  older: ["older person", "older people"],
};

/** "4 children, 1 adult" */
function castSummary(characters: ReadonlyArray<PlanCharacter>): string {
  return VOICE_AGES.map((age) => {
    const count = characters.filter((character) => character.age === age).length;
    return count ? `${count} ${AGE_COUNT_WORDS[age][count === 1 ? 0 : 1]}` : "";
  })
    .filter(Boolean)
    .join(", ");
}

/** Step 2 for cartoon stories: who is in the video, where it happens and what it should say. */
export function PlanStep(props: Props) {
  const { plan, onChange, busy, error } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => validate(plan), [plan]);
  const problem = (path: ReadonlyArray<PropertyKey>) =>
    submitted ? errors.get(fieldId(path)) : undefined;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const submit = () => {
    setSubmitted(true);
    const firstInvalid = [...errors.keys()][0];
    if (firstInvalid) {
      // A list-level problem ("add at least one character") has no field of its own.
      (document.getElementById(firstInvalid) ?? headingRef.current)?.focus();
      return;
    }
    props.onGenerate();
  };

  const setCharacter = (index: number, change: Partial<PlanCharacter>) =>
    onChange({
      ...plan,
      characters: plan.characters.map((c, i) => (i === index ? { ...c, ...change } : c)),
    });
  const setPlace = (index: number, change: Partial<PlanPlace>) =>
    onChange({ ...plan, places: plan.places.map((p, i) => (i === index ? { ...p, ...change } : p)) });

  const addCharacter = () => {
    const id = nextId("c", plan.characters);
    onChange({
      ...plan,
      characters: [...plan.characters, { id, name: "", role: "", age: "adult", look: "" }],
    });
    // Wait for the new card to appear, then move to its first box.
    requestAnimationFrame(() =>
      document.getElementById(fieldId(["characters", plan.characters.length, "name"]))?.focus(),
    );
  };
  const addPlace = () => {
    const id = nextId("l", plan.places);
    onChange({ ...plan, places: [...plan.places, { id, name: "", look: "" }] });
    requestAnimationFrame(() =>
      document.getElementById(fieldId(["places", plan.places.length, "name"]))?.focus(),
    );
  };

  const castFull = plan.characters.length >= PLAN_LIMITS.characters;
  const placesFull = plan.places.length >= PLAN_LIMITS.places;
  const lengths = PLAN_LENGTHS.includes(plan.lengthSec as (typeof PLAN_LENGTHS)[number])
    ? [...PLAN_LENGTHS]
    : [...PLAN_LENGTHS, plan.lengthSec].sort((a, b) => a - b);

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold sm:text-4xl">
        Check your story plan
      </h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        This is who and what will be in your video. Change anything you like. The story will use
        exactly these characters and places.
      </p>

      <form
        className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="min-w-0 space-y-4">
          {/* ---------------------------------------------------------- */}
          <Card>
            <section aria-labelledby="plan-cast-title">
              <h2 id="plan-cast-title" className="font-display text-xl font-bold">
                Characters ({plan.characters.length})
              </h2>
              <p className="mt-0.5 text-muted">
                Everyone who appears in the video. Each one is drawn and given a voice.
              </p>
              {problem(["characters"]) && (
                <p className="mt-2 font-semibold text-danger" role="alert">
                  {problem(["characters"])}
                </p>
              )}

              <ol className="mt-3 space-y-3">
                {plan.characters.map((character, i) => {
                  const base = ["characters", i] as const;
                  const nameError = problem([...base, "name"]);
                  const lookError = problem([...base, "look"]);
                  const called = character.name.trim() || `character ${i + 1}`;
                  return (
                    <li key={character.id}>
                      <fieldset className="min-w-0 rounded-2xl border border-line bg-canvas p-3">
                        <legend className="sr-only">Character {i + 1}</legend>
                        <div className="flex items-start gap-2">
                          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="min-w-0">
                              <label htmlFor={fieldId([...base, "name"])} className="mb-1 block font-semibold">
                                Name
                              </label>
                              <input
                                id={fieldId([...base, "name"])}
                                type="text"
                                value={character.name}
                                maxLength={PLAN_LIMITS.name}
                                aria-invalid={nameError ? true : undefined}
                                aria-describedby={nameError ? `${fieldId([...base, "name"])}-error` : undefined}
                                onChange={(event) => setCharacter(i, { name: event.target.value })}
                                className={`${inputClass} ${nameError ? "border-danger" : ""}`}
                              />
                              {nameError && (
                                <p
                                  id={`${fieldId([...base, "name"])}-error`}
                                  className="mt-1 font-semibold text-danger"
                                  role="alert"
                                >
                                  {nameError}
                                </p>
                              )}
                            </div>
                            <div className="min-w-0">
                              <label htmlFor={fieldId([...base, "age"])} className="mb-1 block font-semibold">
                                Age
                              </label>
                              <select
                                id={fieldId([...base, "age"])}
                                value={character.age}
                                onChange={(event) => setCharacter(i, { age: event.target.value as VoiceAge })}
                                className={`${inputClass} min-h-11`}
                              >
                                {VOICE_AGES.map((age) => (
                                  <option key={age} value={age}>
                                    {VOICE_AGE_SETTINGS[age].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <IconButton
                            label={`Remove ${called}`}
                            disabled={plan.characters.length <= 1}
                            onClick={() =>
                              onChange({
                                ...plan,
                                characters: plan.characters.filter((_, j) => j !== i),
                              })
                            }
                            className="mt-7 hover:text-danger"
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>

                        <label htmlFor={fieldId([...base, "role"])} className="mb-1 mt-3 block font-semibold">
                          Who they are
                        </label>
                        <input
                          id={fieldId([...base, "role"])}
                          type="text"
                          value={character.role}
                          maxLength={PLAN_LIMITS.role}
                          placeholder="e.g. physiotherapist"
                          onChange={(event) => setCharacter(i, { role: event.target.value })}
                          className={inputClass}
                        />

                        <label htmlFor={fieldId([...base, "look"])} className="mb-1 mt-3 block font-semibold">
                          What they look like
                        </label>
                        <textarea
                          id={fieldId([...base, "look"])}
                          value={character.look}
                          rows={2}
                          maxLength={PLAN_LIMITS.look}
                          aria-invalid={lookError ? true : undefined}
                          aria-describedby={lookError ? `${fieldId([...base, "look"])}-error` : undefined}
                          placeholder="e.g. A seven-year-old girl with two plaits, a yellow dress and a purple wheelchair."
                          onChange={(event) => setCharacter(i, { look: event.target.value })}
                          className={`${inputClass} field-sizing-content max-h-60 min-h-16 resize-y leading-relaxed ${
                            lookError ? "border-danger" : ""
                          }`}
                        />
                        {lookError && (
                          <p
                            id={`${fieldId([...base, "look"])}-error`}
                            className="mt-1 font-semibold text-danger"
                            role="alert"
                          >
                            {lookError}
                          </p>
                        )}
                      </fieldset>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button compact disabled={castFull} onClick={addCharacter}>
                  Add a character
                </Button>
                <p className="text-muted">
                  {castFull
                    ? `A story can have up to ${PLAN_LIMITS.characters} characters.`
                    : `Up to ${PLAN_LIMITS.characters}. Five can be on screen together.`}
                </p>
              </div>
            </section>
          </Card>

          {/* ---------------------------------------------------------- */}
          <Card>
            <section aria-labelledby="plan-places-title">
              <h2 id="plan-places-title" className="font-display text-xl font-bold">
                {plan.places.length === 1 ? "Place" : `Places (${plan.places.length})`}
              </h2>
              <p className="mt-0.5 text-muted">Where the story happens. Each place is drawn as a background.</p>
              {problem(["places"]) && (
                <p className="mt-2 font-semibold text-danger" role="alert">
                  {problem(["places"])}
                </p>
              )}

              <ol className="mt-3 space-y-3">
                {plan.places.map((place, i) => {
                  const base = ["places", i] as const;
                  const nameError = problem([...base, "name"]);
                  const lookError = problem([...base, "look"]);
                  const called = place.name.trim() || `place ${i + 1}`;
                  return (
                    <li key={place.id}>
                      <fieldset className="min-w-0 rounded-2xl border border-line bg-canvas p-3">
                        <legend className="sr-only">Place {i + 1}</legend>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <label htmlFor={fieldId([...base, "name"])} className="mb-1 block font-semibold">
                              Name
                            </label>
                            <input
                              id={fieldId([...base, "name"])}
                              type="text"
                              value={place.name}
                              maxLength={PLAN_LIMITS.name}
                              aria-invalid={nameError ? true : undefined}
                              aria-describedby={nameError ? `${fieldId([...base, "name"])}-error` : undefined}
                              placeholder="e.g. Physiotherapy centre"
                              onChange={(event) => setPlace(i, { name: event.target.value })}
                              className={`${inputClass} ${nameError ? "border-danger" : ""}`}
                            />
                            {nameError && (
                              <p
                                id={`${fieldId([...base, "name"])}-error`}
                                className="mt-1 font-semibold text-danger"
                                role="alert"
                              >
                                {nameError}
                              </p>
                            )}
                          </div>
                          <IconButton
                            label={`Remove ${called}`}
                            disabled={plan.places.length <= 1}
                            onClick={() =>
                              onChange({ ...plan, places: plan.places.filter((_, j) => j !== i) })
                            }
                            className="mt-7 hover:text-danger"
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>

                        <label htmlFor={fieldId([...base, "look"])} className="mb-1 mt-3 block font-semibold">
                          What it looks like
                        </label>
                        <textarea
                          id={fieldId([...base, "look"])}
                          value={place.look}
                          rows={2}
                          maxLength={PLAN_LIMITS.look}
                          aria-invalid={lookError ? true : undefined}
                          aria-describedby={lookError ? `${fieldId([...base, "look"])}-error` : undefined}
                          placeholder="e.g. A bright therapy room with soft mats, a mirror and parallel bars."
                          onChange={(event) => setPlace(i, { look: event.target.value })}
                          className={`${inputClass} field-sizing-content max-h-60 min-h-16 resize-y leading-relaxed ${
                            lookError ? "border-danger" : ""
                          }`}
                        />
                        {lookError && (
                          <p
                            id={`${fieldId([...base, "look"])}-error`}
                            className="mt-1 font-semibold text-danger"
                            role="alert"
                          >
                            {lookError}
                          </p>
                        )}
                      </fieldset>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button compact disabled={placesFull} onClick={addPlace}>
                  Add a place
                </Button>
                {placesFull && (
                  <p className="text-muted">A story can have up to {PLAN_LIMITS.places} places.</p>
                )}
              </div>
            </section>
          </Card>

          {/* ---------------------------------------------------------- */}
          <Card>
            <label htmlFor={fieldId(["message"])} className="font-display text-xl font-bold">
              Message
            </label>
            <p id={`${fieldId(["message"])}-hint`} className="mt-0.5 text-muted">
              What people should understand, feel or do after watching.
            </p>
            <textarea
              id={fieldId(["message"])}
              value={plan.message}
              rows={3}
              maxLength={PLAN_LIMITS.message}
              aria-invalid={problem(["message"]) ? true : undefined}
              aria-describedby={`${fieldId(["message"])}-hint${
                problem(["message"]) ? ` ${fieldId(["message"])}-error` : ""
              }`}
              onChange={(event) => onChange({ ...plan, message: event.target.value })}
              className={`${inputClass} mt-2 field-sizing-content max-h-72 min-h-20 resize-y leading-relaxed ${
                problem(["message"]) ? "border-danger" : ""
              }`}
            />
            {problem(["message"]) && (
              <p id={`${fieldId(["message"])}-error`} className="mt-1 font-semibold text-danger" role="alert">
                {problem(["message"])}
              </p>
            )}
          </Card>

          {/* ---------------------------------------------------------- */}
          <Card>
            <section aria-labelledby="plan-details-title">
              <h2 id="plan-details-title" className="font-display text-xl font-bold">
                Details
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor={fieldId(["lengthSec"])} className="mb-1 block font-semibold">
                    Length
                  </label>
                  <select
                    id={fieldId(["lengthSec"])}
                    value={plan.lengthSec}
                    onChange={(event) => onChange({ ...plan, lengthSec: Number(event.target.value) })}
                    className={`${inputClass} min-h-11`}
                  >
                    {lengths.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        About {lengthLabel(seconds)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label htmlFor={fieldId(["aspectRatio"])} className="mb-1 block font-semibold">
                    Shape
                  </label>
                  <select
                    id={fieldId(["aspectRatio"])}
                    value={plan.aspectRatio}
                    onChange={(event) =>
                      onChange({ ...plan, aspectRatio: event.target.value as AspectRatio })
                    }
                    className={`${inputClass} min-h-11`}
                  >
                    {ASPECT_RATIOS.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {SHAPE_LABELS[ratio]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label htmlFor={fieldId(["language"])} className="mb-1 block font-semibold">
                    Language
                  </label>
                  <input
                    id={fieldId(["language"])}
                    type="text"
                    value={plan.language}
                    maxLength={PLAN_LIMITS.language}
                    placeholder="e.g. English"
                    onChange={(event) => onChange({ ...plan, language: event.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor={fieldId(["tone"])} className="mb-1 block font-semibold">
                    Tone
                  </label>
                  <input
                    id={fieldId(["tone"])}
                    type="text"
                    value={plan.tone}
                    maxLength={PLAN_LIMITS.tone}
                    placeholder="e.g. warm and hopeful"
                    onChange={(event) => onChange({ ...plan, tone: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <label htmlFor={fieldId(["notes"])} className="mb-1 mt-3 block font-semibold">
                Anything else <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id={fieldId(["notes"])}
                value={plan.notes}
                rows={2}
                maxLength={PLAN_LIMITS.notes}
                placeholder="Things to include or avoid."
                onChange={(event) => onChange({ ...plan, notes: event.target.value })}
                className={`${inputClass} field-sizing-content max-h-60 min-h-16 resize-y leading-relaxed`}
              />
            </section>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Card>
            <h2 className="font-display text-xl font-bold">Your video will have</h2>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="font-semibold">
                  {plan.characters.length} character{plan.characters.length === 1 ? "" : "s"}
                </dt>
                <dd className="text-muted">
                  {castSummary(plan.characters)}
                  {plan.characters.some((c) => c.name.trim()) &&
                    `: ${plan.characters
                      .map((c) => c.name.trim())
                      .filter(Boolean)
                      .join(", ")}`}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">
                  {plan.places.length} place{plan.places.length === 1 ? "" : "s"}
                </dt>
                <dd className="text-muted">
                  {plan.places
                    .map((p) => p.name.trim())
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">About {lengthLabel(plan.lengthSec)}</dt>
                <dd className="text-muted">{SHAPE_LABELS[plan.aspectRatio]}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-xl bg-sun-soft px-3 py-2">
              About {picturesNeeded(plan)} drawings are needed: 4 for each character and 1 for each
              place. A bigger cast takes longer to draw and costs more.
            </p>
          </Card>

          {error && <ErrorNotice error={error} onRetry={submit} onUseOwnKey={props.onUseOwnKey} />}
          {submitted && errors.size > 0 && (
            <p className="font-semibold text-danger" role="alert">
              Please fill in the boxes marked in red.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
            <Button variant="primary" type="submit" loading={busy}>
              {!busy && <SparkIcon />}
              {busy ? "Writing your story…" : props.hasResult ? "Write a new story" : "Write the story"}
            </Button>
            <Button disabled={busy} onClick={props.onBack}>
              Back
            </Button>
          </div>
          <p aria-live="polite" className="text-muted">
            {busy ? "This usually takes 10 to 40 seconds." : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
