import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { readBodyBytes, readJsonBody } from "./body";

const URL_ = "https://teachback.example.test/api/x";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(URL_, { method: "POST", body, headers });
}

/** A body with no Content-Length (chunked), as a client streaming it would send. */
function streamed(chunks: string[], headers: Record<string, string> = {}) {
  const pulled = { count: 0 };
  const encoder = new TextEncoder();
  // highWaterMark 0: a chunk is pulled only when someone reads, so `pulled` counts real reads.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = chunks[pulled.count++];
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(URL_, {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  } as RequestInit);
  return { request, pulled };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("readBodyBytes", () => {
  it("returns the body when it's within the limit", async () => {
    const bytes = await readBodyBytes(post("hello"), 5);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("returns an empty body for a request without one", async () => {
    expect((await readBodyBytes(post(null), 10)).byteLength).toBe(0);
  });

  it("refuses an over-limit Content-Length with 413 before reading anything", async () => {
    const { request, pulled } = streamed(["x"], { "content-length": "11" });
    const error = await rejection(readBodyBytes(request, 10));
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(pulled.count).toBe(0);
  });

  it("refuses a body without Content-Length once it passes the limit while reading", async () => {
    const { request, pulled } = streamed(["12345", "67890", "1", "never"]);
    const error = await rejection(readBodyBytes(request, 10));
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    // It stops at the chunk that crossed the limit instead of reading the rest.
    expect(pulled.count).toBe(3);
  });

  it("enforces the limit while reading even when Content-Length claims less", async () => {
    const { request } = streamed(["12345", "67890", "12"], {
      "content-length": "4",
    });
    expect((await rejection(readBodyBytes(request, 10))).code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("accepts a body of exactly the limit", async () => {
    const { request } = streamed(["12345", "67890"]);
    expect((await readBodyBytes(request, 10)).byteLength).toBe(10);
  });

  it.each(["-1", "abc", "1.5", "1e3", ""])(
    "refuses a malformed Content-Length %j with 400",
    async (value) => {
      const { request } = streamed(["{}"], { "content-length": value });
      expect((await rejection(readBodyBytes(request, 10))).code).toBe(
        "VALIDATION_ERROR",
      );
    },
  );

  it("cancels the stream when it gives up", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel,
    });
    const request = new Request(URL_, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await rejection(readBodyBytes(request, 10));
    expect(cancel).toHaveBeenCalled();
  });
});

describe("readJsonBody", () => {
  const json = { "content-type": "application/json" };

  it("parses a JSON body", async () => {
    expect(await readJsonBody(post('{"name":"Biology"}', json), 100)).toEqual({
      name: "Biology",
    });
  });

  it("accepts a charset parameter and any case in the media type", async () => {
    const headers = { "content-type": "Application/JSON; charset=utf-8" };
    expect(await readJsonBody(post("{}", headers), 100)).toEqual({});
  });

  it.each([
    ["no Content-Type", {}],
    ["form encoding", { "content-type": "application/x-www-form-urlencoded" }],
    ["text/plain", { "content-type": "text/plain" }],
    ["a lookalike type", { "content-type": "application/jsonx" }],
    ["a JSON suffix type", { "content-type": "application/evil+json" }],
  ])("refuses %s with 400", async (_name, headers) => {
    const error = await rejection(readJsonBody(post("{}", headers), 100));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual({
      formErrors: [expect.stringMatching(/JSON/)],
      fieldErrors: {},
    });
  });

  it.each([
    ["malformed JSON", "{name:", "The body isn't valid JSON."],
    ["an empty body", "", "The body is empty."],
    ["a blank body", "  \n", "The body is empty."],
  ])("refuses %s with 400 and says why", async (_name, body, message) => {
    const error = await rejection(readJsonBody(post(body, json), 100));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual({ formErrors: [message], fieldErrors: {} });
  });

  describe("with optional: true", () => {
    it("treats an empty body as none, whatever its Content-Type", async () => {
      expect(
        await readJsonBody(post(""), 100, { optional: true }),
      ).toBeUndefined();
      expect(
        await readJsonBody(post(null), 100, { optional: true }),
      ).toBeUndefined();
    });

    it("still parses, and checks, a body that's there", async () => {
      expect(
        await readJsonBody(post("{}", json), 100, { optional: true }),
      ).toEqual({});
      const error = await rejection(
        readJsonBody(post("x", { "content-type": "text/plain" }), 100, {
          optional: true,
        }),
      );
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  it("refuses invalid UTF-8 with 400 instead of replacing bytes", async () => {
    const bytes = new Uint8Array([
      0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
    ]);
    const error = await rejection(readJsonBody(post(bytes, json), 100));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("checks the size before the media type", async () => {
    const error = await rejection(
      readJsonBody(
        post("x".repeat(101), { "content-type": "text/plain" }),
        100,
      ),
    );
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
