import { readFileSync } from "node:fs";
import type * as fsPromises from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEC_PATH } from "../../../../tests/helpers/openapi-spec";
import * as route from "./route";

// The real readFile unless a test replaces it, so a failed read can be simulated.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Back to the real readFile, dropping any unused one-off result, so no test depends on order.
  vi.mocked(readFile).mockReset();
});

const enabled = () => vi.stubEnv("API_DOCS_ENABLED", "true");

describe("GET /api/openapi", () => {
  it("exports only GET, decided per request (Next answers 405 to other methods)", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it.each([undefined, "", "false", "TRUE", "1", " true"])(
    "is 404 NOT_FOUND when API_DOCS_ENABLED=%j, without reading the file",
    async (value) => {
      vi.stubEnv("API_DOCS_ENABLED", value);
      const res = await route.GET();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found." },
      });
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it("serves openapi.yaml byte for byte, as YAML that browsers won't sniff", async () => {
    enabled();
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/yaml; charset=utf-8",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe(readFileSync(SPEC_PATH, "utf8"));
  });

  it("reads the flag and the file on every request, so edits show without a restart", async () => {
    enabled();
    vi.mocked(readFile)
      .mockResolvedValueOnce("openapi: 3.1.0 # first")
      .mockResolvedValueOnce("openapi: 3.1.0 # edited");
    expect(await (await route.GET()).text()).toBe("openapi: 3.1.0 # first");
    expect(await (await route.GET()).text()).toBe("openapi: 3.1.0 # edited");
    expect(readFile).toHaveBeenCalledTimes(2);
    vi.stubEnv("API_DOCS_ENABLED", "false");
    expect((await route.GET()).status).toBe(404);
  });

  it("answers a failed read with a generic 500 that names no path or cause", async () => {
    enabled();
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "ENOENT: no such file or directory, open '/var/task/openapi/openapi.yaml'",
        ),
        { code: "ENOENT" },
      ),
    );
    const res = await route.GET();
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    });
    expect(body).not.toMatch(/ENOENT|openapi\.yaml|var\/task/);
  });

  it("S8: holds no secret or environment value", async () => {
    enabled();
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-marker-auth-1f9c");
    vi.stubEnv("ANTHROPIC_API_KEY", "secret-marker-key-7a2e");
    expect(await (await route.GET()).text()).not.toMatch(/secret-marker/);
  });
});
