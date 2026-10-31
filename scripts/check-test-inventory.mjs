#!/usr/bin/env node
/**
 * Checks that an npm test script collects every test file on disk, each in the right Vitest
 * project, so a narrowed include glob or a dropped --project can't silently skip tests while the
 * run stays green. It runs before Vitest (outside Vitest's own include globs) from the test scripts.
 *
 *   node scripts/check-test-inventory.mjs           checks the npm script that called it
 *   node scripts/check-test-inventory.mjs test:ci   checks that script
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`\n✖ Test inventory: ${message}\n`);
  process.exit(1);
};

const scriptName = process.argv[2] ?? process.env.npm_lifecycle_event ?? "test";
const { scripts = {} } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const command = scripts[scriptName];
if (!command?.includes("vitest run"))
  fail(`package.json "${scriptName}" doesn't run \`vitest run\``);

// What each script must run (docs/TESTING.md §4), fixed here rather than read from the script,
// so dropping a --project from the script is caught. null means every test file.
const MUST_RUN = {
  test: ["unit", "unit-dom"],
  "test:int": ["integration"],
  "test:ci": null,
};
if (!(scriptName in MUST_RUN))
  fail(`no expectation for "${scriptName}" in check-test-inventory.mjs`);
const mustRun = MUST_RUN[scriptName];

// The --project filters the script actually passes to `vitest run` (none means every project).
const projects = [
  ...command
    .slice(command.indexOf("vitest run"))
    .matchAll(/--project[= ](\S+)/g),
].map((m) => m[1]);

// The project each test file belongs to, from its name.
const projectFor = (file) => {
  if (file.endsWith(".int.test.ts")) return "integration";
  if (file.endsWith(".test.tsx")) return "unit-dom";
  if (file.endsWith(".test.ts")) return "unit";
  return null;
};
const looksLikeATest = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

const problems = [];
const expected = new Map();
for (const dir of ["src", "tests", "scripts"])
  for (const entry of readdirSync(path.join(root, dir), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path
      .relative(root, path.join(entry.parentPath, entry.name))
      .replaceAll("\\", "/");
    if (file.startsWith("tests/e2e/")) continue; // Playwright, not Vitest
    const project = projectFor(file);
    if (!project) {
      if (looksLikeATest(file))
        problems.push(
          `${file}: Vitest doesn't run this file name. Use *.test.ts, *.test.tsx or *.int.test.ts`,
        );
      continue;
    }
    if (mustRun === null || mustRun.includes(project))
      expected.set(file, project);
  }

const list = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "list",
    "--filesOnly",
    "--json",
    ...projects.flatMap((p) => ["--project", p]),
  ],
  // Not inside another Vitest run's environment (the inventory's own tests run it from Vitest).
  {
    cwd: root,
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("VITEST")),
    ),
  },
);
if (list.status !== 0) fail(`\`vitest list\` failed:\n${list.stderr}`);
const collected = JSON.parse(list.stdout).map(({ file, projectName }) => ({
  file: path.relative(root, file).replaceAll("\\", "/"),
  project: projectName,
}));

const seen = new Set();
for (const { file, project } of collected) {
  if (seen.has(file)) problems.push(`${file} is collected more than once`);
  seen.add(file);
  const want = expected.get(file);
  if (!want)
    problems.push(`${file} runs in "${project}" but shouldn't run here`);
  else if (want !== project)
    problems.push(`${file} runs in "${project}", expected "${want}"`);
}
for (const [file, project] of expected)
  if (!seen.has(file))
    problems.push(`${file} is never run (expected in "${project}")`);

if (problems.length)
  fail(
    `\`npm run ${scriptName}\` doesn't run the right test files. Check vitest.config.mts and the script.\n  - ${problems.join("\n  - ")}`,
  );
console.log(
  `Test inventory: all ${expected.size} test files are collected by \`npm run ${scriptName}\`.`,
);
