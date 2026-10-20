import Link from "next/link";
import type { ReactNode } from "react";
import type { Status, Verdict } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Page frame                                                          */
/* ------------------------------------------------------------------ */

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="var(--brand)" />
      <path d="M7 22l6-6 4 3 7-8" fill="none" stroke="var(--on-brand)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="8.5" r="3" fill="#F59E0B" />
    </svg>
  );
}

/** The header and the main column every page shares. */
export function Shell({ children, user, studioUrl }: { children: ReactNode; user?: { email: string } | null; studioUrl?: string | null }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-lg">
            <Logo />
            <span className="font-display text-xl font-bold leading-none">
              Video Insights
              <span className="block text-xs font-semibold text-muted">for Explainer Studio</span>
            </span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            {studioUrl && (
              <a href={studioUrl} className="rounded-lg px-2 py-2 font-semibold text-brand-strong hover:bg-brand-soft">
                Open Explainer Studio
              </a>
            )}
            {user && (
              <>
                <span className="hidden text-muted sm:inline">{user.email}</span>
                <form method="post" action="/api/auth/signout">
                  <button type="submit" className="min-h-11 rounded-lg px-3 font-semibold text-brand-strong hover:bg-brand-soft">
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}

export function Card({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={`rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6 ${className}`}>{children}</As>;
}

export const buttonClass = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-on-brand shadow-sm transition-colors hover:bg-brand-strong",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 font-semibold text-ink transition-colors hover:border-brand hover:text-brand-strong",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-bad/40 bg-surface px-5 font-semibold text-bad-text transition-colors hover:bg-bad-soft",
};

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Verdicts and statuses: always an icon and words, never colour alone */
/* ------------------------------------------------------------------ */

const VERDICTS: Record<Verdict, { label: string; className: string; icon: "up2" | "up" | "flat" | "down" | "clock" | "dash" }> = {
  viral: { label: "Going viral", className: "bg-good-soft text-good-text border-good/40", icon: "up2" },
  above: { label: "Above usual", className: "bg-good-soft text-good-text border-good/30", icon: "up" },
  usual: { label: "About usual", className: "bg-surface-2 text-ink border-line", icon: "flat" },
  below: { label: "Below usual", className: "bg-bad-soft text-bad-text border-bad/30", icon: "down" },
  early: { label: "Too early to tell", className: "bg-surface-2 text-muted border-line", icon: "clock" },
  unknown: { label: "No usual yet", className: "bg-surface-2 text-muted border-line", icon: "dash" },
};

export const verdictLabel = (verdict: Verdict) => VERDICTS[verdict].label;

function VerdictIcon({ kind }: { kind: (typeof VERDICTS)[Verdict]["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
      {kind === "up2" && (
        <>
          <path d="M3 9l5-5 5 5" {...common} />
          <path d="M3 13l5-5 5 5" {...common} />
        </>
      )}
      {kind === "up" && <path d="M3 11l5-5 5 5" {...common} />}
      {kind === "flat" && <path d="M3 8h10" {...common} />}
      {kind === "down" && <path d="M3 5l5 5 5-5" {...common} />}
      {kind === "clock" && (
        <>
          <circle cx="8" cy="8" r="5.5" {...common} />
          <path d="M8 5v3l2 1.5" {...common} />
        </>
      )}
      {kind === "dash" && <path d="M5 8h6" {...common} />}
    </svg>
  );
}

export function VerdictChip({ verdict, large = false }: { verdict: Verdict; large?: boolean }) {
  const item = VERDICTS[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${large ? "px-3 py-1.5 text-base" : "px-2.5 py-1 text-sm"} ${item.className}`}
    >
      <VerdictIcon kind={item.icon} />
      {item.label}
    </span>
  );
}

const STATUS_WORDS: Record<Status, string> = { good: "Helped", bad: "Held it back", neutral: "Worth knowing", unknown: "Not known yet" };

export function StatusMark({ status }: { status: Status }) {
  const tone =
    status === "good" ? "bg-good-soft text-good-text" : status === "bad" ? "bg-bad-soft text-bad-text" : "bg-surface-2 text-muted";
  return (
    <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${tone}`} title={STATUS_WORDS[status]}>
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        {status === "good" && <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
        {status === "bad" && <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
        {(status === "neutral" || status === "unknown") && <circle cx="8" cy="8" r="2.2" fill="currentColor" />}
      </svg>
      <span className="sr-only">{STATUS_WORDS[status]}: </span>
    </span>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-xl font-bold leading-tight">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}
