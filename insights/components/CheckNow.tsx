"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * "Checked 12 minutes ago · Check now". When the report is old, opening it
 * starts a check by itself and shows the new numbers when they arrive.
 */
export function CheckNow({ videoId, checkedLabel, stale, canCheck }: { videoId: string; checkedLabel: string; stale: boolean; canCheck: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const started = useRef(false);

  const check = async (manual: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual }),
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; fresh?: boolean; message?: string };
      if (result.ok && !result.fresh) startRefresh(() => router.refresh());
      else if (!result.ok && (manual || result.message)) setMessage(result.message ?? "The check could not run. Please try again.");
    } catch {
      if (manual) setMessage("Video Insights could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!stale || !canCheck || started.current) return;
    started.current = true;
    void check(false);
    // Runs once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const working = busy || refreshing;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-muted" aria-live="polite">
        {working ? "Getting the latest numbers from YouTube…" : checkedLabel}
      </span>
      {canCheck && (
        <button
          type="button"
          onClick={() => void check(true)}
          disabled={working}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 font-semibold hover:border-brand hover:text-brand-strong disabled:opacity-50"
        >
          {working && (
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          Check now
        </button>
      )}
      {message && (
        <p role="alert" className="w-full font-semibold text-bad-text">
          {message}
        </p>
      )}
    </div>
  );
}
