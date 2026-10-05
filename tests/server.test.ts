import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, describeForLog, toAppError } from "@/lib/server/appError";
import { createPostHandler } from "@/lib/server/handler";
import { generateStructured, moderate, type OpenAIClient } from "@/lib/server/openai";
import { clientIp, rateLimit, resetRateLimits } from "@/lib/server/rateLimit";

const FAKE_KEY = "sk-test-0000000000000000000000000000";

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("OPENAI_TEXT_MODEL", "test-model");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_REASONING_EFFORT", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("rateLimit", () => {
  it("allows the limit, then blocks until the window resets", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("ip", 3, 60_000, 1000).ok).toBe(true);
    const blocked = rateLimit("ip", 3, 60_000, 2000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(59);
    expect(rateLimit("ip", 3, 60_000, 61_001).ok).toBe(true);
  });

  it("counts each IP separately", () => {
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000, 0).ok).toBe(true);
  });

  it("reads the client IP from proxy headers", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ */

describe("toAppError", () => {
  const apiError = (status: number, body: Record<string, unknown> = {}) =>
    APIError.generate(status, { error: body }, "upstream message with sk-secret", new Headers());

  it.each([
    [401, {}, "invalid_key"],
    [403, {}, "invalid_key"],
    [429, { code: "insufficient_quota" }, "quota_exceeded"],
    [429, { code: "rate_limit_exceeded" }, "upstream_busy"],
    [404, { code: "model_not_found" }, "model_unavailable"],
    [400, { code: "model_not_found" }, "model_unavailable"],
    [400, { code: "something_else" }, "server_error"],
    [500, {}, "upstream_busy"],
    [503, {}, "upstream_busy"],
  ])("maps HTTP %i %j to %s", (status, body, expected) => {
    expect(toAppError(apiError(status, body)).code).toBe(expected);
  });

  it("maps timeouts, aborts and network failures", () => {
    expect(toAppError(new APIConnectionTimeoutError()).code).toBe("timeout");
    expect(toAppError(new APIUserAbortError()).code).toBe("timeout");
    expect(toAppError(new APIConnectionError({ message: "down" })).code).toBe("network");
    expect(toAppError(new DOMException("timed out", "TimeoutError")).code).toBe("timeout");
    expect(toAppError(new Error("boom")).code).toBe("server_error");
  });

  it("never passes OpenAI's message (which can echo the key) to users or logs", () => {
    const err = apiError(401);
    expect(toAppError(err).message).not.toContain("sk-secret");
    expect(describeForLog(err)).not.toContain("sk-secret");
  });
});

/* ------------------------------------------------------------------ */

const Wire = z.object({ value: z.string() });

function message(text: string) {
  return { type: "message", content: [{ type: "output_text", text }] };
}

/** A stand-in for the OpenAI SDK that plays back scripted results. */
function fakeClient(script: Array<() => unknown>, flagged = false) {
  const parse = vi.fn(async () => {
    const next = script.shift();
    if (!next) throw new Error("No more scripted responses");
    return next();
  });
  const create = vi.fn(async () => ({ results: [{ flagged }] }));
  const client = { responses: { parse }, moderations: { create } } as unknown as OpenAIClient;
  return { client, parse, create };
}

const completed = (value: unknown) => () => ({
  status: "completed",
  output: [message(JSON.stringify(value))],
  output_parsed: value,
});

const options = (client: OpenAIClient) => ({
  client,
  name: "test",
  instructions: "Be helpful.",
  input: "Hello",
  schema: Wire,
  refine: (wire: z.infer<typeof Wire>) => {
    if (wire.value === "bad") throw new Error("rejected by app rules");
    return wire.value.toUpperCase();
  },
  maxOutputTokens: 100,
});

describe("generateStructured", () => {
  it("returns the refined result and sends a strict JSON schema", async () => {
    const { client, parse } = fakeClient([completed({ value: "ok" })]);
    await expect(generateStructured(options(client))).resolves.toBe("OK");

    const [params] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.model).toBe("test-model");
    expect(params.store).toBe(false);
    expect(params).not.toHaveProperty("reasoning");
    expect(params.text).toMatchObject({ format: { type: "json_schema", strict: true, name: "test" } });
  });

  it("retries once when the answer fails validation, then succeeds", async () => {
    const { client, parse } = fakeClient([completed({ wrong: 1 }), completed({ value: "ok" })]);
    await expect(generateStructured(options(client))).resolves.toBe("OK");
    expect(parse).toHaveBeenCalledTimes(2);
    const [retryParams] = parse.mock.calls[1] as unknown as [{ input: string }];
    expect(retryParams.input).toContain("could not be used");
  });

  it("retries when the app rules reject the answer or the JSON cannot be parsed", async () => {
    const { client, parse } = fakeClient([
      completed({ value: "bad" }),
      () => {
        throw new SyntaxError("Unexpected token");
      },
    ]);
    await expect(generateStructured(options(client))).rejects.toMatchObject({
      code: "bad_model_output",
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("gives up with a friendly error after two unusable answers", async () => {
    const cutOff = () => ({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      output_parsed: null,
    });
    const { client, parse } = fakeClient([cutOff, cutOff]);
    await expect(generateStructured(options(client))).rejects.toMatchObject({
      code: "bad_model_output",
      status: 502,
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not retry API failures or refusals", async () => {
    const auth = fakeClient([
      () => {
        throw APIError.generate(401, { error: {} }, "bad key", new Headers());
      },
    ]);
    await expect(generateStructured(options(auth.client))).rejects.toBeInstanceOf(APIError);
    expect(auth.parse).toHaveBeenCalledTimes(1);

    const refusal = fakeClient([
      () => ({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }],
        output_parsed: null,
      }),
    ]);
    await expect(generateStructured(options(refusal.client))).rejects.toMatchObject({
      code: "refused",
    });
    expect(refusal.parse).toHaveBeenCalledTimes(1);
  });

  it("passes the reasoning effort only when it is configured", async () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    const { client, parse } = fakeClient([completed({ value: "ok" })]);
    await generateStructured(options(client));
    const [params] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.reasoning).toEqual({ effort: "low" });
  });

  it("fails clearly when OPENAI_TEXT_MODEL is missing", async () => {
    vi.stubEnv("OPENAI_TEXT_MODEL", "");
    const { client, parse } = fakeClient([completed({ value: "ok" })]);
    await expect(generateStructured(options(client))).rejects.toMatchObject({
      code: "server_misconfigured",
    });
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("moderate", () => {
  it("passes clean text and blocks flagged text", async () => {
    await expect(moderate(fakeClient([]).client, "hello")).resolves.toBeUndefined();
    await expect(moderate(fakeClient([], true).client, "bad")).rejects.toMatchObject({
      code: "moderation_flagged",
      status: 422,
    });
  });
});

/* ------------------------------------------------------------------ */

describe("createPostHandler", () => {
  const Body = z.object({ text: z.string().min(3, "Please type at least 3 characters.") });

  function setup(run = vi.fn(async () => ({ ok: true }))) {
    const clientFactory = vi.fn((apiKey: string) => {
      void apiKey;
      return fakeClient([]).client;
    });
    const POST = createPostHandler({ route: "test", schema: Body, run, clientFactory });
    return { POST, run, clientFactory };
  }

  const request = (body: unknown, headers: Record<string, string> = {}, url = "http://localhost:3000/api/test") =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("asks for a key when neither the server nor the visitor has one", async () => {
    const { POST, run } = setup();
    const res = await POST(request({ text: "hello" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("missing_key");
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the server key and returns the result without caching", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    const { POST, clientFactory } = setup();
    const res = await POST(request({ text: "hello" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(clientFactory).toHaveBeenCalledWith(FAKE_KEY);
  });

  it("prefers the visitor's own key for that request", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    const own = "sk-visitor-11111111111111111111111111";
    const { POST, clientFactory } = setup();
    await POST(request({ text: "hello" }, { "x-openai-key": own }));
    expect(clientFactory).toHaveBeenCalledWith(own);
  });

  it("refuses a visitor's key sent over plain HTTP, but allows HTTPS", async () => {
    const own = "sk-visitor-11111111111111111111111111";
    const { POST, run } = setup();
    const insecure = await POST(
      request({ text: "hello" }, { "x-openai-key": own }, "http://example.org/api/test"),
    );
    expect((await insecure.json()).error.code).toBe("insecure_transport");
    expect(run).not.toHaveBeenCalled();

    const secure = await POST(
      request(
        { text: "hello" },
        { "x-openai-key": own, "x-forwarded-proto": "https" },
        "http://example.org/api/test",
      ),
    );
    expect(secure.status).toBe(200);
  });

  it("rejects a malformed visitor key without calling OpenAI", async () => {
    const { POST, clientFactory } = setup();
    const res = await POST(request({ text: "hello" }, { "x-openai-key": "short" }));
    expect((await res.json()).error.code).toBe("invalid_key");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("validates the body and reports the first problem in plain words", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    const { POST } = setup();
    const bad = await POST(request({ text: "hi" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatchObject({
      code: "invalid_input",
      message: "Please type at least 3 characters.",
    });
    const notJson = await POST(request("{nope"));
    expect((await notJson.json()).error.code).toBe("invalid_input");
    // Zod's own technical wording is never shown to people.
    const wrongType = await POST(request({ text: 42 }));
    expect((await wrongType.json()).error.message).toBe(
      "Part of the request isn't valid (text). Please reload the page and try again.",
    );
  });

  it("rate limits each IP and says when to retry", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    const { POST } = setup();
    const from = (ip: string) => request({ text: "hello" }, { "x-forwarded-for": ip });

    expect((await POST(from("1.1.1.1"))).status).toBe(200);
    expect((await POST(from("1.1.1.1"))).status).toBe(200);
    const blocked = await POST(from("1.1.1.1"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect((await POST(from("2.2.2.2"))).status).toBe(200);
  });

  it("turns failures into safe errors and never logs or returns the key", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    const run = vi.fn(async () => {
      throw APIError.generate(401, { error: {} }, `Incorrect API key provided: ${FAKE_KEY}`, new Headers());
    });
    const { POST } = setup(run);
    const res = await POST(request({ text: "hello" }));
    const text = await res.text();
    expect(res.status).toBe(401);
    expect(JSON.parse(text).error.code).toBe("invalid_key");
    expect(text).not.toContain(FAKE_KEY);

    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("invalid_key");
    expect(logged).not.toContain(FAKE_KEY);
  });

  it("passes app errors through with their status", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    const { POST } = setup(
      vi.fn(async () => {
        throw new AppError("moderation_flagged", 422);
      }),
    );
    const res = await POST(request({ text: "hello" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("moderation_flagged");
  });
});
