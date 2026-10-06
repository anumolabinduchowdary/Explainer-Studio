import { ERROR_COPY, type ErrorCode, type ErrorInfo } from "@/lib/errors";
import { Button } from "./ui";

/** Errors that a different API key can fix. */
const KEY_ERRORS: ReadonlySet<ErrorCode> = new Set(["missing_key", "invalid_key", "quota_exceeded"]);
/** Errors where pressing "Try again" without changing anything will not help. */
const NO_RETRY: ReadonlySet<ErrorCode> = new Set([
  "invalid_input",
  "moderation_flagged",
  "missing_key",
  "server_misconfigured",
  "insecure_transport",
  "voice_key_invalid",
]);

type Props = {
  error: ErrorInfo;
  onRetry?: () => void;
  onUseOwnKey?: () => void;
  className?: string;
};

export function ErrorNotice({ error, onRetry, onUseOwnKey, className = "" }: Props) {
  const copy = ERROR_COPY[error.code];
  const canRetry = onRetry && !NO_RETRY.has(error.code);
  const offerKey = onUseOwnKey && KEY_ERRORS.has(error.code);

  return (
    <div
      role="alert"
      className={`rounded-2xl border border-danger/30 bg-danger-soft p-4 ${className}`}
    >
      <p className="font-bold text-danger">{copy.title}</p>
      <p className="mt-1 text-ink">
        {error.message}
        {error.retryAfterSec ? ` You can try again in about ${error.retryAfterSec} seconds.` : ""}
      </p>
      {(canRetry || offerKey) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canRetry && (
            <Button compact onClick={onRetry}>
              Try again
            </Button>
          )}
          {offerKey && (
            <Button compact onClick={onUseOwnKey}>
              Use my own key
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
