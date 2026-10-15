"use client";

import { useId, useState } from "react";
import type { ErrorInfo } from "@/lib/errors";
import { languageLabel } from "@/lib/languages";
import { ErrorNotice } from "./ErrorNotice";
import { LanguagePicker } from "./LanguagePicker";
import { Button } from "./ui";

type Props = {
  /** The language of what is showing now. */
  current: string;
  /** Every language this video has been made in so far, the current one included. */
  versions: string[];
  busy: boolean;
  error: ErrorInfo | null;
  /** True while the video is being recorded. */
  disabled: boolean;
  /** Cartoon stories: the voices are recorded again in the new language. */
  hasVoices: boolean;
  onTranslate: (language: string) => void;
  onSwitch: (language: string) => void;
  onUseOwnKey: () => void;
};

/** Shows the video's language, and makes or switches to versions in other languages. */
export function LanguagePanel(props: Props) {
  const id = useId();
  const [target, setTarget] = useState("");
  const wanted = target.trim();
  const already = props.versions.some((name) => name.toLowerCase() === wanted.toLowerCase());

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="font-display text-2xl font-bold">
        Language
      </h2>
      <p className="mt-0.5 text-muted">
        This video is in <span className="font-semibold text-ink">{languageLabel(props.current)}</span>.
        Make a version in another language: the pictures stay the same
        {props.hasVoices ? " and the voices are recorded again in the new language" : ""}.
      </p>

      {props.versions.length > 1 && (
        <div className="mt-3">
          <p className="mb-1 font-semibold" id={`${id}-versions`}>
            Versions
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-versions`}>
            {props.versions.map((name) => {
              const showing = name === props.current;
              return (
                <Button
                  key={name}
                  compact
                  variant={showing ? "primary" : "secondary"}
                  aria-pressed={showing}
                  disabled={props.disabled || props.busy}
                  onClick={() => props.onSwitch(name)}
                >
                  {languageLabel(name)}
                </Button>
              );
            })}
          </div>
          <p className="mt-1 text-sm text-muted">
            Download each version before you leave this page; versions are not saved.
          </p>
        </div>
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (wanted && !already) props.onTranslate(wanted);
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <LanguagePicker
            id={`${id}-target`}
            label="Make it in"
            value={target}
            onChange={setTarget}
            disabled={props.disabled || props.busy}
          />
        </div>
        <Button type="submit" loading={props.busy} disabled={props.disabled || !wanted || already}>
          {props.busy ? "Translating…" : "Translate"}
        </Button>
      </form>
      {already && wanted && (
        <p className="mt-1 text-sm text-muted">There is already a {languageLabel(wanted)} version.</p>
      )}
      <p aria-live="polite" className="sr-only">
        {props.busy ? "Translating the video. This can take up to a minute." : ""}
      </p>
      {props.error && (
        <ErrorNotice
          className="mt-3"
          error={props.error}
          onRetry={() => wanted && props.onTranslate(wanted)}
          onUseOwnKey={props.onUseOwnKey}
        />
      )}
    </section>
  );
}
