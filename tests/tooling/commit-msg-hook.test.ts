import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanEnv, repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// The commit-msg hook keeps AI attribution out of git history (CLAUDE.md rule 7) and enforces
// Conventional Commits. Runs the real hook on message files in a temp folder.
vi.setConfig({ testTimeout: 60_000 });

const HOOK = path.join(root, "scripts/hooks/commit-msg.mjs");
const dirs = tempDirs("teachback-commitmsg-");
afterAll(() => dirs.removeAll());
const env = cleanEnv(["GIT_"]);

/** Runs the hook on a message; returns the exit status, stderr and the rewritten message. */
function runHook(message: string) {
  const file = path.join(dirs.make(), "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const res = spawnSync(process.execPath, [HOOK, file], {
    env,
    encoding: "utf8",
  });
  return {
    status: res.status,
    stderr: res.stderr,
    message: readFileSync(file, "utf8"),
  };
}

describe("commit-msg hook: AI attribution", () => {
  it("strips every form of AI attribution and keeps everything else", () => {
    const { status, message } = runHook(
      [
        "feat(ui): add the nav bar (#5)",
        "",
        "Asked Claude to draft the layout, then trimmed it.",
        "Co-authored-by: Alex Example <alex@example.com>",
        "Co-Authored-By: Claude <noreply@anthropic.com>",
        "Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>",
        "co-authored-by: Helper Bot <bot@anthropic.com>",
        "Claude-Session: https://claude.ai/code/session_0123456789",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
        "Generated with Claude Code",
        "",
      ].join("\n"),
    );
    expect(status).toBe(0);
    expect(message).toBe(
      [
        "feat(ui): add the nav bar (#5)",
        "",
        "Asked Claude to draft the layout, then trimmed it.",
        "Co-authored-by: Alex Example <alex@example.com>",
        "",
      ].join("\n"),
    );
  });

  it("strips attribution written with Windows line endings", () => {
    const { message } = runHook(
      "fix(api): handle empty notes (#9)\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n",
    );
    expect(message).toBe("fix(api): handle empty notes (#9)\n");
  });
});

describe("commit-msg hook: Conventional Commits", () => {
  it.each([
    "feat(ui): add the nav bar (#5)",
    "fix: stop polling after a failed upload (#15)",
    "chore(deps): sync lockfile engines with package.json (#1)",
    "refactor(api)!: rename the error codes (#12)",
  ])("accepts %s", (subject) => {
    expect(runHook(`${subject}\n`).status).toBe(0);
  });

  it.each([
    "Added stuff",
    "feat add the nav bar",
    "feature(ui): add the nav bar (#5)",
    "feat(UI): add the nav bar (#5)",
    "feat: ",
    // Look like git's own messages but aren't.
    "Merged the nav bar",
    "Reverting stuff",
    "fixup without the marker",
    // The summary after "type: " is capped at 100 characters.
    `feat: ${"x".repeat(101)}`,
  ])("rejects %s", (subject) => {
    const { status, stderr } = runHook(`${subject}\n`);
    expect(status).toBe(1);
    expect(stderr).toContain("Commit message must follow Conventional Commits");
  });

  it("only warns when the issue number is missing", () => {
    const { status, stderr } = runHook("docs: fix a typo\n");
    expect(status).toBe(0);
    expect(stderr).toContain("end the subject with the issue number");
  });

  it("accepts a summary of exactly 100 characters", () => {
    expect(runHook(`feat: ${"x".repeat(100)}\n`).status).toBe(0);
  });

  it.each([
    "Merge branch 'main' into feature",
    "Merge branches 'a' and 'b'",
    "Merge remote-tracking branch 'origin/main' into feature",
    "Merge pull request #12 from someone/feature",
    "Merge commit 'abc1234'",
    "Merge tag 'v1.0.0'",
    'Revert "feat: add x"',
    "fixup! feat: add x",
    "squash! feat: add x",
  ])("allows the message git writes itself: %s", (subject) => {
    expect(runHook(`${subject}\n`).status).toBe(0);
  });
});

describe("commit-msg hook: wiring", () => {
  it("git runs it through .githooks/commit-msg and it rewrites the message", () => {
    const repo = dirs.make();
    execFileSync("git", ["init", "-q"], { cwd: repo, env });
    cpSync(path.join(root, ".githooks"), path.join(repo, ".githooks"), {
      recursive: true,
    });
    cpSync(path.join(root, "scripts"), path.join(repo, "scripts"), {
      recursive: true,
      filter: (src) => !src.endsWith(".json"),
    });
    execFileSync(process.execPath, ["scripts/install-hooks.mjs"], {
      cwd: repo,
      env,
    });
    const file = path.join(repo, "MSG");
    writeFileSync(
      file,
      "feat: x (#1)\n\nClaude-Session: https://claude.ai/code/session_1\n",
    );
    const res = spawnSync("git", ["hook", "run", "commit-msg", "--", file], {
      cwd: repo,
      env,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("feat: x (#1)\n");
  });
});
