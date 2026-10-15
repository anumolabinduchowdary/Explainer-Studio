import "server-only";
import type { z } from "zod";
import type { ApiErrorBody } from "@/lib/errors";
import { AppError, describeForLog, toAppError } from "../appError";
import { clientIp, rateLimit } from "../rateLimit";
import { authConfig, type AuthConfig } from "./config";
import { assertSameOrigin } from "./session";

/**
 * How much one IP address may do, as [requests, milliseconds] windows. Sending
 * email is the tightest, so the app cannot be used to flood people with codes;
 * the limits still leave room for a classroom signing in from one connection.
 */
const IP_LIMITS = {
  send: [
    [10, 60_000],
    [60, 60 * 60_000],
  ],
  check: [[30, 60_000]],
  google: [[30, 60_000]],
} as const;
export type AuthAction = keyof typeof IP_LIMITS;

export function limitByIp(req: Request, action: AuthAction): void {
  const ip = clientIp(req);
  for (const [requests, windowMs] of IP_LIMITS[action]) {
    const limit = rateLimit(`auth-${action}-${windowMs}:${ip}`, requests, windowMs);
    if (!limit.ok) throw new AppError("rate_limited", 429, { retryAfterSec: limit.retryAfterSec });
  }
}

/** Sign-in settings for a sign-in route; these routes do not exist while sign-in is switched off. */
export function activeAuthConfig(): AuthConfig {
  const config = authConfig();
  if (!config) throw new AppError("invalid_input", 404, { message: "Sign-in is not switched on for this app." });
  return config;
}

type Result = { body: object; cookies?: string[] };

/**
 * A POST route used while signing in: rate limited, same-site only, body
 * checked, and errors turned into plain messages. Nothing about the request
 * (email address, code, cookies) is ever logged.
 */
export function createAuthPostHandler<Schema extends z.ZodType>(
  route: string,
  action: AuthAction,
  schema: Schema,
  run: (context: { req: Request; body: z.infer<Schema>; config: AuthConfig }) => Promise<Result>,
) {
  return async function POST(req: Request): Promise<Response> {
    try {
      limitByIp(req, action);
      assertSameOrigin(req);
      const config = activeAuthConfig();
      let json: unknown;
      try {
        json = JSON.parse((await req.text()).slice(0, 2000));
      } catch {
        throw new AppError("invalid_input", 400, { message: "The request was not valid JSON." });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new AppError("invalid_input", 400, { message: parsed.error.issues[0]?.message });
      }
      const result = await run({ req, body: parsed.data, config });
      const headers = new Headers({ "Cache-Control": "no-store" });
      for (const cookie of result.cookies ?? []) headers.append("Set-Cookie", cookie);
      return Response.json(result.body, { headers });
    } catch (err) {
      const appError = toAppError(err);
      console.error(`[${route}] ${appError.code} (${appError.status}) ${describeForLog(err)}`);
      const payload: ApiErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.retryAfterSec ? { retryAfterSec: appError.retryAfterSec } : {}),
        },
      };
      return Response.json(payload, { status: appError.status, headers: { "Cache-Control": "no-store" } });
    }
  };
}

/** Sends the visitor to another page of this site, optionally setting cookies on the way. */
export function redirectTo(req: Request, path: string, cookies: string[] = [], status = 303): Response {
  const headers = new Headers({ Location: path, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}
