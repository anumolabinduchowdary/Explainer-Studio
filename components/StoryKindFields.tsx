"use client";

import { useId } from "react";
import { STORY_KIND_LABELS, STORY_KINDS, THERAPY_TYPES, type StoryKind } from "@/lib/plan";
import { inputClass } from "./ui";

export type ChildDetails = { name: string; age: string; look: string; helps: string };
export type TherapyDetails = { type: string; who: string; exercises: string };

export const EMPTY_CHILD: ChildDetails = { name: "", age: "", look: "", helps: "" };
export const EMPTY_THERAPY: TherapyDetails = { type: THERAPY_TYPES[0], who: "", exercises: "" };

const KIND_HINTS: Record<StoryKind, string> = {
  story: "Characters talk through a topic, with your message.",
  social: "A calm story told by the child, to prepare for a situation such as the dentist. For autistic children.",
  exercises: "A therapist's exercises turned into a video the family can follow at home.",
};

/** What the Describe step says, for each kind of cartoon video. */
export const KIND_COPY: Record<StoryKind, { title: string; help: string; placeholder: string }> = {
  story: {
    title: "Describe your cartoon story",
    help: "Say who is in it, where it happens and what it should teach. For example: 4 children in a physiotherapy centre with their physiotherapist. You can check and change the characters on the next step.",
    placeholder:
      "e.g. A 45-second cartoon with 4 children in a physiotherapy centre and their physiotherapist, showing that exercises can be fun.",
  },
  social: {
    title: "Describe the situation",
    help: "What will the child do or face? For example: going to the dentist, a haircut, the first day at a new school. The story is calm, literal and told from the child's point of view.",
    placeholder: "e.g. Going to the dentist for a check-up for the first time.",
  },
  exercises: {
    title: "Describe the programme",
    help: "What is it for? Then list the exercises below exactly as you would explain them to the family. Nothing is added or changed.",
    placeholder: "e.g. Daily leg-strengthening exercises after surgery, to do together at home.",
  },
};

type Props = {
  kind: StoryKind;
  onKindChange: (kind: StoryKind) => void;
  child: ChildDetails;
  onChildChange: (child: ChildDetails) => void;
  therapy: TherapyDetails;
  onTherapyChange: (therapy: TherapyDetails) => void;
  disabled: boolean;
  /** Shown under the exercises box when it is missing. */
  exercisesError?: string;
};

/** The choice of cartoon video, and the extra details a Social Story or exercise programme needs. */
export function StoryKindPicker({ kind, onKindChange, disabled }: Pick<Props, "kind" | "onKindChange" | "disabled">) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="mb-5">
      <legend className="mb-2 font-semibold">What would you like to make?</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STORY_KINDS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={`${id}-kind`}
              value={option}
              checked={kind === option}
              onChange={() => onKindChange(option)}
              className="peer sr-only"
            />
            <span className="flex h-full min-h-11 flex-col rounded-xl border border-line bg-surface px-3 py-2 transition-colors duration-200 hover:border-brand peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
              <span className="font-semibold">{STORY_KIND_LABELS[option]}</span>
              <span className="text-sm text-muted">{KIND_HINTS[option]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StoryKindFields(props: Props) {
  const id = useId();
  if (props.kind === "social") {
    const set = (patch: Partial<ChildDetails>) => props.onChildChange({ ...props.child, ...patch });
    return (
      <fieldset disabled={props.disabled} className="mt-4 rounded-2xl border border-line bg-surface p-3">
        <legend className="px-1 font-semibold">The child this story is for</legend>
        <p className="text-sm text-muted">
          Only a first name is needed. No photo is used: the child is drawn as a cartoon from your words.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block font-semibold">
              First name
            </label>
            <input id={`${id}-name`} type="text" maxLength={40} value={props.child.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${id}-age`} className="mb-1 block font-semibold">
              Age
            </label>
            <input id={`${id}-age`} type="text" maxLength={20} value={props.child.age} placeholder="e.g. 6" onChange={(event) => set({ age: event.target.value })} className={inputClass} />
          </div>
        </div>
        <label htmlFor={`${id}-look`} className="mb-1 mt-3 block font-semibold">
          How the child looks
        </label>
        <textarea
          id={`${id}-look`}
          rows={2}
          maxLength={300}
          value={props.child.look}
          placeholder="e.g. Short curly black hair, round glasses, loves a red T-shirt with a rocket on it."
          onChange={(event) => set({ look: event.target.value })}
          className={`${inputClass} field-sizing-content min-h-16 resize-y`}
        />
        <label htmlFor={`${id}-helps`} className="mb-1 mt-3 block font-semibold">
          What helps <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={`${id}-helps`}
          type="text"
          maxLength={300}
          value={props.child.helps}
          placeholder="e.g. holding his toy dinosaur, ear defenders, counting to ten"
          onChange={(event) => set({ helps: event.target.value })}
          className={inputClass}
        />
      </fieldset>
    );
  }
  if (props.kind === "exercises") {
    const set = (patch: Partial<TherapyDetails>) => props.onTherapyChange({ ...props.therapy, ...patch });
    return (
      <fieldset disabled={props.disabled} className="mt-4 rounded-2xl border border-line bg-surface p-3">
        <legend className="px-1 font-semibold">The programme</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-type`} className="mb-1 block font-semibold">
              Therapy
            </label>
            <select id={`${id}-type`} value={props.therapy.type} onChange={(event) => set({ type: event.target.value })} className={`${inputClass} min-h-11`}>
              {THERAPY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-who`} className="mb-1 block font-semibold">
              Who it is for <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id={`${id}-who`} type="text" maxLength={80} value={props.therapy.who} placeholder="e.g. Aarav, 6, uses a walker" onChange={(event) => set({ who: event.target.value })} className={inputClass} />
          </div>
        </div>
        <label htmlFor={`${id}-exercises`} className="mb-1 mt-3 block font-semibold">
          The exercises
        </label>
        <p id={`${id}-exercises-hint`} className="text-sm text-muted">
          One per line: the name, how to do it, and how many times or how long. Add any safety note.
        </p>
        <textarea
          id={`${id}-exercises`}
          rows={6}
          maxLength={3000}
          value={props.therapy.exercises}
          aria-invalid={props.exercisesError ? true : undefined}
          aria-describedby={`${id}-exercises-hint${props.exercisesError ? ` ${id}-exercises-error` : ""}`}
          placeholder={"Bridge: lie on your back, knees bent, lift your hips and hold for 5 seconds. 10 times.\nSit to stand: from a chair, stand up without using hands. 8 times, 2 rounds."}
          onChange={(event) => set({ exercises: event.target.value })}
          className={`${inputClass} mt-1 field-sizing-content min-h-32 resize-y leading-relaxed ${props.exercisesError ? "border-danger" : ""}`}
        />
        {props.exercisesError && (
          <p id={`${id}-exercises-error`} className="mt-1 font-semibold text-danger" role="alert">
            {props.exercisesError}
          </p>
        )}
      </fieldset>
    );
  }
  return null;
}
