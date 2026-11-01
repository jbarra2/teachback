import type * as scalarNext from "@scalar/nextjs-api-reference";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALAR_BUNDLE_INTEGRITY, SCALAR_BUNDLE_URL } from "@/lib/api/api-docs";
import * as route from "./route";

// The real Scalar page, unless a test swaps in other HTML to see what the route does with it.
const scalar = vi.hoisted(() => ({ page: null as string | null }));
vi.mock("@scalar/nextjs-api-reference", async (importOriginal) => {
  const actual = await importOriginal<typeof scalarNext>();
  return {
    ...actual,
    ApiReference: (config: Partial<scalarNext.ApiReferenceConfiguration>) => {
      const real = actual.ApiReference(config);
      return () =>
        scalar.page === null
          ? real()
          : new Response(scalar.page, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  scalar.page = null;
});

async function render() {
  vi.stubEnv("API_DOCS_ENABLED", "true");
  const res = await route.GET();
  return { res, html: await res.text() };
}

/** The configuration object Scalar's page passes to createApiReference. */
function configIn(html: string): unknown {
  const match =
    /Scalar\.createApiReference\('#app', (\{[\s\S]*?\})\)\s*<\/script>/.exec(
      html,
    );
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? "null");
}

describe("GET /api/docs", () => {
  it("exports only GET, decided per request (Next answers 405 to other methods)", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it.each([undefined, "", "false", "TRUE", "1", " true"])(
    "is 404 NOT_FOUND when API_DOCS_ENABLED=%j",
    async (value) => {
      vi.stubEnv("API_DOCS_ENABLED", value);
      const res = await route.GET();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found." },
      });
    },
  );

  it("reads the flag on every request", async () => {
    expect((await render()).res.status).toBe(200);
    vi.stubEnv("API_DOCS_ENABLED", "false");
    expect((await route.GET()).status).toBe(404);
  });

  it("renders Scalar's reference of /api/openapi as HTML", async () => {
    const { res, html } = await render();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html).toContain("<title>TeachBack API</title>");
  });

  it("loads one script from outside: the pinned Scalar release, checked by its hash", async () => {
    const { html } = await render();
    const scripts = [
      ...html.matchAll(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g),
    ].map((m) => m[0]);
    expect(scripts).toEqual([
      `<script src="${SCALAR_BUNDLE_URL}" integrity="${SCALAR_BUNDLE_INTEGRITY}" crossorigin="anonymous">`,
    ]);
    expect(SCALAR_BUNDLE_URL).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@\d+\.\d+\.\d+\/dist\/browser\/standalone\.js$/,
    );
    expect(SCALAR_BUNDLE_INTEGRITY).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    // Nothing else from outside in any form: the pinned bundle is the page's only absolute URL.
    const urls = html.match(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'`<>()]+/gi) ?? [];
    expect([...new Set(urls)]).toEqual([SCALAR_BUNDLE_URL]);
  });

  it("fails closed with a 500 if Scalar's page loads anything else as well", async () => {
    scalar.page = `<html><script src="${SCALAR_BUNDLE_URL}"></script><script type="module">import("https://cdn.jsdelivr.net/npm/@scalar/api-reference/esm.js")</script></html>`;
    const { res, html } = await render();
    expect(res.status).toBe(500);
    expect(html).not.toContain("jsdelivr");
  });

  it("fails closed with a 500 if Scalar's page has no script tag it can check", async () => {
    scalar.page = `<html><script type="module">import "https://cdn.jsdelivr.net/npm/@scalar/api-reference/esm.js"</script></html>`;
    const { res, html } = await render();
    expect(res.status).toBe(500);
    expect(html).not.toContain("jsdelivr");
    expect(JSON.parse(html)).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    });
  });

  it("sends nothing to Scalar's servers: no telemetry, agent, MCP, toolbar, fonts or proxy", async () => {
    expect(configIn((await render()).html)).toEqual({
      _integration: "nextjs",
      url: "/api/openapi",
      telemetry: false,
      withDefaultFonts: false,
      agent: { disabled: true },
      mcp: { disabled: true },
      showDeveloperTools: "never",
    });
  });

  it("S8: puts no secret or environment value in the page, even one read at import", async () => {
    vi.stubEnv("API_DOCS_ENABLED", "true");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-marker-auth-1f9c");
    vi.stubEnv("ANTHROPIC_API_KEY", "secret-marker-key-7a2e");
    vi.stubEnv("DATABASE_URL", "postgresql://u:secret-marker-db-3b8d@db/x");
    // A fresh import, so values the modules read when they load are the stubbed ones.
    vi.resetModules();
    const fresh = await import("./route");
    const html = await (await fresh.GET()).text();
    expect(html).toContain("TeachBack API");
    expect(html).not.toMatch(/secret-marker/);
  });
});
