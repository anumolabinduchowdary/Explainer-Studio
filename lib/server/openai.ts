import "server-only";
import OpenAI, { OpenAIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { AppError } from "./appError";

/** Model names always come from the environment, never from code. */
export function textModel(): string {
  const model = process.env.OPENAI_TEXT_MODEL?.trim();
  if (!model) throw new AppError("server_misconfigured", 500);
  return model;
}

function moderationModel(): string {
  // "omni-moderation-latest" is OpenAI's evergreen alias, used when no override is set.
  return process.env.OPENAI_MODERATION_MODEL?.trim() || "omni-moderation-latest";
}

type ReasoningEffort = NonNullable<OpenAI.Reasoning["effort"]>;

function reasoningEffort(): ReasoningEffort | undefined {
  const effort = process.env.OPENAI_REASONING_EFFORT?.trim();
  return effort ? (effort as ReasoningEffort) : undefined;
}

export function createClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 1, timeout: 50_000 });
}

/** The slice of the SDK this module uses; lets tests pass in a fake. */
export type OpenAIClient = Pick<OpenAI, "responses" | "moderations">;

/** Runs text through OpenAI's moderation endpoint and blocks flagged input. */
export async function moderate(
  client: OpenAIClient,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await client.moderations.create(
    { model: moderationModel(), input: text },
    { signal },
  );
  if (result.results.some((r) => r.flagged)) {
    throw new AppError("moderation_flagged", 422);
  }
}

type GenerateOptions<Wire, Result> = {
  client: OpenAIClient;
  /** Name of the JSON schema sent to OpenAI. */
  name: string;
  instructions: string;
  input: string;
  /** The shape OpenAI must return (Structured Outputs). */
  schema: z.ZodType<Wire>;
  /** Applies the stricter app rules. Throw to reject the answer. */
  refine: (wire: Wire) => Result;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

/**
 * Asks the model for JSON matching `schema`, validates it with Zod and applies
 * `refine`. If the answer is unusable it retries once, then gives up with a
 * friendly error. API failures (bad key, quota, timeouts) are not retried
 * here; they are thrown for the route to map onto an error state.
 */
export async function generateStructured<Wire, Result>(
  options: GenerateOptions<Wire, Result>,
): Promise<Result> {
  const { client, name, instructions, schema, refine, maxOutputTokens, signal } = options;
  const model = textModel();
  const effort = reasoningEffort();
  let problem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const input =
      attempt === 1
        ? options.input
        : `${options.input}\n\nYour previous answer could not be used (${problem}). Answer again and follow every rule.`;

    let response;
    try {
      response = await client.responses.parse(
        {
          model,
          instructions,
          input,
          text: { format: zodTextFormat(schema, name) },
          max_output_tokens: maxOutputTokens,
          store: false,
          ...(effort ? { reasoning: { effort } } : {}),
        },
        { signal },
      );
    } catch (err) {
      // SDK errors are real API or network failures. Anything else was thrown
      // while parsing the model's text (bad JSON or a schema mismatch).
      if (err instanceof OpenAIError) throw err;
      problem = "it was not valid JSON in the required shape";
      continue;
    }

    const refused = response.output.some(
      (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
    );
    if (refused) throw new AppError("refused", 422);

    if (response.status === "incomplete") {
      if (response.incomplete_details?.reason === "content_filter") {
        throw new AppError("refused", 422);
      }
      problem = "it was cut off before it finished";
      continue;
    }

    const parsed = schema.safeParse(response.output_parsed);
    if (!parsed.success) {
      problem = "it did not match the required shape";
      continue;
    }

    try {
      return refine(parsed.data);
    } catch (err) {
      if (err instanceof AppError) throw err;
      problem = "some fields were empty, too long or not allowed";
    }
  }

  throw new AppError("bad_model_output", 502);
}
