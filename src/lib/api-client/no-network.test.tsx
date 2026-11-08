// Component tests never reach a real server (vitest.setup.ts, T28): a screen rendered without a
// test client would use the app's `api`, whose requests must fail loudly instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, unwrap } from ".";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("no real network in component tests", () => {
  it("rejects a request from the app's default client, naming it", async () => {
    const error = await unwrap(api.GET("/api/courses")).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(String((error as { cause?: unknown }).cause)).toContain(
      "Unexpected network call in a test: GET /api/courses",
    );
  });

  it("still lets a test stub fetch itself", async () => {
    const stub = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", stub);
    expect(await unwrap(api.GET("/api/courses"))).toEqual([]);
    expect(stub).toHaveBeenCalledOnce();
  });
});
