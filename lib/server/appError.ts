import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { ERROR_COPY, type ErrorCode } from "@/lib/errors";

/** An error that is safe to show to the user. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(
    code: ErrorCode,
    status: number,
    options: { message?: string; retryAfterSec?: number } = {},
  ) {
    super(options.message ?? ERROR_COPY[code].message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryAfterSec = options.retryAfterSec;
  }
}

function retryAfterFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * Maps anything thrown while talking to OpenAI onto a user-safe AppError.
 * OpenAI's own error messages are never passed through: they can echo parts
 * of the API key or the request.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) {
    return new AppError("timeout", 504);
  }
  if (err instanceof APIConnectionError) return new AppError("network", 502);
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new AppError("invalid_key", 401);
  }
  if (err instanceof RateLimitError) {
    if (err.code === "insufficient_quota" || err.type === "insufficient_quota") {
      return new AppError("quota_exceeded", 402);
    }
    return new AppError("upstream_busy", 503, { retryAfterSec: retryAfterFrom(err.headers) });
  }
  if (err instanceof NotFoundError) return new AppError("model_unavailable", 500);
  if (err instanceof BadRequestError) {
    if (err.code === "model_not_found" || err.param === "model") {
      return new AppError("model_unavailable", 500);
    }
    return new AppError("server_error", 502);
  }
  if (err instanceof APIError) {
    if (typeof err.status === "number" && err.status >= 500) {
      return new AppError("upstream_busy", 503);
    }
    return new AppError("server_error", 502);
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new AppError("timeout", 504);
  }
  return new AppError("server_error", 500);
}

/** A log line with no secrets: never the key, the prompt or OpenAI's message. */
export function describeForLog(err: unknown): string {
  if (err instanceof APIError) {
    return [
      err.name,
      `status=${err.status ?? "none"}`,
      `code=${err.code ?? "none"}`,
      `type=${err.type ?? "none"}`,
      `request=${err.requestID ?? "none"}`,
    ].join(" ");
  }
  if (err instanceof AppError) return `AppError code=${err.code}`;
  if (err instanceof Error) return err.name;
  return "unknown error";
}
