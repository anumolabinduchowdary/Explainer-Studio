"use client";

import { useState } from "react";
import { LANGUAGE_MAX, VIDEO_LANGUAGES, languageLabel } from "@/lib/languages";
import { inputClass } from "./ui";

type Props = {
  id: string;
  label: string;
  /** A language name such as "Hindi", or "" for none chosen. */
  value: string;
  onChange: (value: string) => void;
  /** When set, an extra first choice that means "no particular language", e.g. "Same as I write". */
  autoLabel?: string;
  hint?: string;
  disabled?: boolean;
};

const OTHER = "__other";

/** Choose a language from the list, or type another one. */
export function LanguagePicker({ id, label, value, onChange, autoLabel, hint, disabled }: Props) {
  const known = VIDEO_LANGUAGES.find((language) => language.name.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(!known && value.trim() !== "");
  const selected = typing ? OTHER : (known?.name ?? "");

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={selected}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setTyping(next === OTHER);
          onChange(next === OTHER ? "" : next);
        }}
        className={`${inputClass} min-h-11`}
      >
        {autoLabel !== undefined ? (
          <option value="">{autoLabel}</option>
        ) : (
          <option value="" disabled>
            Choose a language
          </option>
        )}
        {VIDEO_LANGUAGES.map((language) => (
          <option key={language.name} value={language.name}>
            {languageLabel(language.name)}
          </option>
        ))}
        <option value={OTHER}>Another language…</option>
      </select>
      {typing && (
        <input
          type="text"
          value={value}
          disabled={disabled}
          maxLength={LANGUAGE_MAX}
          aria-label={`${label}: the language's name`}
          placeholder="e.g. Assamese, Urdu or Spanish"
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} mt-2`}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
