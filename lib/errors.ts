/** Error codes shared by the API routes and the browser. */
export const ERROR_CODES = [
  "invalid_input",
  "moderation_flagged",
  "rate_limited",
  "missing_key",
  "invalid_key",
  "quota_exceeded",
  "upstream_busy",
  "timeout",
  "network",
  "model_unavailable",
  "server_misconfigured",
  "bad_model_output",
  "refused",
  "insecure_transport",
  "server_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorInfo = {
  code: ErrorCode;
  message: string;
  retryAfterSec?: number;
};

export type ApiErrorBody = { error: ErrorInfo };

/** Friendly, plain-language copy for every error state. */
export const ERROR_COPY: Record<ErrorCode, { title: string; message: string }> = {
  invalid_input: {
    title: "Please check what you typed",
    message: "Something in the form isn't quite right. Please review it and try again.",
  },
  moderation_flagged: {
    title: "We can't make a video from this",
    message:
      "This text may break OpenAI's content rules. Please reword it and try again.",
  },
  rate_limited: {
    title: "Slow down a little",
    message: "You've made a lot of requests. Please wait a moment and try again.",
  },
  missing_key: {
    title: "An OpenAI key is needed",
    message:
      "This app doesn't have an OpenAI key set up. Add your own key to continue.",
  },
  invalid_key: {
    title: "That OpenAI key didn't work",
    message:
      "OpenAI rejected the key. Check that it is correct, still active and allowed to use this model.",
  },
  quota_exceeded: {
    title: "The OpenAI account is out of credit",
    message:
      "The key has reached its usage limit. Add credit in the OpenAI dashboard or use a different key.",
  },
  upstream_busy: {
    title: "OpenAI is busy right now",
    message: "OpenAI couldn't take the request. Please wait a few seconds and try again.",
  },
  timeout: {
    title: "That took too long",
    message: "The request timed out. Please try again. Shorter videos are quicker to write.",
  },
  network: {
    title: "Connection problem",
    message: "We couldn't reach the server. Check your internet connection and try again.",
  },
  model_unavailable: {
    title: "The AI model isn't available",
    message:
      "A model named in the server settings could not be used. Check OPENAI_TEXT_MODEL and OPENAI_IMAGE_MODEL.",
  },
  server_misconfigured: {
    title: "The app isn't fully set up",
    message: "A required setting is missing on the server. Add it, then redeploy or restart the app.",
  },
  bad_model_output: {
    title: "The AI's answer didn't come out right",
    message: "We asked twice and couldn't use the result. Please try again.",
  },
  refused: {
    title: "The AI declined this request",
    message: "Try rewording your description and generating again.",
  },
  insecure_transport: {
    title: "A secure connection is needed",
    message: "Your own key can only be sent over HTTPS. Open the site with https:// and try again.",
  },
  server_error: {
    title: "Something went wrong",
    message: "An unexpected error happened. Please try again in a moment.",
  },
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
