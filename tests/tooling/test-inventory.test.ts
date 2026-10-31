import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  cleanEnv,
  linkNodeModules,
  repoRoot as root,
  tempDirs,
} from "../helpers/temp-dirs";

// Runs scripts/check-test-inventory.mjs against small throwaway projects that use the real
// Vitest config and npm scripts, then breaks one thing at a time.
vi.setConfig({ testTimeout: 60_000 });

const dirs = tempDirs("teachback-inventory-");
afterAll(() => dirs.removeAll());

const realConfig = readFileSync(path.join(root, "vitest.config.mts"), "utf8");
const realScripts = (
  JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;
const A_TEST = 'import { it } from "vitest";\nit("runs", () => {});\n';

function project({
  config = realConfig,
  scripts = {},
  extraFiles = [],
}: {
  config?: string;
  scripts?: Record<string, string>;
  extraFiles?: string[];
} = {}) {
  const dir = dirs.make();
  linkNodeModules(dir);
  mkdirSync(path.join(dir, "scripts"));
  copyFileSync(
    path.join(root, "scripts/check-test-inventory.mjs"),
    path.join(dir, "scripts/check-test-inventory.mjs"),
  );
  copyFileSync(
    path.join(root, "vitest.setup.ts"),
    path.join(dir, "vitest.setup.ts"),
  );
  writeFileSync(path.join(dir, "vitest.config.mts"), config);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: {
        test: realScripts.test,
        "test:ci": realScripts["test:ci"],
        ...scripts,
      },
    }),
  );
  for (const file of [
    "src/lib/a.test.ts",
    "src/components/b.test.tsx",
    "tests/tooling/c.test.ts",
    ...extraFiles,
  ]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), A_TEST);
  }
  return dir;
}

/**
 * Runs the inventory the way `npm run <script>` does: no argument, with npm's
 * npm_lifecycle_event naming the script. `asArgument` uses the documented CLI form instead.
 */
function inventory(dir: string, script = "test", { asArgument = false } = {}) {
  const env = cleanEnv(["VITEST", "npm_"]);
  if (!asArgument) env.npm_lifecycle_event = script;
  const res = spawnSync(
    process.execPath,
    [
      path.join(dir, "scripts/check-test-inventory.mjs"),
      ...(asArgument ? [script] : []),
    ],
    { cwd: dir, encoding: "utf8", env },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** The real config with one exact piece of text replaced (and proof that it was there). */
function configWith(find: string, replace: string) {
  expect(realConfig.split(find)).toHaveLength(2);
  return realConfig.replace(find, replace);
}

describe("check-test-inventory.mjs", () => {
  it.each(["test", "test:ci"])(
    "passes when `npm run %s` collects every test file",
    (script) => {
      const res = inventory(project(), script);
      expect(res.stderr).toBe("");
      expect(res.status, res.stdout + res.stderr).toBe(0);
      expect(res.stdout).toContain("all 3 test files are collected");
    },
  );

  it("fails when the config's include globs drop a folder", () => {
    const res = inventory(
      project({
        config: configWith(
          'include: ["src/**/*.test.ts", "tests/**/*.test.ts"],',
          'include: ["src/**/*.test.ts"],',
        ),
      }),
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain("tests/tooling/c.test.ts is never run");
  });

  it("fails when the npm script drops a project", () => {
    const res = inventory(
      project({ scripts: { test: "vitest run --project unit" } }),
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain("src/components/b.test.tsx is never run");
  });

  it("fails when a file is collected by two projects", () => {
    const res = inventory(
      project({
        config: configWith('"src/**/*.test.tsx"', '"src/**/*.test.{ts,tsx}"'),
      }),
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain(
      "src/lib/a.test.ts is collected more than once",
    );
  });

  it("fails on a test file name Vitest isn't set up to run", () => {
    const res = inventory(project({ extraFiles: ["src/lib/d.spec.ts"] }));
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain(
      "src/lib/d.spec.ts: Vitest doesn't run this file name",
    );
  });

  it("requires test:ci to run integration tests once they exist", () => {
    const dir = project({ extraFiles: ["src/lib/e.int.test.ts"] });
    const unit = inventory(dir, "test");
    expect(unit.status, unit.stdout + unit.stderr).toBe(0);
    const ci = inventory(dir, "test:ci");
    expect(ci.status, ci.stdout + ci.stderr).toBe(1);
    expect(ci.stderr).toContain("src/lib/e.int.test.ts is never run");
  });

  it("also accepts the script name as an argument", () => {
    const dir = project({ extraFiles: ["src/lib/e.int.test.ts"] });
    const ci = inventory(dir, "test:ci", { asArgument: true });
    expect(ci.status, ci.stdout + ci.stderr).toBe(1);
    expect(ci.stderr).toContain("src/lib/e.int.test.ts is never run");
  });

  it("fails when a file runs in the wrong project", () => {
    const res = inventory(
      project({
        config: configWith(
          'include: ["src/**/*.test.tsx", "tests/**/*.test.tsx"],',
          'include: ["src/**/*.test.tsx", "tests/**/*.test.ts"],',
        ).replace(
          'include: ["src/**/*.test.ts", "tests/**/*.test.ts"],',
          'include: ["src/**/*.test.ts"],',
        ),
      }),
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain(
      'tests/tooling/c.test.ts runs in "unit-dom", expected "unit"',
    );
  });

  it("fails when `npm run test` would also run integration tests", () => {
    const res = inventory(
      project({
        config: configWith(
          '"**/*.int.test.ts", "tests/e2e/**"',
          '"tests/e2e/**"',
        ),
        extraFiles: ["src/lib/e.int.test.ts"],
      }),
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain(
      `src/lib/e.int.test.ts runs in "unit" but shouldn't run here`,
    );
  });
});
