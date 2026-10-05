"use client";

import { useId, useState } from "react";
import { Button, Card, inputClass } from "./ui";

type Props = {
  /** The key currently in use for this session ("" if none). */
  apiKey: string;
  hasServerKey: boolean;
  onChange: (apiKey: string) => void;
  onClose: () => void;
};

/**
 * Optional "use my own key" mode. The key lives only in React state (memory):
 * it is never written to localStorage, cookies or the URL.
 */
export function ApiKeyPanel({ apiKey, hasServerKey, onChange, onClose }: Props) {
  const inputId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const active = apiKey.length > 0;

  return (
    <Card className="mb-6 border-brand/30 bg-brand-soft">
      <section aria-labelledby={`${inputId}-title`}>
        <h2 id={`${inputId}-title`} className="font-display text-xl font-bold">
          Use your own OpenAI key
        </h2>
        <p id={helpId} className="mt-1 text-ink">
          {hasServerKey
            ? "This is optional. The app already has a key; add yours only if you want to use your own OpenAI account."
            : "This app has no OpenAI key of its own, so you need to add one to create new videos."}{" "}
          Your key stays in this page&apos;s memory only. It is sent securely with each request, used
          once and never saved. It is forgotten when you close or reload the page.
        </p>

        {active ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="font-semibold text-brand-strong" role="status">
              Your key is in use for this session.
            </p>
            <Button compact variant="danger" onClick={() => onChange("")}>
              Forget my key
            </Button>
            <Button compact variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              const key = draft.trim();
              if (!key) return;
              onChange(key);
              setDraft("");
              setVisible(false);
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor={inputId} className="mb-1 block font-semibold">
                OpenAI API key
              </label>
              <input
                id={inputId}
                type={visible ? "text" : "password"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-describedby={helpId}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="sk-..."
                className={inputClass}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                compact
                aria-pressed={visible}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? "Hide" : "Show"}
              </Button>
              <Button compact variant="primary" type="submit" disabled={!draft.trim()}>
                Use this key
              </Button>
              <Button compact variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </form>
        )}
      </section>
    </Card>
  );
}
