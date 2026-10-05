import "server-only";
import type { z } from "zod";
import { USER_KEY_HEADER } from "@/lib/config";
import type { ApiErrorBody } from "@/lib/errors";
import { AppError, describeForLog, toAppError } from "./appError";
import { createClient, type OpenAIClient } from "./openai";
import { clientIp, rateLimit, requestsPerMinute } from "./rateLimit";

const DEFAULT_MAX_BODY_CHARS = 100_000;
/** Kept under the routes' maxDuration (60s) so we can answer before the platform cuts us off. */
const DEFAULT_DEADLINE_MS = 55_000;

type Context<Body> = {
  body: Body;
  client: OpenAIClient;
  signal: AbortSignal;
};

type HandlerConfig<Schema extends z.ZodType> = {
  /** Used in log lines only. */
  route: string;
  schema: Schema;
  run: (context: Context<z.infer<Schema>>) => Promise<object>;
  /** Tests can inject a fake OpenAI client. */
  clientFactory?: (apiKey: string) => OpenAIClient;
  /** Routes that share a name share one per-IP allowance. Default: "text". */
  rateLimit?: { bucket: string; perMinute: () => number };
  /** How long the route may run. Must stay under its `maxDuration`. */
  deadlineMs?: number;
  maxBodyChars?: number;
};

/**
 * Wraps a route with everything every OpenAI-backed endpoint needs:
 * per-IP rate limiting, body validation, API key resolution and safe errors.
 */
export function createPostHandler<Schema extends z.ZodType>(config: HandlerConfig<Schema>) {
  return async function POST(req: Request): Promise<Response> {
    try {
      const bucket = config.rateLimit?.bucket ?? "text";
      const perMinute = (config.rateLimit?.perMinute ?? requestsPerMinute)();
      const limit = rateLimit(`${bucket}:${clientIp(req)}`, perMinute, 60_000);
      if (!limit.ok) {
        throw new AppError("rate_limited", 429, { retryAfterSec: limit.retryAfterSec });
      }

      const body = await readBody(req, config.schema, config.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS);
      const apiKey = resolveApiKey(req);
      const client = (config.clientFactory ?? createClient)(apiKey);
      const signal = AbortSignal.any([
        req.signal,
        AbortSignal.timeout(config.deadlineMs ?? DEFAULT_DEADLINE_MS),
      ]);

      const result = await config.run({ body, client, signal });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      const appError = toAppError(err);
      // Deliberately terse: never log the key, the request body or OpenAI's message.
      console.error(`[${config.route}] ${appError.code} (${appError.status}) ${describeForLog(err)}`);

      const payload: ApiErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.retryAfterSec ? { retryAfterSec: appError.retryAfterSec } : {}),
        },
      };
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (appError.retryAfterSec) headers["Retry-After"] = String(appError.retryAfterSec);
      return Response.json(payload, { status: appError.status, headers });
    }
  };
}

async function readBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
  maxChars: number,
): Promise<z.infer<Schema>> {
  const raw = await req.text();
  if (raw.length > maxChars) {
    throw new AppError("invalid_input", 413, { message: "That request is too large." });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AppError("invalid_input", 400, { message: "The request was not valid JSON." });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Messages we wrote ourselves are shown as they are. Zod's built-in ones
    // are technical, so they are replaced with a plain sentence.
    const builtIn = !issue || /^(Invalid|Too (small|big)|Unrecognized)/.test(issue.message);
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new AppError("invalid_input", 400, {
      message: builtIn
        ? `Part of the request isn't valid${where}. Please reload the page and try again.`
        : issue.message,
    });
  }
  return parsed.data;
}

/**
 * A key the visitor supplied for this one request wins; otherwise the server's
 * own key is used. A visitor's key is only ever held in a local variable here:
 * it is not stored, logged or sent anywhere except OpenAI.
 */
function resolveApiKey(req: Request): string {
  const userKey = req.headers.get(USER_KEY_HEADER)?.trim();
  if (userKey) {
    if (!isSecure(req)) throw new AppError("insecure_transport", 400);
    if (!/^[\x21-\x7E]{20,400}$/.test(userKey)) throw new AppError("invalid_key", 401);
    return userKey;
  }
  const serverKey = process.env.OPENAI_API_KEY?.trim();
  if (!serverKey) throw new AppError("missing_key", 401);
  return serverKey;
}

function isSecure(req: Request): boolean {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  if (proto === "https") return true;
  // Plain HTTP is fine on your own machine during development.
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
