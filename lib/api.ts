import type { z } from "zod";
import { USER_KEY_HEADER } from "./config";
import { ERROR_COPY, isErrorCode, type ErrorCode, type ErrorInfo } from "./errors";

/** An error from one of our API routes, already in a form the UI can show. */
export class ApiError extends Error {
  readonly info: ErrorInfo;
  constructor(code: ErrorCode, message?: string, retryAfterSec?: number) {
    super(message ?? ERROR_COPY[code].message);
    this.name = "ApiError";
    this.info = { code, message: this.message, retryAfterSec };
  }
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) return err.info;
  return { code: "server_error", message: ERROR_COPY.server_error.message };
}

type PostOptions = {
  /** "Use my own key" mode: sent as a header for this request only. */
  apiKey?: string;
  timeoutMs?: number;
};

/**
 * POSTs JSON to one of our own API routes and validates the answer.
 * Every failure (network, timeout, HTTP error, bad shape) becomes an ApiError.
 */
export async function postJson<Schema extends z.ZodType>(
  path: string,
  body: unknown,
  schema: Schema,
  options: PostOptions = {},
): Promise<z.infer<Schema>> {
  const { apiKey, timeoutMs = 70_000 } = options;

  if (apiKey && !isSecureOrigin()) throw new ApiError("insecure_transport");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ApiError("network");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { [USER_KEY_HEADER]: apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON (for example a gateway timeout page); handled below.
  }

  if (!response.ok) {
    const error = (json as { error?: Partial<ErrorInfo> } | null)?.error;
    if (error && isErrorCode(error.code)) {
      throw new ApiError(error.code, error.message, error.retryAfterSec);
    }
    if (response.status === 504 || response.status === 408) throw new ApiError("timeout");
    if (response.status === 429) throw new ApiError("rate_limited");
    throw new ApiError("server_error");
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError("bad_model_output");
  return parsed.data;
}

function isSecureOrigin(): boolean {
  if (typeof window === "undefined") return true;
  const { protocol, hostname } = window.location;
  return protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
