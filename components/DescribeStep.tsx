"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ErrorInfo } from "@/lib/errors";
import { EXAMPLES } from "@/lib/sample";
import { LIMITS, type VideoKind } from "@/lib/schemas";
import { ErrorNotice } from "./ErrorNotice";
import { SpeakButton } from "./SpeakButton";
import { Button, Card, SparkIcon, inputClass } from "./ui";

export type BuildOptions = {
  answers?: Array<{ question: string; answer: string }>;
  skipQuestions?: boolean;
};

const COPY: Record<VideoKind, { title: string; help: string; placeholder: string; sample: string; sampleNote: string }> = {
  explainer: {
    title: "Describe your video",
    help: "Say what it is about, who it is for and how it should feel. One or two sentences is enough.",
    placeholder:
      "e.g. A 60-second video for new parents about why tummy time matters, gentle and encouraging.",
    sample: "Open a ready-made example video",
    sampleNote: "(no key needed).",
  },
  story: {
    title: "Describe your cartoon story",
    help: "Say what it is about, who it is for and who should appear in it. The AI writes the dialogue and draws the characters.",
    placeholder:
      "e.g. A 45-second cartoon where a kind therapist shows a father three simple exercises to do with his daughter at home.",
    sample: "Open a ready-made example story",
    sampleNote: "(no key needed; the pictures are only drawn with a key).",
  },
};

type Props = {
  kind: VideoKind;
  description: string;
  onDescriptionChange: (value: string) => void;
  /** Clarifying questions from the AI, if it needs more detail. */
  questions: string[];
  busy: boolean;
  error: ErrorInfo | null;
  /** "Use my own key" mode, needed here for speech-to-text. */
  apiKey: string;
  focusHeading: boolean;
  onBuild: (options?: BuildOptions) => void;
  onRetry: () => void;
  onLoadSample: () => void;
  onUseOwnKey: () => void;
};

export function DescribeStep(props: Props) {
  const { description, onDescriptionChange, questions, busy, error } = props;
  const fieldId = useId();
  const copy = COPY[props.kind];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showLengthError, setShowLengthError] = useState(false);
  const tooShort = description.trim().length < LIMITS.descriptionMin;

  useEffect(() => {
    if (props.focusHeading) headingRef.current?.focus();
    // Only when the step first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    if (tooShort) {
      setShowLengthError(true);
      document.getElementById(fieldId)?.focus();
      return;
    }
    setShowLengthError(false);
    props.onBuild();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold sm:text-4xl">
        <label htmlFor={fieldId}>{copy.title}</label>
      </h1>
      <p id={`${fieldId}-help`} className="mt-2 text-lg text-muted">
        {copy.help}
      </p>

      <form
        className="mt-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          id={fieldId}
          value={description}
          onChange={(event) => {
            onDescriptionChange(event.target.value);
            if (showLengthError) setShowLengthError(false);
          }}
          rows={5}
          maxLength={LIMITS.description}
          aria-describedby={`${fieldId}-help ${fieldId}-count${showLengthError ? ` ${fieldId}-error` : ""}`}
          aria-invalid={showLengthError || undefined}
          placeholder={copy.placeholder}
          className={`${inputClass} field-sizing-content max-h-96 min-h-36 resize-y p-4 text-lg leading-relaxed shadow-sm`}
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-sm">
          <p id={`${fieldId}-error`} className="font-semibold text-danger" role="alert">
            {showLengthError ? "Please describe your video in a sentence or two." : ""}
          </p>
          <p id={`${fieldId}-count`} className="shrink-0 text-muted">
            {description.length} / {LIMITS.description}
          </p>
        </div>

        <div className="mt-2">
          <SpeakButton
            apiKey={props.apiKey}
            disabled={busy}
            onUseOwnKey={props.onUseOwnKey}
            onText={(spoken) => {
              // Spoken words are added after anything already typed.
              const joined = description.trim() ? `${description.trimEnd()} ${spoken}` : spoken;
              onDescriptionChange(joined.slice(0, LIMITS.description));
              setShowLengthError(false);
              document.getElementById(fieldId)?.focus();
            }}
          />
        </div>

        <div className="mt-4">
          <p className="mb-2 font-semibold" id={`${fieldId}-examples`}>
            Or start from an example:
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby={`${fieldId}-examples`}>
            {EXAMPLES[props.kind].map((example) => (
              <li key={example.label}>
                <button
                  type="button"
                  onClick={() => {
                    onDescriptionChange(example.description);
                    setShowLengthError(false);
                    document.getElementById(fieldId)?.focus();
                  }}
                  className="min-h-11 rounded-full border border-line bg-surface px-4 py-2 text-left font-semibold text-brand-strong transition-colors duration-200 hover:border-brand hover:bg-brand-soft"
                >
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {questions.length === 0 && (
          <div className="mt-6">
            <Button variant="primary" type="submit" loading={busy} className="w-full sm:w-auto">
              {!busy && <SparkIcon />}
              {busy ? "Building your prompt…" : "Build my prompt"}
            </Button>
          </div>
        )}
      </form>

      {questions.length > 0 && (
        <Questions
          key={questions.join("|")}
          questions={questions}
          busy={busy}
          onBuild={props.onBuild}
        />
      )}

      <div aria-live="polite" className="sr-only">
        {busy ? "Working on your prompt. This can take a few seconds." : ""}
      </div>

      {error && (
        <ErrorNotice
          className="mt-5"
          error={error}
          onRetry={props.onRetry}
          onUseOwnKey={props.onUseOwnKey}
        />
      )}

      <p className="mt-8 border-t border-line pt-5 text-muted">
        Just looking?{" "}
        <button
          type="button"
          onClick={props.onLoadSample}
          className="min-h-11 rounded font-semibold text-brand-strong underline underline-offset-4 hover:text-brand"
        >
          {copy.sample}
        </button>{" "}
        {copy.sampleNote}
      </p>
    </div>
  );
}

function Questions({
  questions,
  busy,
  onBuild,
}: {
  questions: string[];
  busy: boolean;
  onBuild: (options?: BuildOptions) => void;
}) {
  const baseId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Card className="mt-6 border-sun/40 bg-sun-soft">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onBuild({
            answers: questions.map((question, i) => ({ question, answer: answers[i].trim() })),
          });
        }}
      >
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold">
          A few quick questions
        </h2>
        <p className="mt-1 text-ink">
          Your answers help the AI write a better prompt. Skip any you are not sure about.
        </p>
        <ol className="mt-4 space-y-4">
          {questions.map((question, i) => (
            <li key={question}>
              <label htmlFor={`${baseId}-${i}`} className="mb-1 block font-semibold">
                {question}
              </label>
              <input
                id={`${baseId}-${i}`}
                type="text"
                value={answers[i]}
                maxLength={LIMITS.answer}
                onChange={(event) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? event.target.value : a)))
                }
                className={inputClass}
              />
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" type="submit" loading={busy}>
            {busy ? "Building your prompt…" : "Build my prompt"}
          </Button>
          <Button disabled={busy} onClick={() => onBuild({ skipQuestions: true })}>
            Skip the questions
          </Button>
        </div>
      </form>
    </Card>
  );
}
