import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// Step 2 of scripts/setup.mjs creates .env, or updates one that exists, without ever overwriting
// a value. Runs a copy of the real script (so its root is a temp folder holding .env.example) with
// a PATH that holds only stub git, docker, gh and npm that all succeed. With no package.json or
// docker-compose.yml there, every step after .env is skipped.
vi.setConfig({ testTimeout: 60_000 });

const dirs = tempDirs("teachback-setup-env-");
afterAll(() => dirs.removeAll());

const example = readFileSync(path.join(root, ".env.example"), "utf8");
const { devEngines } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { devEngines: { packageManager: { version: string } } };
const npmVersion = /^>=(\d+\.\d+\.\d+) /.exec(
  devEngines.packageManager.version,
)?.[1];
if (!npmVersion)
  throw new Error("devEngines changed shape: update setup.mjs and this test");

const stubs = {
  npm: npmVersion,
  git: "git version 2.51.0",
  docker: "Docker version 28.5.0",
  gh: "gh version 2.80.0",
};

/** A temp project holding a copy of setup.mjs, .env.example and the stub commands. */
function project() {
  const dir = dirs.make();
  mkdirSync(path.join(dir, "scripts"));
  cpSync(
    path.join(root, "scripts/setup.mjs"),
    path.join(dir, "scripts/setup.mjs"),
  );
  cpSync(path.join(root, ".env.example"), path.join(dir, ".env.example"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  // POSIX: spawnSync finds the sh stub on PATH. Windows: setup runs through cmd.exe, which finds the .cmd.
  for (const [name, version] of Object.entries(stubs)) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho ${version}\n`);
    chmodSync(path.join(bin, name), 0o755);
    writeFileSync(
      path.join(bin, `${name}.cmd`),
      `@echo off\r\necho ${version}\r\n`,
    );
  }
  return { dir, env: path.join(dir, ".env") };
}

function runSetup(dir: string) {
  // Windows keeps the variable as `Path`; drop every spelling so only the stub folder is searched.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = path.join(dir, "bin");
  // spawnSync blocks the worker, so Vitest's timeout can't stop a hung run; this one can.
  const res = spawnSync(
    process.execPath,
    [path.join(dir, "scripts/setup.mjs"), "--skip-verify"],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  expect(res.error).toBeUndefined();
  return res;
}

const SECRET_LINE = /^BETTER_AUTH_SECRET=.*$/m;
const secretOf = (env: string) => /^BETTER_AUTH_SECRET=(.*)$/m.exec(env)?.[1];
// randomBytes(32) in base64.
const GENERATED = /^[A-Za-z0-9+/]{43}=$/;
// A .env someone already set up: a real secret and their own database URL.
const complete = example
  .replace(SECRET_LINE, "BETTER_AUTH_SECRET=kept-secret-value")
  .replace(
    /^DATABASE_URL=.*$/m,
    "DATABASE_URL=postgresql://me:pw@127.0.0.1:5999/mine",
  );

describe("setup.mjs creates .env when there is none", () => {
  it("copies .env.example and generates the secret", () => {
    const { dir, env } = project();
    const res = runSetup(dir);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ Created .env from .env.example");
    expect(res.stdout).toContain("✓ Generated BETTER_AUTH_SECRET");
    const written = readFileSync(env, "utf8");
    expect(secretOf(written)).toMatch(GENERATED);
    // Every other line is the example's.
    expect(written.replace(SECRET_LINE, "")).toBe(
      example.replace(SECRET_LINE, ""),
    );
  });

  it("generates a new random secret for each .env", () => {
    const secrets = [project(), project()].map(({ dir, env }) => {
      expect(runSetup(dir).status).toBe(0);
      return secretOf(readFileSync(env, "utf8")) ?? "";
    });
    expect(secrets[0]).not.toBe(secrets[1]);
    for (const secret of secrets) {
      const bytes = Buffer.from(secret, "base64");
      expect(bytes).toHaveLength(32);
      expect(bytes.some((b) => b !== 0)).toBe(true);
    }
  });

  it("fills an existing empty .env from .env.example", () => {
    const { dir, env } = project();
    writeFileSync(env, "");
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ Created .env from .env.example");
    const written = readFileSync(env, "utf8");
    expect(secretOf(written)).toMatch(GENERATED);
    expect(written.replace(SECRET_LINE, "")).toBe(
      example.replace(SECRET_LINE, ""),
    );
  });

  // Windows ignores these mode bits: there a new file gets the folder's permissions.
  it.skipIf(process.platform === "win32")(
    "makes the new .env readable by its owner only",
    () => {
      const { dir, env } = project();
      expect(runSetup(dir).status).toBe(0);
      expect(statSync(env).mode & 0o777).toBe(0o600);
    },
  );

  it("never prints the secret", () => {
    const { dir, env } = project();
    const res = runSetup(dir);
    const secret = secretOf(readFileSync(env, "utf8"));
    expect(secret).toMatch(GENERATED);
    expect(res.stdout + res.stderr).not.toContain(secret);
  });

  it("changes nothing when it runs again", () => {
    const { dir, env } = project();
    expect(runSetup(dir).status).toBe(0);
    const first = readFileSync(env, "utf8");
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ .env already exists (not overwritten)");
    expect(res.stdout).not.toMatch(/Generated|Added/);
    expect(readFileSync(env, "utf8")).toBe(first);
  });
});

describe("setup.mjs updates an existing .env without overwriting a value", () => {
  it("leaves a complete .env as it is, without writing to it", () => {
    const { dir, env } = project();
    writeFileSync(env, complete);
    // An old modification time, so any write (even of the same bytes) shows.
    const old = new Date("2026-01-01T00:00:00Z");
    utimesSync(env, old, old);
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ .env already exists (not overwritten)");
    expect(res.stdout).not.toMatch(/Generated|Added/);
    expect(readFileSync(env, "utf8")).toBe(complete);
    expect(statSync(env).mtimeMs).toBe(old.getTime());
  });

  // An older setup copied .env.example's mode (often 0644), so others could read the secret.
  it.skipIf(process.platform === "win32")(
    "makes an existing .env readable by its owner only, without changing it",
    () => {
      const { dir, env } = project();
      writeFileSync(env, complete);
      chmodSync(env, 0o644);
      const res = runSetup(dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✓ Made .env readable by you only");
      expect(statSync(env).mode & 0o777).toBe(0o600);
      expect(readFileSync(env, "utf8")).toBe(complete);
      // Already private: nothing to say the next time.
      expect(runSetup(dir).stdout).not.toContain("readable by you only");
    },
  );

  it("adds a secret to a .env that has no secret line", () => {
    const { dir, env } = project();
    writeFileSync(env, complete.replace(/^BETTER_AUTH_SECRET=.*\n/m, ""));
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ Generated BETTER_AUTH_SECRET");
    const written = readFileSync(env, "utf8");
    expect(written.match(/^BETTER_AUTH_SECRET=/gm)).toHaveLength(1);
    expect(secretOf(written)).toMatch(GENERATED);
    expect(written).not.toContain("replace-me");
    for (const line of example.match(/^[A-Z0-9_]+=/gm) ?? [])
      expect(written).toMatch(new RegExp(`^${line}`, "m"));
  });

  it("replaces a placeholder secret and keeps every other value", () => {
    const { dir, env } = project();
    const placeholder = complete.replace(
      SECRET_LINE,
      "BETTER_AUTH_SECRET=replace-me",
    );
    writeFileSync(env, placeholder);
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✓ Generated BETTER_AUTH_SECRET");
    const written = readFileSync(env, "utf8");
    expect(secretOf(written)).toMatch(GENERATED);
    expect(written.replace(SECRET_LINE, "")).toBe(
      placeholder.replace(SECRET_LINE, ""),
    );
  });

  it("leaves nothing of the old file behind when the result is shorter", () => {
    const { dir, env } = project();
    // Trailing spaces count as a placeholder too, and the new line is shorter than this one.
    const padded = complete.replace(
      SECRET_LINE,
      `BETTER_AUTH_SECRET=replace-me${" ".repeat(60)}`,
    );
    writeFileSync(env, padded);
    expect(runSetup(dir).status).toBe(0);
    const written = readFileSync(env, "utf8");
    expect(secretOf(written)).toMatch(GENERATED);
    expect(written.length).toBeLessThan(padded.length);
    expect(written.replace(SECRET_LINE, "")).toBe(
      padded.replace(SECRET_LINE, ""),
    );
  });

  it("adds variables that are new in .env.example and keeps the rest", () => {
    const { dir, env } = project();
    // A .env made before the example's last two variables existed.
    const added = (example.match(/^[A-Z0-9_]+=.*$/gm) ?? []).slice(-2);
    expect(added).toHaveLength(2);
    const older = added.reduce(
      (text, line) =>
        text.replace(new RegExp(`^${line.split("=")[0]}=.*\\n`, "m"), ""),
      complete,
    );
    writeFileSync(env, older);
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    const names = added.map((line) => line.split("=")[0]);
    expect(res.stdout).toContain(
      `✓ Added 2 new variable(s) from .env.example: ${names.join(", ")}`,
    );
    expect(readFileSync(env, "utf8")).toBe(
      `${older.trimEnd()}\n\n# Added by setup from .env.example\n${added.join("\n")}\n`,
    );
  });

  it("makes both changes in one run: a new secret and the new variables", () => {
    const { dir, env } = project();
    const last = (example.match(/^[A-Z0-9_]+=.*$/gm) ?? []).at(-1) ?? "";
    const older = complete
      .replace(SECRET_LINE, "BETTER_AUTH_SECRET=")
      .replace(`${last}\n`, "");
    expect(older).not.toContain(last);
    writeFileSync(env, older);
    const res = runSetup(dir);
    expect(res.status).toBe(0);
    const written = readFileSync(env, "utf8");
    expect(secretOf(written)).toMatch(GENERATED);
    expect(written).toContain(`# Added by setup from .env.example\n${last}\n`);
    expect(written).toContain(
      "DATABASE_URL=postgresql://me:pw@127.0.0.1:5999/mine",
    );
  });
});

