import type { ButtonHTMLAttributes, ReactNode, SVGProps } from "react";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-sm hover:bg-brand-strong",
  secondary: "border border-line bg-surface text-ink hover:border-brand hover:text-brand-strong",
  ghost: "text-brand-strong hover:bg-brand-soft",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  /** Smaller padding; still a 44px touch target. */
  compact?: boolean;
};

export function Button({
  variant = "secondary",
  loading = false,
  compact = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-200 disabled:opacity-50 ${
        compact ? "px-3 text-sm" : "px-5 text-base"
      } ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A square button that shows only an icon; `label` is read by screen readers. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink transition-colors duration-200 hover:bg-brand-soft hover:text-brand-strong disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted/70 transition-colors duration-200 hover:border-muted/60 focus:border-brand";

/* ------------------------------------------------------------------ */
/* Icons (one consistent 24px stroke set)                              */
/* ------------------------------------------------------------------ */

function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </Icon>
);
export const PauseIcon = () => (
  <Icon>
    <path d="M8 5v14M16 5v14" strokeWidth="3" />
  </Icon>
);
export const RestartIcon = () => (
  <Icon>
    <path d="M4 4v6h6" />
    <path d="M4.5 10a8 8 0 1 1-.5 4" />
  </Icon>
);
export const UpIcon = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const DownIcon = () => (
  <Icon>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const SparkIcon = () => (
  <Icon>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16v4M17 18h4" />
  </Icon>
);
export const KeyIcon = () => (
  <Icon>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8-8M16 7l3 3" />
  </Icon>
);
export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Icon>
);
export const RefreshIcon = () => (
  <Icon>
    <path d="M20 5v5h-5M4 19v-5h5" />
    <path d="M19 10a7.5 7.5 0 0 0-13.5-2M5 14a7.5 7.5 0 0 0 13.5 2" />
  </Icon>
);
export const RecordIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" />
  </Icon>
);
export const ShareIcon = () => (
  <Icon>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" />
  </Icon>
);
export const MicIcon = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
