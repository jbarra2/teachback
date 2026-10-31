// pre-commit: block secrets and forbidden files, then format/lint the staged files. Keep it fast.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const staged = git([
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMRT",
  "-z",
])
  .split("\0")
  .filter(Boolean);
if (staged.length === 0) process.exit(0);

const problems = [];
// Every .env file (.env, .env.local, .env.bak, .envrc, .env-prod, ...) except the two committed templates.
const ENV_TEMPLATE = /(^|\/)\.env\.(example|test)$/;
const FORBIDDEN = [
  /(^|\/)\.env[^/]*$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)$/,
];
const SECRETS = [
  ["an Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["a GitHub token", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  // `npm run setup` generates this as 32 random bytes in base64.
  [
    "a Better Auth secret",
    /BETTER_AUTH_SECRET\s*[=:]\s*["']?[A-Za-z0-9+/]{32,}/,
  ],
  [
    "a database URL with a password for a remote host",
    // Local hosts are allowed only as the whole host name, so db.example.com is still caught.
    /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!(?:localhost|127\.0\.0\.1|db|db-test)(?![\w.-]))[\w.-]+/i,
  ],
];
const MAX_BYTES = 5 * 1024 * 1024;

// Windows PowerShell 5.1 writes `>` output as UTF-16 with a byte-order mark, so decode that too.
// Returns null for binary files (NUL bytes after decoding).
function decode(buf) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe)
    text = buf.subarray(2).toString("utf16le");
  else if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
    text = le.swap16().toString("utf16le");
  } else text = buf.toString("utf8");
  return text.includes("\0") ? null : text;
}

for (const file of staged) {
  if (!ENV_TEMPLATE.test(file) && FORBIDDEN.some((re) => re.test(file))) {
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
  const content = decode(
    execFileSync("git", ["show", `:${file}`], { maxBuffer: 64 * 1024 * 1024 }),
  );
  if (content === null) continue; // binary
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