describe("setup.mjs stops before writing when .env can't be used", () => {
  it("stops with a message when .env is a folder", () => {
    const { dir, env } = project();
    mkdirSync(env);
    const res = runSetup(dir);
    expect(res.status).toBe(1);
    // Linux refuses to open a folder for writing; Windows opens it, and the type check stops it.
    expect(res.stderr).toContain(
      process.platform === "win32"
        ? "✖ .env isn't a regular file."
        : "✖ Setup can't open or create .env (EISDIR).",
    );
    expect(res.stderr).toContain("How to fix:");
    // die()'s message, not a crash.
    expect(res.stderr).not.toMatch(/^\s+at /m);
    expect(readdirSync(env)).toEqual([]);
  });

  // The type check on POSIX: a link to a device opens fine, and only fstat sees it isn't a file.
  it.skipIf(process.platform === "win32")(
    "stops with a message when .env leads to something that isn't a file",
    () => {
      const { dir, env } = project();
      symlinkSync("/dev/null", env);
      const res = runSetup(dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("✖ .env isn't a regular file.");
      expect(res.stderr).not.toMatch(/^\s+at /m);
    },
  );

  // CodeQL's file-system-race check pairs any two calls on the same path. Naming .env once, in
  // the open, keeps every read and write on that handle, so another process can't swap the file.
  it("names .env in one place, the open: everything else uses the handle", () => {
    const source = readFileSync(path.join(root, "scripts/setup.mjs"), "utf8");
    expect(source.match(/(["'`])\.env\1/g)).toEqual(['".env"']);
    expect(source).toMatch(/openSync\(\s*"\.env",/);
  });

  // Root can write any file, so this needs a normal user (as on CI and a laptop).
  it.skipIf(process.getuid?.() === 0)(
    "stops with a message when .env is read-only, and leaves it as it was",
    () => {
      const { dir, env } = project();
      const placeholder = complete.replace(
        SECRET_LINE,
        "BETTER_AUTH_SECRET=replace-me",
      );
      writeFileSync(env, placeholder);
      chmodSync(env, 0o444);
      try {
        const res = runSetup(dir);
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(
          /✖ Setup can't open or create \.env \((EACCES|EPERM)\)\./,
        );
        expect(res.stderr).not.toMatch(/^\s+at /m);
        expect(readFileSync(env, "utf8")).toBe(placeholder);
      } finally {
        chmodSync(env, 0o644); // so the temp folder can be deleted on Windows
      }
    },
  );

  it("stops when .env.example is missing", () => {
    const { dir, env } = project();
    rmSync(path.join(dir, ".env.example"));
    const res = runSetup(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("✖ .env.example is missing from the repo.");
    expect(() => statSync(env)).toThrow();
  });
});
