import { describe, expect, it, vi } from "vitest";

// How expectMatchesOpenApi picks the documented response when a spec uses status ranges ("4XX")
// or `default`, which openapi.yaml doesn't yet: the exact status first, then its range, then
// default. Each response here accepts one body only, so the test can see which one was used.
const only = (value: string) => ({
  description: value,
  content: { "application/json": { schema: { const: value } } },
});

vi.mock("./openapi-spec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openapi-spec")>()),
  loadSpec: () => ({
    openapi: "3.1.0",
    info: { title: "ranges", version: "1" },
    paths: {
      "/x": {
        get: {
          responses: {
            "200": only("ok"),
            "404": only("exact"),
            "4XX": only("range"),
            default: only("default"),
          },
        },
        // Responses documented without a body.
        put: { responses: { "200": { description: "saved, no body" } } },
        delete: { responses: { "204": { description: "deleted" } } },
      },
    },
  }),
}));

const { expectMatchesOpenApi } = await import("./openapi-assert");
const reply = (body: string, status: number) =>
  expectMatchesOpenApi(Response.json(body, { status }), "GET /x");

describe("expectMatchesOpenApi with status ranges and default", () => {
  it("uses the exact status when it's documented, over its range", async () => {
    await expect(reply("exact", 404)).resolves.toBe("exact");
    await expect(reply("range", 404)).rejects.toThrow(/body/);
  });

  it("uses the range for a status without its own entry, over default", async () => {
    await expect(reply("range", 400)).resolves.toBe("range");
    await expect(reply("default", 400)).rejects.toThrow(/body/);
  });

  it("falls back to default for any other status", async () => {
    await expect(reply("default", 503)).resolves.toBe("default");
    await expect(reply("range", 503)).rejects.toThrow(/body/);
  });
});

describe("expectMatchesOpenApi with a response documented without a body", () => {
  it("passes an empty response", async () => {
    await expect(
      expectMatchesOpenApi(new Response(null, { status: 204 }), "DELETE /x"),
    ).resolves.toBeUndefined();
    await expect(
      expectMatchesOpenApi(new Response(null), "PUT /x"),
    ).resolves.toBeUndefined();
  });

  it("fails a JSON body, or any other body, where none is documented", async () => {
    await expect(
      expectMatchesOpenApi(Response.json({ ok: true }), "PUT /x"),
    ).rejects.toThrow(/expected no body/);
    await expect(
      expectMatchesOpenApi(new Response("saved"), "PUT /x"),
    ).rejects.toThrow(/expected no body/);
  });
});
