import {
  AnthropicError,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiError } from "./errors";
import {
  AI_TIMEOUT_MS,
  anthropicTransport,
  generateJson,
  resolveModel,
  runWithTransport,
  type Transport,
} from "./provider";

const Answer = z.object({ answer: z.number().max(10) });
const prompt = { system: "You are a calculator.", user: "What is 2+2?" };
const options = { model: "fast", task: "generateQuestion" } as const;
const FAKE_KEY = "test-api-key-SENTINEL-do-not-leak";

const stubTransport = (...results: unknown[]) => {
  const transport = vi.fn<Transport>();
  for (const result of results) {
    if (result instanceof Error) transport.mockRejectedValueOnce(result);
    else transport.mockResolvedValueOnce(result);
  }
  return transport;
};

const caught = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

// The SDK picks the subclass from the status (401 → AuthenticationError, 429 → RateLimitError, ...).
const apiError = (status: number) =>
  APIError.generate(
    status,
    { error: { message: `bad key ${FAKE_KEY}` } },
    `bad key ${FAKE_KEY}`,
    new Headers({ "x-api-key": FAKE_KEY }),
  );

// A minimal Messages API response whose text block holds `text`.
const messageResponse = (text: string) =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveModel", () => {
  it("uses the PLAN §8 defaults when the env vars are unset", () => {
    vi.stubEnv("AI_MODEL_FAST", "");
    vi.stubEnv("AI_MODEL_SMART", "");
    expect(resolveModel("fast")).toBe("claude-sonnet-5-5");
    expect(resolveModel("smart")).toBe("claude-opus-5-5");
  });

  it("reads AI_MODEL_FAST and AI_MODEL_SMART", () => {
    vi.stubEnv("AI_MODEL_FAST", "model-a");
    vi.stubEnv("AI_MODEL_SMART", "model-b");
    expect(resolveModel("fast")).toBe("model-a");
    expect(resolveModel("smart")).toBe("model-b");
  });
});

describe("runWithTransport", () => {
  beforeEach(() => {
    vi.stubEnv("AI_MODEL_FAST", "fast-model");
    vi.stubEnv("AI_MODEL_SMART", "smart-model");
  });

  it("returns validated output on success", async () => {
    const transport = stubTransport({ answer: 4 });
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).resolves.toEqual({ answer: 4 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith({
      schema: Answer,
      ...prompt,
      model: "fast-model",
      task: "generateQuestion",
    });
  });

  it("sends the smart model id for model: smart", async () => {
    const transport = stubTransport({ answer: 4 });
    await runWithTransport(transport, Answer, prompt, {
      model: "smart",
      task: "evaluateAnswer",
    });
    expect(transport.mock.calls[0][0].model).toBe("smart-model");
  });

  it("retries once after invalid output, then succeeds", async () => {
    const transport = stubTransport({ wrong: true }, { answer: 4 });
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).resolves.toEqual({ answer: 4 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("throws INVALID_OUTPUT when the retry is invalid too", async () => {
    const transport = stubTransport("not json", { wrong: true });
    const error = await caught(
      runWithTransport(transport, Answer, prompt, options),
    );
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "INVALID_OUTPUT" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("treats a zod constraint the API doesn't enforce (max) as invalid output", async () => {
    const transport = stubTransport({ answer: 99 }, { answer: 99 });
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it.each([
    ["timeout", new APIConnectionTimeoutError(), "TIMEOUT", 1],
    ["429", apiError(429), "RATE_LIMITED", 1],
    ["401", apiError(401), "UPSTREAM", 1],
    ["400", apiError(400), "UPSTREAM", 1],
    ["500", apiError(500), "UPSTREAM", 2],
    ["connection error", new APIConnectionError({}), "UPSTREAM", 2],
    [
      "SDK structured-output parse error",
      new AnthropicError("Failed to parse structured output"),
      "INVALID_OUTPUT",
      2,
    ],
    ["unknown error", new Error("boom"), "UPSTREAM", 2],
  ])("maps %s to %s after %i attempt(s)", async (_, thrown, code, attempts) => {
    const transport = vi.fn<Transport>().mockRejectedValue(thrown);
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).rejects.toMatchObject({ name: "AiError", code });
    expect(transport).toHaveBeenCalledTimes(attempts);
  });

  it("keeps the upstream status on UPSTREAM errors", async () => {
    const transport = vi.fn<Transport>().mockRejectedValue(apiError(401));
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).rejects.toMatchObject({ code: "UPSTREAM", upstreamStatus: 401 });
  });

  it("recovers when a 500 is followed by valid output", async () => {
    const transport = stubTransport(apiError(500), {
      answer: 4,
    });
    await expect(
      runWithTransport(transport, Answer, prompt, options),
    ).resolves.toEqual({ answer: 4 });
  });

  it("never puts the API key, upstream message or headers into the AiError", async () => {
    for (const thrown of [
      apiError(401),
      apiError(500),
      new Error(`boom ${FAKE_KEY}`),
    ]) {
      const error = await caught(
        runWithTransport(
          vi.fn<Transport>().mockRejectedValue(thrown),
          Answer,
          prompt,
          options,
        ),
      );
      expect(error).toBeInstanceOf(AiError);
      const aiError = error as AiError;
      for (const text of [
        aiError.message,
        String(aiError.stack),
        String(aiError),
        JSON.stringify(aiError),
      ]) {
        expect(text).not.toContain(FAKE_KEY);
        expect(text).not.toContain("bad key");
      }
      expect(aiError.cause).toBeUndefined();
    }
  });
});

describe("anthropicTransport", () => {
  it("calls messages.parse with the zod output format, a cacheable system prompt and the 60 s timeout", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: { answer: 4 } });
    const client = { messages: { parse } } as unknown as Pick<
      Anthropic,
      "messages"
    >;

    await expect(
      anthropicTransport(client)({
        schema: Answer,
        ...prompt,
        model: "claude-sonnet-5-5",
        task: "generateQuestion",
      }),
    ).resolves.toEqual({ answer: 4 });

    expect(AI_TIMEOUT_MS).toBe(60_000);
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        system: [
          {
            type: "text",
            text: prompt.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt.user }],
        output_config: {
          format: expect.objectContaining({ type: "json_schema" }) as unknown,
        },
      }),
      { timeout: 60_000, maxRetries: 0 },
    );
  });
});

