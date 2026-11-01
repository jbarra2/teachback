#!/usr/bin/env node
/**
 * One-command local setup. Safe to re-run. Windows, macOS and Linux. Node built-ins only.
 *
 *   npm run setup                 (or `node scripts/setup.mjs` before T01 adds package.json)
 *   npm run setup -- --skip-verify   skip the final checks
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
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
  npm: `use the npm that comes with Node 24 or 26 (${isWin ? "winget install OpenJS.NodeJS.LTS" : "install the LTS from https://nodejs.org"}). If you upgraded npm yourself, run \`npm install -g npm@11\` from outside this folder.`,
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
// Matches package.json "devEngines". Each npm version writes package-lock.json a little
// differently, so the whole team uses the same range.
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 24)
  die(
    `Node ${process.versions.node} is too old (need 24 or newer).`,
    installHint.node,
  );
ok(`Node ${process.versions.node}`);

// npm enforces devEngines too: on another version `npm install` and `npm run` stop with
// EBADDEVENGINES. This check covers `node scripts/setup.mjs`, which npm never sees.
const npmCheck = run("npm", ["--version"], { quiet: true });
const npmVersion = (npmCheck.stdout || "").trim();
// Plain releases only: npm's own devEngines check refuses prereleases such as 11.12.0-pre.0.
const [, npmMajor, npmMinor] = (
  /^(\d+)\.(\d+)\.\d+$/.exec(npmVersion) ?? []
).map(Number);
if (npmCheck.status !== 0 || npmMajor !== 11 || !(npmMinor >= 11))
  die(
    `${npmVersion ? `npm ${npmVersion}` : "This npm"} isn't the team's version (need npm 11.11 or newer, below 12).`,
    installHint.npm,
  );
ok(`npm ${npmVersion}`);

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
let example;
try {
  example = readFileSync(".env.example", "utf8");
} catch (error) {
  if (error.code === "ENOENT")
    die(".env.example is missing from the repo.", "Pull the latest main.");
  die(
    `Setup can't read .env.example (${error.code ?? error.message}).`,
    "Restore it with `git checkout -- .env.example`, then re-run.",
  );
}
// .env is opened once, and every later step uses that handle, so another process can't swap the
// file between a check and a write. O_CREAT without O_TRUNC creates it if it's missing (owner-only,
// since it holds secrets) and never empties one that's there. An empty .env counts as new.
const moveAway = "Move it away so setup can make a new .env.";
let fd;
try {
  fd = openSync(".env", constants.O_RDWR | constants.O_CREAT, 0o600);
} catch (error) {
  // Not "move it away" for a read-only .env: a new one would lose the keys in this one.
  const readOnly = ["EACCES", "EPERM", "EROFS"].includes(error.code);
  const makeWritable = isWin
    ? "untick Read-only in its Properties"
    : 'run `chmod u+w .env`, or `sudo chown "$(id -un)" .env` if `ls -l .env` shows it isn\'t yours';
  die(
    `Setup can't open or create .env (${error.code ?? error.message}).`,
    readOnly
      ? `Setup needs to write .env: make it (and this folder) writable (${makeWritable}), then re-run.`
      : error.code === "EISDIR"
        ? moveAway
        : "Check that you can write to this folder and to .env, then re-run.",
  );
}
// Windows opens a folder too, and a link can lead to a device. fstat checks the open handle itself.
let envStat;
let before;
try {
  envStat = fstatSync(fd);
  if (envStat.isFile()) before = readFileSync(fd, "utf8");
} catch (error) {
  die(
    `Setup can't read .env (${error.code ?? error.message}).`,
    "Close any program that has .env open or locked, then re-run.",
  );
}
if (!envStat.isFile()) {
  closeSync(fd);
  die(".env isn't a regular file.", moveAway);
}
let env = before === "" ? example : before;
if (before === "") ok("Created .env from .env.example");
else ok(".env already exists (not overwritten)");
// An older setup copied .env.example's mode, often 0644. Windows has no such bits to change.
// It runs before anything is written: if the chmod fails (a .env someone else owns), setup stops
// rather than put the secret in a file others can read.
if (!isWin && (envStat.mode & 0o077) !== 0) {
  try {
    fchmodSync(fd, 0o600);
  } catch (error) {
    die(
      `Setup can't make .env readable by you only (${error.code ?? error.message}).`,
      "Make sure .env is yours and on a disk that keeps Unix permissions (not FAT or exFAT), or move it away so setup makes a new one, then re-run.",
    );
  }
  // Some disks (WSL's /mnt/c) accept the chmod but keep no Unix permissions.
  if ((fstatSync(fd).mode & 0o077) !== 0)
    warn(
      "This disk doesn't keep Unix permissions, so other users may be able to read .env",
    );
  else if (before !== "") ok("Made .env readable by you only");
}

const secretLine = env.match(/^BETTER_AUTH_SECRET=(.*)$/m);
if (!secretLine || ["", "replace-me"].includes(secretLine[1].trim())) {
  const secret = randomBytes(32).toString("base64");
  env = secretLine
    ? env.replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${secret}`)
    : `${env.trimEnd()}\nBETTER_AUTH_SECRET=${secret}\n`;
  ok("Generated BETTER_AUTH_SECRET");
}
// Add any variables that were added to .env.example since this .env was created (never overwrite).
const exampleVars = example.match(/^[A-Z0-9_]+=.*$/gm) || [];
const missing = exampleVars.filter(
  (line) => !new RegExp(`^${line.split("=")[0]}=`, "m").test(env),
);
if (missing.length) {
  env = `${env.trimEnd()}\n\n# Added by setup from .env.example\n${missing.join("\n")}\n`;
  ok(
    `Added ${missing.length} new variable(s) from .env.example: ${missing.map((l) => l.split("=")[0]).join(", ")}`,
  );
}
if (env !== before) {
  // Write from the start, then cut off what's left of the old text. Never truncated first, so a
  // failed write can't leave an existing .env empty.
  const bytes = Buffer.from(env, "utf8");
  try {
    for (let at = 0; at < bytes.length;)
      at += writeSync(fd, bytes, at, bytes.length - at, at);
    ftruncateSync(fd, bytes.length);
  } catch (error) {
    die(
      `Setup couldn't write .env (${error.code ?? error.message}).`,
      "Check that the disk isn't full and that .env still has your values, then re-run.",
    );
  }
}
closeSync(fd);
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
