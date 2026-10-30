#!/usr/bin/env node
/**
 * One-command local setup. Safe to re-run. Windows, macOS and Linux. Node built-ins only.
 *
 *   npm run setup                 (or `node scripts/setup.mjs` before T01 adds package.json)
 *   npm run setup -- --skip-verify   skip the final checks
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const flags = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const notes = [];

const ok = (m) => console.log(`  ✓ ${m}`);
const skip = (m) => console.log(`  - ${m}`);
const warn = (m) => {
  console.log(`  ! ${m}`);
  notes.push(m);
};
const section = (t) => console.log(`\n${t}`);
function die(problem, fix) {
  console.error(`\n✖ ${problem}`);
  if (fix) console.error(`  How to fix: ${fix}`);
  console.error("\nFix that, then run the setup again (it's safe to re-run).");
  process.exit(1);
}

// Windows needs a shell to find npm.cmd etc.; pass one command string to avoid arg-quoting issues.
function run(cmd, args = [], { quiet = false } = {}) {
  const opts = { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" };
  return isWin
    ? spawnSync([cmd, ...args].join(" "), { ...opts, shell: true })
    : spawnSync(cmd, args, opts);
}
const succeeds = (cmd, args) => run(cmd, args, { quiet: true }).status === 0;
const output = (cmd, args) =>
  (run(cmd, args, { quiet: true }).stdout || "").trim();

const installHint = {
  node: isWin
    ? "winget install OpenJS.NodeJS.LTS"
    : "install the LTS from https://nodejs.org  (or: brew install node)",
  git: isWin
    ? "winget install Git.Git"
    : "xcode-select --install  (or brew install git)",
  docker: isWin
    ? "Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and accept the WSL 2 option"
    : "Install Docker Desktop (https://www.docker.com/products/docker-desktop/)",
  gh: isWin
    ? "winget install --id GitHub.cli, then: gh auth login"
    : "brew install gh, then: gh auth login",
};

console.log("TeachBack setup\n===============");

// 1. Prerequisites -----------------------------------------------------------
section("1. Prerequisites");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22)
  die(`Node ${process.versions.node} is too old (need 22+).`, installHint.node);
ok(`Node ${process.versions.node}`);

if (!succeeds("git", ["--version"]))
  die("Git is not installed.", installHint.git);
ok(output("git", ["--version"]));

if (!succeeds("docker", ["--version"]))
  die("Docker is not installed.", installHint.docker);
if (!succeeds("docker", ["info"]))
  die(
    "Docker is installed but not running.",
    "Start Docker Desktop and wait for 'Engine running', then re-run.",
  );
if (!succeeds("docker", ["compose", "version"]))
  die("Docker Compose v2 is missing.", "Update Docker Desktop.");
ok("Docker is running");

if (!succeeds("gh", ["--version"]))
  warn(
    `GitHub CLI not installed (needed for /next-task etc.): ${installHint.gh}`,
  );
else if (!succeeds("gh", ["api", "user", "--jq", ".login"]))
  warn(
    "GitHub CLI can't reach GitHub with your login: run `gh auth status`, then `gh auth login`",
  );
else ok("GitHub CLI signed in");

// 2. Environment file -------------------------------------------------------
section("2. Environment (.env)");
if (!existsSync(".env.example"))
  die(".env.example is missing from the repo.", "Pull the latest main.");
if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  ok("Created .env from .env.example");
} else ok(".env already exists (not overwritten)");

let env = readFileSync(".env", "utf8");
const secretLine = env.match(/^BETTER_AUTH_SECRET=(.*)$/m);
if (!secretLine || ["", "replace-me"].includes(secretLine[1].trim())) {
  const secret = randomBytes(32).toString("base64");
  env = secretLine
    ? env.replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${secret}`)
    : `${env.trimEnd()}\nBETTER_AUTH_SECRET=${secret}\n`;
  writeFileSync(".env", env);
  ok("Generated BETTER_AUTH_SECRET");
}
// Add any variables that were added to .env.example since this .env was created (never overwrite).
const exampleVars =
  readFileSync(".env.example", "utf8").match(/^[A-Z0-9_]+=.*$/gm) || [];
const missing = exampleVars.filter(
  (line) => !new RegExp(`^${line.split("=")[0]}=`, "m").test(env),
);
if (missing.length) {
  env = `${env.trimEnd()}\n\n# Added by setup from .env.example\n${missing.join("\n")}\n`;
  writeFileSync(".env", env);
  ok(
    `Added ${missing.length} new variable(s) from .env.example: ${missing.map((l) => l.split("=")[0]).join(", ")}`,
  );
}
const provider = (env.match(/^AI_PROVIDER=(.*)$/m) || [])[1]?.trim();
const apiKey = (env.match(/^ANTHROPIC_API_KEY=(.*)$/m) || [])[1]?.trim();
if (provider === "anthropic" && !apiKey)
  warn("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty in .env");
else ok(`AI provider: ${provider || "fake"}`);

// 3. Dependencies -----------------------------------------------------------
section("3. Dependencies");
const hasPkg = existsSync("package.json");
const scripts = hasPkg
  ? JSON.parse(readFileSync("package.json", "utf8")).scripts || {}
  : {};
const hasScript = (name) => Boolean(scripts[name]);
if (!hasPkg) skip("No package.json yet (T01 not merged). Skipping app steps.");
else {
  if (run("npm", ["install"]).status !== 0)
    die("npm install failed.", "Read the error above; ask Claude to help.");
  ok("npm install");
  if (existsSync("scripts/install-hooks.mjs")) {
    // Run node directly (no shell): its path can contain spaces, e.g. C:\Program Files\nodejs\node.exe
    spawnSync(process.execPath, ["scripts/install-hooks.mjs"], {
      stdio: "ignore",
    });
    ok("Git hooks enabled (.githooks)");
  }
}

// 4. Databases --------------------------------------------------------------
section("4. Databases (Docker)");
if (!existsSync("docker-compose.yml")) skip("No docker-compose.yml yet.");
else {
  if (
    run("docker", ["compose", "up", "-d", "--wait", "db", "db-test"]).status !==
    0
  )
    die(
      "Could not start the Postgres containers.",
      "Is something else using ports 5433/5434? Stop it, or ask the lead. Check `docker compose ps`.",
    );
  ok("Postgres running: dev on localhost:5433, test on localhost:5434");
}

// 5. Migrations + seed ------------------------------------------------------
section("5. Database schema + demo data");
if (hasScript("db:update")) {
  if (run("npm", ["run", "db:update"]).status !== 0)
    die("Migrations failed.", "Read the error above.");
  ok("Migrations applied");
} else skip("db:update not available yet (arrives with T02)");
if (hasScript("db:seed")) {
  if (run("npm", ["run", "db:seed"]).status !== 0)
    warn("Seeding failed (the app still works without demo data).");
  else ok("Demo data loaded (accounts in README)");
} else skip("db:seed not available yet (arrives with T08)");

// 6. Verify -----------------------------------------------------------------
section("6. Quick verification");
if (flags.has("--skip-verify")) skip("Skipped (--skip-verify)");
else {
  for (const name of ["check", "test:int"]) {
    if (!hasScript(name)) {
      skip(`npm run ${name} not available yet`);
      continue;
    }
    if (run("npm", ["run", name]).status === 0) ok(`npm run ${name}`);
    else
      warn(
        `npm run ${name} failed. Setup is done, but tell the lead or ask Claude to investigate.`,
      );
  }
}

// Summary -------------------------------------------------------------------
console.log("\n===============");
console.log(
  notes.length
    ? `Setup finished with ${notes.length} note(s):`
    : "Setup finished. You're ready.",
);
for (const n of notes) console.log(`  ! ${n}`);
console.log(`
Next:
  1. npm run dev            → http://localhost:3000   (API docs: http://localhost:3000/api/docs)
  2. In Claude Code: /next-task
`);