describe("generateJson provider selection", () => {
  it("throws a config error for an unknown or missing AI_PROVIDER", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    await expect(generateJson(Answer, prompt, options)).rejects.toThrow(
      /AI_PROVIDER/,
    );
    vi.stubEnv("AI_PROVIDER", "");
    await expect(generateJson(Answer, prompt, options)).rejects.toThrow(
      /AI_PROVIDER/,
    );
  });

  it("throws UPSTREAM without calling the API when the key is missing", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(generateJson(Answer, prompt, options)).rejects.toMatchObject({
      code: "UPSTREAM",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  describe("with AI_PROVIDER=anthropic (network stubbed)", () => {
    beforeEach(() => {
      vi.stubEnv("AI_PROVIDER", "anthropic");
      vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
      vi.stubEnv("AI_MODEL_FAST", "claude-sonnet-5-5");
    });

    it("parses the structured output end to end, sending the key only in the request header", async () => {
      const fetch = vi.fn().mockResolvedValue(messageResponse('{"answer":4}'));
      vi.stubGlobal("fetch", fetch);

      await expect(generateJson(Answer, prompt, options)).resolves.toEqual({
        answer: 4,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [, init] = fetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "claude-sonnet-5-5" });
      expect(String(init.body)).not.toContain(FAKE_KEY);
    });

    it("ignores AI_FAKE_FAILURE (only the fake provider reads it)", async () => {
      vi.stubEnv("AI_FAKE_FAILURE", "timeout");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(messageResponse('{"answer":4}')),
      );
      await expect(generateJson(Answer, prompt, options)).resolves.toEqual({
        answer: 4,
      });
    });

    it("retries malformed JSON once, then throws INVALID_OUTPUT", async () => {
      const fetch = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(messageResponse("{ not json")),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(generateJson(Answer, prompt, options)).rejects.toMatchObject(
        { code: "INVALID_OUTPUT" },
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("maps a rejected key to UPSTREAM 401 without leaking the key or logging, even with ANTHROPIC_LOG=debug", async () => {
      // The SDK's debug log prints requests; the client's logLevel "off" must win over the env var.
      vi.stubEnv("ANTHROPIC_LOG", "debug");
      const consoleSpies = (
        ["log", "info", "warn", "error", "debug"] as const
      ).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                type: "error",
                error: {
                  type: "authentication_error",
                  message: `invalid x-api-key ${FAKE_KEY}`,
                },
              }),
              {
                status: 401,
                headers: { "content-type": "application/json" },
              },
            ),
          ),
        ),
      );

      const error = await caught(generateJson(Answer, prompt, options));
      expect(error).toMatchObject({ code: "UPSTREAM", upstreamStatus: 401 });
      const aiError = error as AiError;
      expect(
        `${aiError.message} ${String(aiError.stack)} ${JSON.stringify(aiError)}`,
      ).not.toContain(FAKE_KEY);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    });
  });
});
