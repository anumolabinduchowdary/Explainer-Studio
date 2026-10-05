import { CheckIcon } from "./ui";

export type Step = "describe" | "prompt" | "video";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "describe", label: "Describe" },
  { id: "prompt", label: "Prompt" },
  { id: "video", label: "Video" },
];

type Props = {
  current: Step;
  /** Steps the user can jump to (they already have the data for them). */
  available: Record<Step, boolean>;
  onSelect: (step: Step) => void;
};

export function Stepper({ current, available, onSelect }: Props) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  return (
    <nav aria-label="Steps" className="my-5">
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((step, index) => {
          const isCurrent = step.id === current;
          const done = index < currentIndex;
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                disabled={!available[step.id] || isCurrent}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-xl px-1.5 py-1.5 text-left text-sm font-semibold transition-colors duration-200 sm:gap-2 sm:px-3 sm:text-base ${
                  isCurrent
                    ? "bg-brand-soft text-brand-strong"
                    : available[step.id]
                      ? "text-ink hover:bg-brand-soft"
                      : "text-muted"
                } disabled:cursor-default`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-sm sm:size-7 [&>svg]:size-4 ${
                    isCurrent || done ? "bg-brand text-white" : "bg-line text-ink"
                  }`}
                  aria-hidden="true"
                >
                  {done ? <CheckIcon /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
              </button>
              {index < STEPS.length - 1 && (
                <span className="hidden h-0.5 w-6 shrink-0 rounded bg-line sm:block" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
