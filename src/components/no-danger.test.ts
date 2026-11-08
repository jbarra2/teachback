// Backstop for the `react/no-danger` lint rule (TESTING §8, XSS): no source file under src/
// may set raw HTML, so model output and user text always render as text.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Built from parts so this file doesn't match itself.
const FORBIDDEN = ["dangerously", "SetInnerHTML"].join("");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "generated" ? [] : sourceFiles(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

describe("no raw HTML", () => {
  it(`no file under src/ uses ${FORBIDDEN}`, () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => readFileSync(file, "utf8").includes(FORBIDDEN))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
