// Aborting a request on the mocks, in jsdom like the app's components. openapi-fetch doesn't check
// the signal itself, so the mock fetch has to, or an aborted request still gets answered.
import { describe, expect, it, vi } from "vitest";
import { MOCK_KEYS } from "@/lib/mocks/config";
import { createApiClient, isAbortError, unwrap } from ".";

function client() {
  return createApiClient({
    baseUrl: "http://test.local",
    mocks: new Set(MOCK_KEYS),
    mockDelayMs: 50,
    fetch: vi.fn(async () => {
      throw new Error("unexpected request");
    }),
    onUnauthenticated: vi.fn(),
  });
}

const NAME = "Aborted course";

describe("aborting a mocked request", () => {
  it("rejects with an abort error during the delay, and the handler never runs", async () => {
    const api = client();
    const controller = new AbortController();
    const created = unwrap(
      api.POST("/api/courses", {
        body: { name: NAME },
        signal: controller.signal,
      }),
    );
    controller.abort();
    const error: unknown = await created.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);

    const courses = await unwrap(api.GET("/api/courses"));
    expect(courses.map((course) => course.name)).not.toContain(NAME);
  });

  it("rejects a request whose signal is already aborted", async () => {
    const api = client();
    const error: unknown = await unwrap(
      api.POST("/api/courses", {
        body: { name: NAME },
        signal: AbortSignal.abort(),
      }),
    ).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);

    const courses = await unwrap(api.GET("/api/courses"));
    expect(courses.map((course) => course.name)).not.toContain(NAME);
  });

  it("still answers a request that isn't aborted", async () => {
    const api = client();
    const course = await unwrap(
      api.POST("/api/courses", { body: { name: NAME } }),
    );
    expect(course.name).toBe(NAME);
  });
});
