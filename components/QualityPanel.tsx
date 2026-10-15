"use client";

import { useId } from "react";
import type { FactsState } from "@/lib/checks";
import { Button } from "./ui";

export type PictureSummary = {
  total: number;
  drawn: number;
  checked: number;
  redrawn: number;
  /** Drawings that still do not match after the redraws. */
  problems: Array<{ name: string; problems: string[] }>;
};

export type VoiceSummary = {
  total: number;
  recorded: number;
  checked: number;
  retried: number;
  /** Lines whose words were still not heard as written. */
  unclear: Array<{ who: string; text: string }>;
};

type Props = {
  facts: FactsState;
  /** True when the words changed after the last fact check. */
  factsOutOfDate: boolean;
  pictures?: PictureSummary;
  voices?: VoiceSummary;
  onCheckFacts: () => void;
};

type Tone = "good" | "fixed" | "warn" | "wait";
const TONE: Record<Tone, { mark: string; className: string; label: string }> = {
  good: { mark: "✓", className: "bg-brand text-white", label: "Done" },
  fixed: { mark: "✓", className: "bg-brand text-white", label: "Done, with fixes" },
  warn: { mark: "!", className: "bg-sun text-ink", label: "Needs attention" },
  wait: { mark: "…", className: "bg-line text-ink", label: "Not done yet" },
};

function Row({ tone, title, children }: { tone: Tone; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${TONE[tone].className}`}
        aria-hidden="true"
      >
        {TONE[tone].mark}
      </span>
      <div className="min-w-0">
        <p className="font-semibold">
          {title} <span className="sr-only">({TONE[tone].label})</span>
        </p>
        <div className="text-muted">{children}</div>
      </div>
    </li>
  );
}

/**
 * What was checked automatically before posting: the facts and wording, every
 * drawing and every recorded line. When everything passes, the video is
 * ready to post as it is.
 */
export function QualityPanel({ facts, factsOutOfDate, pictures, voices, onCheckFacts }: Props) {
  const id = useId();
  const factsTone: Tone =
    facts.status === "checked" && !factsOutOfDate
      ? facts.result.changes.length
        ? "fixed"
        : "good"
      : facts.status === "failed"
        ? "warn"
        : "wait";
  const pictureTone: Tone | null = pictures
    ? pictures.drawn < pictures.total
      ? "wait"
      : pictures.problems.length
        ? "warn"
        : pictures.redrawn
          ? "fixed"
          : "good"
    : null;
  const voiceTone: Tone | null = voices
    ? voices.recorded < voices.total
      ? "wait"
      : voices.unclear.length
        ? "warn"
        : voices.retried
          ? "fixed"
          : "good"
    : null;
  const tones = [factsTone, pictureTone, voiceTone].filter((tone): tone is Tone => tone !== null);
  const ready = tones.every((tone) => tone === "good" || tone === "fixed");
  const attention = tones.includes("warn");

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold">
          Quality check
        </h2>
        <span
          role="status"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            ready ? "bg-brand-soft text-brand-strong" : attention ? "bg-sun-soft text-ink" : "bg-canvas text-muted"
          }`}
        >
          {ready ? "Ready to post" : attention ? "Needs attention" : "In progress"}
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        <Row tone={factsTone} title="Facts and wording">
          {facts.status === "checking" && <p>Checking the facts…</p>}
          {facts.status === "none" && <p>Not checked yet.</p>}
          {facts.status === "failed" && <p>The check could not be done: {facts.message}</p>}
          {facts.status === "checked" && (
            <>
              <p>
                {facts.result.checked} {facts.result.checked === 1 ? "piece" : "pieces"} of text checked
                {facts.result.changes.length
                  ? `, ${facts.result.changes.length} fixed automatically.`
                  : ", no problems found."}
                {factsOutOfDate ? " The words have changed since, so check again." : ""}
              </p>
              {facts.result.changes.length > 0 && (
                <details className="mt-1">
                  <summary className="min-h-11 cursor-pointer content-center font-semibold text-brand-strong">
                    What was changed
                  </summary>
                  <ul className="space-y-2 text-sm">
                    {facts.result.changes.map((change) => (
                      <li key={change.key} className="rounded-lg bg-canvas p-2">
                        <p className="text-ink">{change.reason}</p>
                        <p className="mt-1 line-through decoration-danger/60">{change.before}</p>
                        <p className="text-ink">{change.after}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {facts.result.sources.length > 0 && (
                <p className="mt-1 text-sm">
                  Sources added to the description:{" "}
                  {facts.result.sources.map((source, i) => (
                    <span key={source.url}>
                      {i > 0 ? ", " : ""}
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand-strong underline underline-offset-2">
                        {source.name}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
          {facts.status !== "checking" && (facts.status !== "checked" || factsOutOfDate) && (
            <Button compact className="mt-2" onClick={onCheckFacts}>
              {facts.status === "none" ? "Check the facts" : "Check again"}
            </Button>
          )}
        </Row>

        {pictures && pictureTone && (
          <Row tone={pictureTone} title="Pictures">
            <p>
              {pictures.drawn < pictures.total
                ? `${pictures.drawn} of ${pictures.total} drawn.`
                : `${pictures.checked} of ${pictures.total} compared with their descriptions${
                    pictures.redrawn ? `, ${pictures.redrawn} redrawn automatically` : ""
                  }.`}
            </p>
            {pictures.problems.map((item) => (
              <p key={item.name} className="mt-1 text-sm text-ink">
                {item.name}: {item.problems.join(" ")} Redraw it, or change its description.
              </p>
            ))}
          </Row>
        )}

        {voices && voiceTone && (
          <Row tone={voiceTone} title="Voices">
            <p>
              {voices.recorded < voices.total
                ? `${voices.recorded} of ${voices.total} lines recorded.`
                : `${voices.checked} of ${voices.total} lines listened back${
                    voices.retried ? `, ${voices.retried} recorded again automatically` : ""
                  }.`}
            </p>
            {voices.unclear.map((line, i) => (
              <p key={i} className="mt-1 text-sm text-ink">
                {line.who}: &ldquo;{line.text}&rdquo; may not be clear. Listen to it, or try another voice.
              </p>
            ))}
          </Row>
        )}
      </ul>
    </section>
  );
}
