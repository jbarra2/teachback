import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// scripts/setup.mjs refuses a Node or npm outside package.json's devEngines before it changes
// anything. Runs a copy of the real script (so its root is a temp folder holding .env.example)
// with a PATH that holds only a stub npm, or nothing. When both checks pass, the run stops at
// "Git is not installed", before any step that writes files or starts containers.
vi.setConfig({ testTimeout: 60_000 });

const dirs = tempDirs("teachback-setup-");
afterAll(() => dirs.removeAll());

// The cases come from devEngines, so changing the range without setup.mjs fails here.
const { devEngines } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as {
  devEngines: {
    runtime: { version: string };
    packageManager: { version: string };
  };
};
const npmRange = /^>=(\d+)\.(\d+)\.0 <(\d+)$/.exec(
  devEngines.packageManager.version,
);
const nodeRange = /^>=(\d+)$/.exec(devEngines.runtime.version);
if (!npmRange || !nodeRange)
  throw new Error("devEngines changed shape: update setup.mjs and this test");
const [major, minor, nextMajor] = npmRange.slice(1).map(Number);
const nodeFloor = Number(nodeRange[1]);

type Run = {
  /** What the stub npm prints. null: prints nothing. undefined: there is no npm at all. */
  npm?: string | null;
  npmStatus?: number;
  /** The version `process.versions.node` reports to the script. */
  node?: string;
};

function runSetup({ npm, npmStatus = npm === null ? 1 : 0, node }: Run) {
  const dir = dirs.make();
  mkdirSync(path.join(dir, "scripts"));
  cpSync(
    path.join(root, "scripts/setup.mjs"),
    path.join(dir, "scripts/setup.mjs"),
  );
  cpSync(path.join(root, ".env.example"), path.join(dir, ".env.example"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  if (npm !== undefined) {
    // POSIX: spawnSync finds `npm` on PATH. Windows: setup runs through cmd.exe, which finds npm.cmd.
    // Like real npm, the stub answers only `--version` with a bare version (exit 2 otherwise).
    const out = npm ?? "";
    writeFileSync(
      path.join(bin, "npm"),
      `#!/bin/sh\n[ "$1" = "--version" ] || exit 2\n${out ? `echo ${out}\n` : ""}exit ${npmStatus}\n`,
    );
    chmodSync(path.join(bin, "npm"), 0o755);
    writeFileSync(
      path.join(bin, "npm.cmd"),
      `@echo off\r\nif not "%~1"=="--version" exit /b 2\r\n${out ? `echo ${out}\r\n` : ""}exit /b ${npmStatus}\r\n`,
    );
  }
  const nodeArgs: string[] = [];
  if (node) {
    const preload = path.join(dir, "node-version.mjs");
    writeFileSync(
      preload,
      `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(node)} });\n`,
    );
    nodeArgs.push("--import", pathToFileURL(preload).href);
  }
  // Windows keeps the variable as `Path`; drop every spelling so only the stub folder is searched.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = bin;
  // spawnSync blocks the worker, so Vitest's timeout can't stop a hung run; this one can.
  const res = spawnSync(
    process.execPath,
    [...nodeArgs, path.join(dir, "scripts/setup.mjs"), "--skip-verify"],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  expect(res.error).toBeUndefined();
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    wroteEnv: existsSync(path.join(dir, ".env")),
  };
}

const goodNpm = `${major}.${minor}.0`;

describe(`setup.mjs Node check (devEngines: ${devEngines.runtime.version})`, () => {
  it.each([`${nodeFloor - 2}.14.0`, `${nodeFloor - 1}.11.0`])(
    "refuses Node %s",
    (node) => {
      const res = runSetup({ node, npm: goodNpm });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(
        `Node ${node} is too old (need ${nodeFloor} or newer)`,
      );
      expect(res.stdout).not.toContain("✓ npm");
      expect(res.wroteEnv).toBe(false);
    },
  );

  // The next LTS above the floor too: the range is open-ended, not "only this major".
  it.each([`${nodeFloor}.0.0`, `${nodeFloor + 2}.0.0`])(
    "accepts Node %s",
    (node) => {
      const res = runSetup({ node, npm: goodNpm });
      expect(res.stdout).toContain(`✓ Node ${node}`);
      expect(res.stdout).toContain(`✓ npm ${goodNpm}`);
    },
  );
});

describe(`setup.mjs npm check (devEngines: ${devEngines.packageManager.version})`, () => {
  it.each([
    `${major - 1}.9.3`,
    `${major}.0.0`,
    `${major}.${minor - 1}.1`,
    `${nextMajor}.0.0`,
    `${nextMajor}.${minor}.0`, // a high minor on the wrong major
    `${major}.${minor + 1}.0-pre.0`, // npm's own check refuses prereleases
    "garbage",
  ])("refuses npm %s with an install hint", (npm) => {
    const res = runSetup({ npm });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      `npm ${npm} isn't the team's version (need npm ${major}.${minor} or newer, below ${nextMajor})`,
    );
    expect(res.stderr).toContain(`npm install -g npm@${major}`);
    expect(res.wroteEnv).toBe(false);
  });

  it.each([
    ["prints nothing and fails", { npm: null }],
    ["isn't installed", { npm: undefined }],
  ])("refuses an npm that %s", (_, run) => {
    const res = runSetup(run);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("This npm isn't the team's version");
    expect(res.wroteEnv).toBe(false);
  });

  it("refuses an npm that prints a good version but exits with an error", () => {
    const res = runSetup({ npm: goodNpm, npmStatus: 1 });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`npm ${goodNpm} isn't the team's version`);
    expect(res.wroteEnv).toBe(false);
  });

  it.each([goodNpm, `${major}.${minor + 8}.1`])("accepts npm %s", (npm) => {
    const res = runSetup({ npm });
    expect(res.stdout).toContain(`✓ npm ${npm}`);
    // The next prerequisite fails because the stub PATH has no git, so nothing else runs.
    expect(res.stderr).toContain("Git is not installed");
    expect(res.wroteEnv).toBe(false);
  });
});
