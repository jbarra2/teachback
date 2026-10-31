import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Secrets stay out of git (matching what the pre-commit hook forbids), while the committed env
// templates stay in.
const root = path.resolve(import.meta.dirname, "../..");

/** The ignore file that ignores `file`, or null if nothing does. */
function ignoredBy(file: string) {
  // --no-index tests the patterns even for files git already tracks; -v names the matching file
  // and pattern as `<source>:<line>:<pattern>\t<path>`.
  const res = spawnSync(
    "git",
    ["check-ignore", "-v", "--no-index", "--", file],
    { cwd: root, encoding: "utf8" },
  );
  if (res.status === 1) return null;
  if (res.status !== 0) throw new Error(`git check-ignore failed for ${file}`);
  const [source, , pattern] = res.stdout.split("\t")[0].split(":");
  // With -v, a path whose last match is a negation (`!pattern`) is reported too: it isn't ignored.
  return pattern.startsWith("!") ? null : source;
}

describe(".gitignore", () => {
  // Checked against the repo's .gitignore specifically, so a teammate's global excludes file
  // can't make these pass.
  it.each([
    ".env",
    "prisma/.env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.development.local",
    ".env.production.local",
    ".env.test.local",
    ".env.bak",
    ".env.staging",
    "config/.env.old",
    ".envrc",
    ".env-prod",
    ".env_local",
    "certs/server.pem",
    "certs/api.key",
    "certs/client.p12",
    "certs/client.pfx",
    "id_rsa",
    ".ssh/id_ed25519",
    "id_ecdsa",
    ".claude/settings.local.json",
    "node_modules/next/package.json",
    "src/generated/prisma/client.ts",
    "coverage/index.html",
    ".next/server/app.js",
  ])("ignores %s", (file) => {
    expect(ignoredBy(file)).toBe(".gitignore");
  });

  it.each([
    ".env.example",
    ".env.test",
    "package-lock.json",
    "src/app/page.tsx",
    "src/lib/keyboard.ts",
    "docs/api-keys.md",
    ".githooks/pre-commit",
  ])("keeps %s tracked", (file) => {
    // Only the repo's own .gitignore matters here (it outranks personal ignore files), so a
    // teammate's global `.env*` can't fail this on their machine.
    expect(ignoredBy(file)).not.toBe(".gitignore");
  });
});
