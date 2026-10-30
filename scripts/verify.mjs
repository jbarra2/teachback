#!/usr/bin/env node
/**
 * The full local quality gate. Mirrors CI. Run before every PR (/test-task and /finish-task do).
 *
 *   npm run verify            everything (incl. e2e once tests/e2e exists)
 *   npm run verify -- --fast  skip build and e2e
 *
 * Steps whose npm script doesn't exist yet are skipped, so this works from T01 onward.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const fast = process.argv.includes("--fast");
const isWin = process.platform === "win32";

if (!existsSync("package.json")) {
  console.log("No package.json yet. Nothing to verify.");
  process.exit(0);
}
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts || {};

const STEPS = [
  ["format:check", "Formatting (Prettier)"],
  ["lint", "Lint (ESLint, security rules)"],
  ["typecheck", "Types (tsc)"],
  ["api:lint", "OpenAPI spec lint (Redocly)"],
  ["api:types:check", "Client types match openapi.yaml"],
  ["test:ci", "Unit + integration tests + coverage", { needsDb: true }],
  ["audit", "Dependency audit (high/critical)"],
  ["build", "Production build", { slow: true }],
  [
    "test:e2e",
    "E2E: happy path + security (Playwright)",
    { slow: true, needsDb: true },
  ],
];

function npmRun(name) {
  const t0 = Date.now();
  const res = isWin
    ? spawnSync(`npm run ${name}`, { stdio: "inherit", shell: true })
    : spawnSync("npm", ["run", name], { stdio: "inherit" });
  return { ok: res.status === 0, secs: ((Date.now() - t0) / 1000).toFixed(1) };
}

let dbReady = false;
function ensureTestDb() {
  if (dbReady || !existsSync("docker-compose.yml")) return true;
  const args = ["compose", "up", "-d", "--wait", "db-test"];
  const res = isWin
    ? spawnSync(["docker", ...args].join(" "), {
        stdio: "inherit",
        shell: true,
      })
    : spawnSync("docker", args, { stdio: "inherit" });
  dbReady = res.status === 0;
  return dbReady;
}

const results = [];
for (const [name, label, opts = {}] of STEPS) {
  if (!scripts[name]) {
    results.push([label, "skipped (not set up yet)", ""]);
    continue;
  }
  if (fast && opts.slow) {
    results.push([label, "skipped (--fast)", ""]);
    continue;
  }
  if (opts.needsDb && !ensureTestDb()) {
    results.push([
      label,
      "FAILED (test database not running: start Docker Desktop)",
      "",
    ]);
    continue;
  }
  console.log(`\n▶ ${label}  (npm run ${name})`);
  const r = npmRun(name);
  results.push([label, r.ok ? "passed" : "FAILED", `${r.secs}s`]);
}

const width = Math.max(...results.map(([l]) => l.length));
console.log("\nVerification summary\n--------------------");
for (const [label, status, secs] of results) {
  const icon =
    status === "passed" ? "✓" : status.startsWith("FAILED") ? "✖" : "-";
  console.log(`${icon} ${label.padEnd(width)}  ${status} ${secs}`);
}
const failed = results.filter(([, s]) => s.startsWith("FAILED")).length;
console.log(failed ? `\n${failed} step(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
