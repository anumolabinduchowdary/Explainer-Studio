"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo } from "@/lib/errors";
import { PROMPT_STEPS, assemblePrompt, type PromptStepKey } from "@/lib/prompt";
import { FiveStepPromptSchema, LIMITS, type FiveStepPrompt, type VideoKind } from "@/lib/schemas";
import { ErrorNotice } from "./ErrorNotice";
import { Button, Card, CheckIcon, CopyIcon, SparkIcon, inputClass } from "./ui";

type Props = {
  prompt: FiveStepPrompt;
  onChange: (prompt: FiveStepPrompt) => void;
  busy: boolean;
  error: ErrorInfo | null;
  /** What step 3 makes: a storyboard (explainer) or a story (cartoon). */
  kind: VideoKind;
  /** True once step 3 has been generated at least once. */
  hasResult: boolean;
  onBack: () => void;
  onGenerate: () => void;
  onUseOwnKey: () => void;
};

type FieldErrors = Partial<Record<PromptStepKey, string>>;

function validate(prompt: FiveStepPrompt): FieldErrors {
  const result = FiveStepPromptSchema.safeParse(prompt);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as PromptStepKey;
    errors[key] ??= issue.message;
  }
  return errors;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to a hidden text box.
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

export function PromptStep(props: Props) {
  const { prompt, onChange, busy, error } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [touched, setTouched] = useState<Partial<Record<PromptStepKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const noun = props.kind === "story" ? "story" : "storyboard";
  const errors = useMemo(() => validate(prompt), [prompt]);
  const assembled = useMemo(() => assemblePrompt(prompt), [prompt]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);

  const submit = () => {
    setSubmitted(true);
    const firstInvalid = PROMPT_STEPS.find((step) => errors[step.key]);
    if (firstInvalid) {
      document.getElementById(`prompt-${firstInvalid.key}`)?.focus();
      return;
    }
    props.onGenerate();
  };

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold sm:text-4xl">
        Review your prompt
      </h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        The AI follows these five parts to write your {noun}. Change anything you like.
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
          {PROMPT_STEPS.map((step, index) => {
            const id = `prompt-${step.key}`;
            const message = (submitted || touched[step.key]) && errors[step.key];
            return (
              <Card key={step.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <label htmlFor={id} className="font-display text-xl font-bold">
                    <span className="text-brand-strong">{index + 1}.</span> {step.label}
                  </label>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                      step.required ? "bg-brand-soft text-brand-strong" : "bg-sun-soft text-ink"
                    }`}
                  >
                    {step.required ? "Required" : "Optional"}
                  </span>
                </div>
                <p id={`${id}-hint`} className="mt-0.5 text-muted">
                  {step.hint}
                </p>
                <textarea
                  id={id}
                  value={prompt[step.key]}
                  rows={step.rows}
                  maxLength={LIMITS.field}
                  required={step.required}
                  aria-required={step.required}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
                  placeholder={step.placeholder}
                  onChange={(event) => onChange({ ...prompt, [step.key]: event.target.value })}
                  onBlur={() => setTouched((prev) => ({ ...prev, [step.key]: true }))}
                  className={`${inputClass} mt-2 field-sizing-content max-h-96 min-h-20 resize-y leading-relaxed ${
                    message ? "border-danger" : ""
                  }`}
                />
                {message && (
                  <p id={`${id}-error`} className="mt-1 font-semibold text-danger" role="alert">
                    {message}
                  </p>
                )}
              </Card>
            );
          })}
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold">Prompt preview</h2>
              <Button
                compact
                onClick={async () => setCopyState((await copyText(assembled)) ? "copied" : "failed")}
              >
                {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
                {copyState === "copied" ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-0.5 text-muted">
              The exact text sent to OpenAI as your prompt. Our fixed safety and format rules are
              sent alongside it.
            </p>
            <pre
              tabIndex={0}
              aria-label="Assembled prompt"
              className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-canvas p-3 font-mono text-sm leading-relaxed text-ink"
            >
              {assembled || "Your prompt will appear here."}
            </pre>
            <p aria-live="polite" className="sr-only">
              {copyState === "copied" ? "Prompt copied." : ""}
              {copyState === "failed" ? "Could not copy. Please select the text and copy it." : ""}
            </p>
            {copyState === "failed" && (
              <p className="mt-2 font-semibold text-danger">
                Could not copy. Please select the text and copy it.
              </p>
            )}
          </Card>

          {error && (
            <ErrorNotice error={error} onRetry={submit} onUseOwnKey={props.onUseOwnKey} />
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
            <Button variant="primary" type="submit" loading={busy}>
              {!busy && <SparkIcon />}
              {busy
                ? `Writing your ${noun}…`
                : props.hasResult
                  ? `Generate a new ${noun}`
                  : `Generate ${noun}`}
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
