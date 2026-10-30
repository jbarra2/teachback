// pre-commit: block secrets and forbidden files, then format/lint the staged files. Keep it fast.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const staged = git([
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMR",
  "-z",
])
  .split("\0")
  .filter(Boolean);
if (staged.length === 0) process.exit(0);

const problems = [];
const FORBIDDEN = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(local|development|production)(\.local)?$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)$/,
];
const SECRETS = [
  ["an Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  [
    "a database URL with a password for a remote host",
    /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!localhost\b|127\.0\.0\.1\b|db\b|db-test\b)[\w.-]+/,
  ],
];
const MAX_BYTES = 5 * 1024 * 1024;

for (const file of staged) {
  if (FORBIDDEN.some((re) => re.test(file))) {
    problems.push(
      `${file}: this file must never be committed (unstage it: git restore --staged "${file}")`,
    );
    continue;
  }
  const size = Number(git(["cat-file", "-s", `:${file}`]).trim());
  if (size > MAX_BYTES) {
    problems.push(
      `${file}: ${(size / 1048576).toFixed(1)} MB is too large (max 5 MB)`,
    );
    continue;
  }
  const content = git(["show", `:${file}`]);
  if (content.includes("\0")) continue; // binary
  content.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("gitleaks:allow")) return; // same marker the CI secret scan honours
    for (const [name, re] of SECRETS)
      if (re.test(line)) problems.push(`${file}:${i + 1}: looks like ${name}`);
  });
}

// Format + lint the staged files (only once tooling is installed by T01).
const exists = (f) => existsSync(f);
const node = (args) =>
  spawnSync(process.execPath, args, { stdio: "inherit" }).status === 0;
const fmtFiles = staged.filter(
  (f) => /\.(c|m)?[jt]sx?$|\.(json|md|ya?ml|css)$/.test(f) && exists(f),
);
const lintFiles = staged.filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && exists(f));
const PRETTIER = "node_modules/prettier/bin/prettier.cjs";
const ESLINT = "node_modules/eslint/bin/eslint.js";
if (
  fmtFiles.length &&
  exists(PRETTIER) &&
  !node([PRETTIER, "--check", "--ignore-unknown", ...fmtFiles])
)
  problems.push(
    "Formatting: run `npm run format`, then `git add` the files again",
  );
if (
  lintFiles.length &&
  exists(ESLINT) &&
  !node([ESLINT, "--max-warnings=0", "--no-warn-ignored", ...lintFiles])
)
  problems.push(
    "ESLint errors above: fix them (or ask Claude), then `git add` again",
  );

if (problems.length) {
  console.error("\n✖ Commit blocked by pre-commit checks:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nIf a match is a false positive, add the comment `gitleaks:allow` on that line.\n",
  );
  process.exit(1);
}
