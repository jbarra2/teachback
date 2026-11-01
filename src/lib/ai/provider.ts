// The only way the app calls Claude (PLAN §8). Every call goes through the same path, real or fake:
// transport → zod validation → at most one retry → AiError.
import Anthropic, {
  AnthropicError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AiError } from "./errors";
import { createFakeTransport } from "./fake";

export type AiTask = "extractConcepts" | "generateQuestion" | "evaluateAnswer";
export type AiModel = "fast" | "smart";

export interface AiPrompt {
  system: string;
  user: string;
}

export interface GenerateOptions {
  model: AiModel;
  /** Picks the fake provider's fixture. The real provider ignores it. */
  task: AiTask;
}

export interface AiRequest<S extends z.ZodType = z.ZodType> extends AiPrompt {
  schema: S;
  /** Resolved model id, e.g. "claude-sonnet-5-5". */
  model: string;
  task: AiTask;
}

/** Sends one request and returns the model's output, unvalidated. Throws on failure. */
export type Transport = (request: AiRequest) => Promise<unknown>;

export const AI_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;
const MAX_TOKENS = 4096;
const DEFAULT_MODELS: Record<AiModel, string> = {
  fast: "claude-sonnet-5-5",
  smart: "claude-opus-5-5",
};

export function resolveModel(model: AiModel): string {
  const fromEnv =
    model === "fast" ? process.env.AI_MODEL_FAST : process.env.AI_MODEL_SMART;
  return fromEnv?.trim() || DEFAULT_MODELS[model];
}

/**
 * Asks Claude for JSON matching `schema`. Structured outputs don't enforce min/max/length, so the
 * result is always validated with zod. Throws AiError (TIMEOUT, RATE_LIMITED, UPSTREAM, INVALID_OUTPUT).
 */
export async function generateJson<S extends z.ZodType>(
  schema: S,
  prompt: AiPrompt,
  options: GenerateOptions,
): Promise<z.infer<S>> {
  return runWithTransport(selectTransport(), schema, prompt, options);
}

/** The retry and error-mapping core, exported so tests can drive it with a stub transport. */
export async function runWithTransport<S extends z.ZodType>(
  transport: Transport,
  schema: S,
  { system, user }: AiPrompt,
  { model, task }: GenerateOptions,
): Promise<z.infer<S>> {
  const request: AiRequest<S> = {
    schema,
    system,
    user,
    task,
    model: resolveModel(model),
  };
  let lastError = new AiError("UPSTREAM");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = schema.safeParse(await transport(request));
      if (result.success) return result.data;
      lastError = new AiError("INVALID_OUTPUT");
    } catch (error) {
      lastError = toAiError(error);
      if (!isRetryable(lastError)) throw lastError;
    }
  }
  throw lastError;
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof APIConnectionTimeoutError) return new AiError("TIMEOUT");
  if (error instanceof RateLimitError) return new AiError("RATE_LIMITED", 429);
  if (error instanceof APIError) return new AiError("UPSTREAM", error.status);
  // Any other SDK error comes from parsing the structured output (bad JSON or failed zod check).
  if (error instanceof AnthropicError) return new AiError("INVALID_OUTPUT");
  return new AiError("UPSTREAM");
}

// Retry bad output and transient upstream failures. A timeout would double the wait, a 429 would
// hit the same limit, and other 4xx (bad key, bad request) won't fix themselves.
function isRetryable({ code, upstreamStatus }: AiError): boolean {
  if (code === "INVALID_OUTPUT") return true;
  return (
    code === "UPSTREAM" &&
    (upstreamStatus === undefined || upstreamStatus >= 500)
  );
}

function selectTransport(): Transport {
  const provider = process.env.AI_PROVIDER;
  if (provider === "fake") return createFakeTransport();
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AiError("UPSTREAM");
    return anthropicTransport(
      new Anthropic({
        apiKey,
        timeout: AI_TIMEOUT_MS,
        maxRetries: 0,
        logLevel: "off",
      }),
    );
  }
  throw new Error('AI_PROVIDER must be "fake" or "anthropic".');
}

export function anthropicTransport(
  client: Pick<Anthropic, "messages">,
): Transport {
  return async ({ schema, system, user, model }) => {
    const message = await client.messages.parse(
      {
        model,
        max_tokens: MAX_TOKENS,
        // Cacheable, so repeated calls with the same system prompt cost less (PLAN §8).
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(schema) },
      },
      { timeout: AI_TIMEOUT_MS, maxRetries: 0 },
    );
    return message.parsed_output;
  };
}
