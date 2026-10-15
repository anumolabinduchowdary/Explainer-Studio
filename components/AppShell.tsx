"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { SessionUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { VIDEO_KINDS, type VideoKind } from "@/lib/schemas";
import { ApiKeyPanel } from "./ApiKeyPanel";
import Studio from "./Studio";
import { Button, KeyIcon, Logo } from "./ui";

const SECTIONS: Record<VideoKind, { label: string; hint: string }> = {
  explainer: { label: "Explainer videos", hint: "Text and pictures" },
  story: { label: "Cartoon stories", hint: "Talking characters drawn by AI" },
};

type Props = {
  /** Whether the server has its own OpenAI key. The key itself never reaches the browser. */
  hasServerKey: boolean;
  /** The signed-in person, or null when sign-in is switched off. */
  user: SessionUser | null;
  /** Whether finished videos can be posted straight to YouTube. */
  youtubeEnabled: boolean;
};

/** Page frame: header, the two sections as tabs, the API key panel and the footer. */
export default function AppShell({ hasServerKey, user, youtubeEnabled }: Props) {
  const [kind, setKind] = useState<VideoKind>("explainer");
  // "Use my own key" mode: held in memory for this session only.
  const [apiKey, setApiKey] = useState("");
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);
  const tabRefs = useRef<Partial<Record<VideoKind, HTMLButtonElement | null>>>({});

  const openKeyPanel = () => {
    setKeyPanelOpen(true);
    window.scrollTo({ top: 0 });
  };

  // Arrow keys move between tabs, as people expect from a tab list.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = VIDEO_KINDS[(VIDEO_KINDS.indexOf(kind) + step + VIDEO_KINDS.length) % VIDEO_KINDS.length];
    setKind(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <p className="flex min-w-0 items-center gap-2 font-display text-xl font-bold">
            <Logo />
            <span className="truncate">{APP_NAME}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setKeyPanelOpen((open) => !open)}
              aria-expanded={keyPanelOpen}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold transition-colors duration-200 hover:border-brand hover:text-brand-strong"
            >
              <KeyIcon />
              {apiKey ? "Using your key" : "API key"}
            </button>
            {user && (
              <form
                method="post"
                action="/api/auth/signout"
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  // Videos live in this page's memory, so leaving it loses anything not downloaded.
                  if (!window.confirm("Sign out? Any video you have not downloaded will be lost.")) {
                    event.preventDefault();
                  }
                }}
              >
                <span className="hidden max-w-48 truncate text-sm text-muted md:inline" title={user.email}>
                  {user.name ?? user.email}
                </span>
                <button
                  type="submit"
                  className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-line px-3 text-sm font-semibold transition-colors duration-200 hover:border-brand hover:text-brand-strong"
                >
                  Sign out
                  <span className="sr-only"> ({user.email})</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">
        <div
          role="tablist"
          aria-label="What do you want to make?"
          className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1"
        >
          {VIDEO_KINDS.map((option) => {
            const selected = option === kind;
            return (
              <button
                key={option}
                ref={(element) => {
                  tabRefs.current[option] = element;
                }}
                type="button"
                role="tab"
                id={`tab-${option}`}
                aria-selected={selected}
                aria-controls={`panel-${option}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setKind(option)}
                onKeyDown={onTabKeyDown}
                className={`min-h-14 rounded-xl px-2 py-1.5 text-center transition-colors duration-200 ${
                  selected ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"
                }`}
              >
                <span className="block font-display text-base font-bold sm:text-lg">
                  {SECTIONS[option].label}
                </span>
                <span className={`block text-xs sm:text-sm ${selected ? "text-white" : "text-muted"}`}>
                  {SECTIONS[option].hint}
                </span>
              </button>
            );
          })}
        </div>

        {!hasServerKey && !apiKey && !keyPanelOpen && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-sun/40 bg-sun-soft px-4 py-3">
            <p>
              <span className="font-semibold">No OpenAI key is set up yet.</span> Add your own key
              to create new videos.
            </p>
            <Button compact onClick={() => setKeyPanelOpen(true)}>
              <KeyIcon />
              Add my key
            </Button>
          </div>
        )}

        {keyPanelOpen && (
          <div className="mt-4">
            <ApiKeyPanel
              apiKey={apiKey}
              hasServerKey={hasServerKey}
              onChange={setApiKey}
              onClose={() => setKeyPanelOpen(false)}
            />
          </div>
        )}

        {VIDEO_KINDS.map((option) => (
          <div
            key={option}
            role="tabpanel"
            id={`panel-${option}`}
            aria-labelledby={`tab-${option}`}
            hidden={option !== kind}
          >
            <Studio
              kind={option}
              active={option === kind}
              apiKey={apiKey}
              youtubeEnabled={youtubeEnabled}
              onUseOwnKey={openKeyPanel}
            />
          </div>
        ))}
      </main>

      <footer className="border-t border-line bg-surface">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-muted">
          Scripts and pictures are made by AI and can contain mistakes. Please check them before
          you share a video. Videos made here are for awareness and education, not medical advice.
        </p>
      </footer>
    </>
  );
}
