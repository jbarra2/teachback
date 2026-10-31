import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// scripts/setup.mjs refuses an npm outside package.json's devEngines range before it changes
// anything. Runs a copy of the real script (so its root is a temp folder) with a PATH that holds
// only a stub npm. When the npm check passes, the run stops at "Git is not installed", before any
// step that writes files or starts containers.
vi.setConfig({ testTimeout: 60_000 });

const dirs = tempDirs("teachback-setup-");
afterAll(() => dirs.removeAll());

/** Runs the setup prerequisites with a stub npm that prints `version` (if any) and exits `status`. */
function runSetup(version: string | null, status = version === null ? 1 : 0) {
  const dir = dirs.make();
  mkdirSync(path.join(dir, "scripts"));
  cpSync(
    path.join(root, "scripts/setup.mjs"),
    path.join(dir, "scripts/setup.mjs"),
  );
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  // POSIX: spawnSync finds `npm` on PATH. Windows: setup runs through cmd.exe, which finds npm.cmd.
  writeFileSync(
    path.join(bin, "npm"),
    `#!/bin/sh\n${version ? `echo ${version}\n` : ""}exit ${status}\n`,
  );
  chmodSync(path.join(bin, "npm"), 0o755);
  writeFileSync(
    path.join(bin, "npm.cmd"),
    `@echo off\r\n${version ? `echo ${version}\r\n` : ""}exit /b ${status}\r\n`,
  );
  // Windows keeps the variable as `Path`; drop every spelling so only the stub folder is searched.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = bin;
  const res = spawnSync(
    process.execPath,
    [path.join(dir, "scripts/setup.mjs"), "--skip-verify"],
    { env, encoding: "utf8" },
  );
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    wroteEnv: existsSync(path.join(dir, ".env")),
  };
}

describe("setup.mjs npm check (package.json devEngines: >=11.11.0 <12)", () => {
  // 12.11.0: a high minor on the wrong major must still be refused.
  it.each(["10.9.3", "11.0.0", "11.10.1", "12.0.0", "12.11.0", "garbage"])(
    "refuses npm %s with an install hint",
    (version) => {
      const res = runSetup(version);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(`npm ${version} isn't the team's version`);
      expect(res.stderr).toContain("npm install -g npm@11");
      expect(res.wroteEnv).toBe(false);
    },
  );

  it("refuses an npm that fails to run (EBADDEVENGINES)", () => {
    const res = runSetup(null);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("This npm isn't the team's version");
    expect(res.wroteEnv).toBe(false);
  });

  it("refuses an npm that prints a good version but exits with an error", () => {
    const res = runSetup("11.19.1", 1);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("npm 11.19.1 isn't the team's version");
    expect(res.wroteEnv).toBe(false);
  });

  it.each(["11.11.0", "11.19.1"])("accepts npm %s", (version) => {
    const res = runSetup(version);
    expect(res.stdout).toContain(`✓ npm ${version}`);
    // The next prerequisite fails because the stub PATH has no git, so nothing else runs.
    expect(res.stderr).toContain("Git is not installed");
    expect(res.wroteEnv).toBe(false);
  });
});
