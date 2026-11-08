/// <reference types="vite/client" />
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withApi, withApiOptions } from "@/lib/api/with-api";
import { loadSpec, operations } from "../helpers/openapi-spec";

// Every operation in openapi.yaml has a route handler, every route handler is in openapi.yaml, and
// every handler went through withApi with auth on exactly where the spec requires a session
// (TESTING §8: "Missing auth ... route coverage test"). Better Auth's /api/auth/* isn't in the
// spec: the app documents its own API only, and those routes run withApi with auth off.
vi.setConfig({ testTimeout: 30_000 });

const root = path.resolve(import.meta.dirname, "../..");
const APP_DIR = path.join(root, "src/app");
const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
type Method = (typeof METHODS)[number];
// Next serves route handlers with any of its page extensions, in any app segment.
const ROUTE_FILE = /^route\.(ts|tsx|js|jsx)$/;

/**
 * Operations whose route a later task adds. Each task removes its line in the PR that adds the
 * handler, whatever its track (PLAN §2), and the test fails if a listed operation already has a
 * handler, so the list can only shrink.
 */
const NOT_BUILT_YET: Record<string, string> = {};

/** "src/app/api/courses/[id]/route.ts" → "/api/courses/{id}" */
const urlPathFor = (file: string) =>
  "/" +
  path
    .relative(APP_DIR, path.dirname(file))
    .replaceAll("\\", "/")
    .replace(/\[(\w+)\]/g, "{$1}");

const routeFiles = readdirSync(APP_DIR, {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && ROUTE_FILE.test(entry.name))
  .map((entry) => path.join(entry.parentPath, entry.name));

// A fixed pattern, so lint can see what's imported (dynamic imports must be plain strings).
const ROUTE_MODULES = import.meta.glob<Record<string, unknown>>(
  "/src/app/**/route.{ts,tsx,js,jsx}",
);

const modules = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
  // Importing a route builds the app's modules, which read these; nothing here connects.
  vi.stubEnv("DATABASE_URL", "postgresql://nobody:none@127.0.0.1:9/none");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "a-random-test-secret-that-is-long-enough-0123",
  );
  vi.stubEnv("BETTER_AUTH_URL", "https://teachback.example.test");
  for (const [key, load] of Object.entries(ROUTE_MODULES))
    modules.set(path.join(root, key), await load());
}, 60_000);

afterAll(() => {
  vi.unstubAllEnvs();
});

/** Every exported handler: "GET /api/docs" → the function. */
function handlers(): Map<string, unknown> {
  const found = new Map<string, unknown>();
  for (const file of routeFiles)
    for (const method of METHODS) {
      const handler = modules.get(file)?.[method];
      if (handler !== undefined)
        found.set(`${method} ${urlPathFor(file)}`, handler);
    }
  return found;
}

const isAuthRoute = (key: string) => key.split(" ")[1].startsWith("/api/auth/");

interface SpecOperation {
  key: string;
  id: string;
  secured: boolean;
  /** The operation's `x-rate-limit` bucket, if it has one. */
  rateLimit?: string;
}

/**
 * Handlers whose session setting differs from the spec's: an operation needs a session unless it
 * says `security: []`, and /api/auth/* (not in the spec) must have none.
 */
function authMismatches(
  ops: SpecOperation[],
  found: Map<string, unknown>,
): string[] {
  return [
    ...ops
      .filter(({ key }) => found.has(key))
      .filter(
        ({ key, secured }) => withApiOptions(found.get(key))?.auth !== secured,
      )
      .map(({ key, secured }) => `${key} should have auth: ${secured}`),
    ...[...found]
      .filter(
        ([key, handler]) =>
          isAuthRoute(key) && withApiOptions(handler)?.auth !== false,
      )
      .map(([key]) => `${key} should have auth: false`),
  ];
}

/**
 * Handlers whose rate limit differs from the spec's (T14): an operation marked `x-rate-limit` must
 * be built with that `rateLimit`, and an unmarked one with none. Otherwise a route could ship with
 * its AI-cost or upload cap silently off.
 */
function rateLimitMismatches(
  ops: SpecOperation[],
  found: Map<string, unknown>,
): string[] {
  return ops
    .filter(({ key }) => found.has(key))
    .filter(
      ({ key, rateLimit }) =>
        withApiOptions(found.get(key))?.rateLimit !== rateLimit,
    )
    .map(
      ({ key, rateLimit }) =>
        `${key} should have rateLimit: ${rateLimit ?? "none"}`,
    );
}

