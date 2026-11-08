// The fake API is for tests only (T28): the app always talks to the real API, so no app file may
// import the fake or a test helper, and the old mock switch must stay gone.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(ROOT, "src");
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Built from parts so this file doesn't match itself.
const MOCK_SWITCH = ["NEXT_PUBLIC", "MOCK_ENDPOINTS"].join("_");

/** The test-only helpers outside fake-api/. A new one goes here, so an app file can't hide. */
const TEST_HELPERS = [
  "src/components/notes/test-clients.ts",
  "src/lib/api-client/test-helpers.ts",
];

/** Tests, the fake itself, and the listed helpers. */
function isTestSupport(file: string): boolean {
  const relative = path.relative(ROOT, file).replaceAll("\\", "/");
  return (
    /\.test\.(ts|tsx)$/.test(relative) ||
    relative.startsWith("src/lib/api-client/fake-api/") ||
    TEST_HELPERS.includes(relative)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "generated" ? [] : sourceFiles(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

/** The module specifiers a file imports or re-exports, static or dynamic. */
function importsOf(text: string): string[] {
  const specifiers = text.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g,
  );
  return [...specifiers].map((match) => match[1]!);
}

/** A fake-API module, or a test helper, by path alias or relative path. */
function isTestOnlyModule(specifier: string): boolean {
  const last = specifier.split("/").pop() ?? "";
  return (
    specifier.split("/").includes("fake-api") ||
    last.startsWith("test-") ||
    /\.test(\.tsx?)?$/.test(last)
  );
}

function appFilesImportingTestCode(files: string[]): string[] {
  return files
    .filter((file) => !isTestSupport(file))
    .filter((file) =>
      importsOf(readFileSync(file, "utf8")).some(isTestOnlyModule),
    )
    .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));
}

describe("the fake API stays out of the app", () => {
  const files = sourceFiles(SRC);

  it("finds the app's source files", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.some((file) => file.endsWith(path.join("api-client", "client.ts"))),
    ).toBe(true);
  });

  it("no app file imports the fake API or a test helper", () => {
    expect(appFilesImportingTestCode(files)).toEqual([]);
  });

  it("no app file mentions fake-api at all (template imports, new URL, comments)", () => {
    const mentions = files
      .filter((file) => !isTestSupport(file))
      .filter((file) => readFileSync(file, "utf8").includes("fake-api"))
      .map((file) => path.relative(ROOT, file));
    expect(mentions).toEqual([]);
  });

  it("every listed test helper exists", () => {
    for (const helper of TEST_HELPERS)
      expect(existsSync(path.join(ROOT, helper))).toBe(true);
  });

  it("tests do import it, so the scan would see an app import", () => {
    const tests = files.filter(isTestSupport);
    const importing = tests.filter((file) =>
      importsOf(readFileSync(file, "utf8")).some(isTestOnlyModule),
    );
    expect(importing.length).toBeGreaterThan(5);
  });

  it.each([
    ['import { courses } from "@/lib/api-client/fake-api/fixtures";'],
    ['import { createFakeFetch } from "./fake-api/fake-fetch";'],
    ['export { mockClient } from "../notes/test-clients";'],
    ['const { rejection } = await import("./test-helpers");'],
  ])("recognises %s as test code", (line) => {
    expect(importsOf(line).some(isTestOnlyModule)).toBe(true);
  });

  it.each([
    ['import { api } from "@/lib/api-client";'],
    ['import { latest } from "./latest-attempt";'],
    ['import { CourseList } from "@/components/notes/course-list";'],
  ])("lets app imports like %s through", (line) => {
    expect(importsOf(line).some(isTestOnlyModule)).toBe(false);
  });
});

describe("the mock switch is gone", () => {
  it("src/lib/mocks/ no longer exists", () => {
    expect(existsSync(path.join(SRC, "lib", "mocks"))).toBe(false);
  });

  it(`no app file reads ${MOCK_SWITCH}`, () => {
    const readers = sourceFiles(SRC)
      .filter((file) => !isTestSupport(file))
      .filter((file) => readFileSync(file, "utf8").includes(MOCK_SWITCH))
      .map((file) => path.relative(ROOT, file));
    expect(readers).toEqual([]);
  });

  it.each([".env.example", ".env.test"])(
    `%s doesn't set ${MOCK_SWITCH}`,
    (name) => {
      expect(readFileSync(path.join(ROOT, name), "utf8")).not.toContain(
        MOCK_SWITCH,
      );
    },
  );
});