describe("route coverage", () => {
  const specOperations: SpecOperation[] = operations(loadSpec()).map(
    ({ method, path: p, operation }) => ({
      key: `${method.toUpperCase() as Method} ${p}`,
      id: operation.operationId as string,
      // An operation is public only when it says so (`security: []`); otherwise the
      // document's default applies and a session is required.
      secured: !(
        Array.isArray(operation.security) && operation.security.length === 0
      ),
      rateLimit: operation["x-rate-limit"] as string | undefined,
    }),
  );

  it("finds the route files, and imports every one of them", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    expect([...modules.keys()].sort()).toEqual([...routeFiles].sort());
  });

  it("has a handler for every operation in openapi.yaml, apart from the not-built-yet list", () => {
    const found = handlers();
    const missing = specOperations
      .filter(({ key }) => !found.has(key))
      .map(({ id }) => id);
    expect(missing.sort()).toEqual(Object.keys(NOT_BUILT_YET).sort());
  });

  it("names only operations that exist in the spec in the not-built-yet list", () => {
    const ids = specOperations.map(({ id }) => id);
    for (const id of Object.keys(NOT_BUILT_YET)) expect(ids).toContain(id);
  });

  it("documents every route handler in openapi.yaml (Better Auth's /api/auth/* aside)", () => {
    const documented = new Set(specOperations.map(({ key }) => key));
    const undocumented = [...handlers().keys()].filter(
      (key) => !isAuthRoute(key) && !documented.has(key),
    );
    expect(undocumented).toEqual([]);
  });

  it("wraps every exported route handler in withApi, /api/auth/* included", () => {
    const raw = [...handlers()]
      .filter(([, handler]) => withApiOptions(handler) === null)
      .map(([key]) => key);
    expect(raw).toEqual([]);
    expect(handlers().size).toBeGreaterThanOrEqual(4);
  });

  // Every other operation needs a session. A new public one is a decision: add it here.
  it("reads which operations are public from openapi.yaml: only those with security: []", () => {
    expect(
      specOperations
        .filter(({ secured }) => !secured)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["getApiReference", "getHealth", "getOpenApiDocument"]);
  });

  it("requires a session exactly where openapi.yaml does, and none on /api/auth/*", () => {
    expect(authMismatches(specOperations, handlers())).toEqual([]);
  });

  it("rate-limits exactly the operations openapi.yaml marks with x-rate-limit", () => {
    expect(rateLimitMismatches(specOperations, handlers())).toEqual([]);
    // The spec marks the upload and both AI operations; they get checked as their routes land.
    expect(
      specOperations
        .filter(({ rateLimit }) => rateLimit)
        .map(({ id, rateLimit }) => `${id}:${rateLimit}`)
        .sort(),
    ).toEqual([
      "answerQuestion:ai",
      "createQuestion:ai",
      "uploadDocument:upload",
    ]);
  });

  it("reports a handler whose rate limit doesn't match the spec", () => {
    const handler = () => new Response(null);
    const ops: SpecOperation[] = [
      {
        key: "POST /api/documents",
        id: "uploadDocument",
        secured: true,
        rateLimit: "upload",
      },
      {
        key: "POST /api/concepts/{id}/question",
        id: "createQuestion",
        secured: true,
        rateLimit: "ai",
      },
      {
        key: "POST /api/questions/{id}/answer",
        id: "answerQuestion",
        secured: true,
        rateLimit: "ai",
      },
      { key: "GET /api/courses", id: "listCourses", secured: true },
      { key: "POST /api/courses", id: "createCourse", secured: true },
    ];
    const found = new Map<string, unknown>([
      ["POST /api/documents", withApi(handler)],
      [
        "POST /api/concepts/{id}/question",
        withApi(handler, { rateLimit: "upload" }),
      ],
      [
        "POST /api/questions/{id}/answer",
        withApi(handler, { rateLimit: "ai" }),
      ],
      ["GET /api/courses", withApi(handler, { rateLimit: "ai" })],
      ["POST /api/courses", withApi(handler)],
    ]);
    expect(rateLimitMismatches(ops, found)).toEqual([
      "POST /api/documents should have rateLimit: upload",
      "POST /api/concepts/{id}/question should have rateLimit: ai",
      "GET /api/courses should have rateLimit: none",
    ]);
  });

  // No built route needs a session yet (T13 adds the first), so the comparison is checked here
  // with handlers made for the test.
  it("reports a handler whose session setting doesn't match the spec", () => {
    const handler = () => new Response(null);
    const ops: SpecOperation[] = [
      { key: "GET /api/courses", id: "listCourses", secured: true },
      { key: "POST /api/courses", id: "createCourse", secured: true },
      { key: "GET /api/health", id: "getHealth", secured: false },
      { key: "GET /api/openapi", id: "getOpenApiDocument", secured: false },
    ];
    const found = new Map<string, unknown>([
      ["GET /api/courses", withApi(handler)],
      ["POST /api/courses", withApi(handler, { auth: false })],
      ["GET /api/health", withApi(handler)],
      ["GET /api/openapi", withApi(handler, { auth: false })],
      ["POST /api/auth/sign-in/email", withApi(handler)],
      ["GET /api/auth/get-session", withApi(handler, { auth: false })],
    ]);
    expect(authMismatches(ops, found)).toEqual([
      "POST /api/courses should have auth: true",
      "GET /api/health should have auth: false",
      "POST /api/auth/sign-in/email should have auth: false",
    ]);
  });
});
