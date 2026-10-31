import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanEnv,
  linkNodeModules,
  repoRoot as root,
  tempDirs,
} from "../helpers/temp-dirs";

// Runs the real pre-commit hook against files staged in throwaway git repos.
// Fake secrets are assembled at runtime so this file never trips the hook or gitleaks itself.
// Each repo is a few git and node processes, so this file gets generous timeouts (it also runs
// inside the pre-push hook, next to the typed ESLint tests).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const HOOK = path.join(root, "scripts/hooks/pre-commit.mjs");
const fake = {
  anthropicKey: ["sk", "ant", "api03", "a1B2c3D4e5".repeat(4)].join("-"),
  anthropicAdminKey: ["sk", "ant", "admin01", "Q9w8E7r6T5".repeat(4)].join("-"),
  githubToken: (prefix: string) => [prefix, "Z9y8X7w6V5".repeat(4)].join("_"),
  githubFineGrained: [
    "github",
    "pat",
    "11ABCDEFG0",
    "x7Y6z5W4v3".repeat(6),
  ].join("_"),
  awsKey: ["AKIA", "IOSFODNN7EXAMPLE"].join(""),
  privateKey: (kind: string) =>
    ["-----BEGIN", kind, "PRIVATE", "KEY-----"].filter(Boolean).join(" "),
  dbUrl: (scheme: string, host: string) =>
    [`${scheme}:`, "", `app:hunter2@${host}/app`].join("/"),
  // The shape `npm run setup` generates: 32 random bytes in base64.
  authSecret: Buffer.alloc(32, 7).toString("base64"),
};

const dirs = tempDirs("teachback-hook-");
afterAll(() => dirs.removeAll());

// Git exports GIT_DIR and friends to hooks (absolute in a linked worktree). This file runs inside
// the pre-push hook via `npm run check`, so without this every git call below could act on the
// real repo instead of the temp one. An empty global config keeps a teammate's settings
// (signing, hooksPath, autocrlf, a personal attributes file) out of the temp repos too.
const env = cleanEnv(["GIT_"]);
const configDir = dirs.make();
const emptyGlobalConfig = path.join(configDir, "gitconfig");
const emptyAttributes = path.join(configDir, "attributes");
writeFileSync(emptyAttributes, "");
writeFileSync(
  emptyGlobalConfig,
  `[core]\n\tattributesFile = ${emptyAttributes.replaceAll("\\", "/")}\n`,
);
env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
env.GIT_CONFIG_NOSYSTEM = "1";
const author = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
}

/** A fresh repo with these files staged. */
function repoWith(files: Record<string, string | Buffer>) {
  const dir = dirs.make();
  git(dir, ["init", "-q"]);
  const gitDir = git(dir, ["rev-parse", "--absolute-git-dir"]).trim();
  if (path.resolve(gitDir) !== path.join(dir, ".git"))
    throw new Error(`git is not using the temp repo (it uses ${gitDir})`);
  stage(dir, files);
  return dir;
}

function stage(dir: string, files: Record<string, string | Buffer>) {
  const names = Object.keys(files);
  if (names.length === 0) return;
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  // -f: a teammate's personal ignore file must not stop the test from staging .env and friends.
  git(dir, ["add", "-f", "--", ...names]);
}

/** Records the staged files as a commit with plumbing commands, so no hook runs. */
function commitStaged(dir: string) {
  const tree = git(dir, ["write-tree"]).trim();
  const commit = git(dir, ["commit-tree", tree, "-m", "base"], author).trim();
  git(dir, ["update-ref", "HEAD", commit]);
}

function runHook(cwd: string) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd,
    env,
    encoding: "utf8",
  });
  return {
    status: res.status,
    stderr: res.stderr,
    output: res.stdout + res.stderr,
  };
}

/** True if the hook listed a problem line starting with `- <prefix>` (exact, so `.env` ≠ `prisma/.env`). */
const reported = (stderr: string, prefix: string) =>
  stderr.split(/\r?\n/).some((l) => l.trimStart().startsWith(`- ${prefix}`));

// Table cases share one repo and one hook run (each git repo costs about a second on Windows);
// every case still gets its own assertion on its own file's problem line.
const SECRET_CASES: [name: string, content: string][] = [
  ["an Anthropic API key", `ANTHROPIC_API_KEY=${fake.anthropicKey}\n`],
  ["an Anthropic API key", `KEY=${fake.anthropicAdminKey}\n`],
  ["a GitHub token", `const t = "${fake.githubToken("ghp")}";\n`],
  ["a GitHub token", `const t = "${fake.githubToken("ghs")}";\n`],
  ["a GitHub token", `const t = "${fake.githubToken("gho")}";\n`],
  ["a GitHub token", `const t = "${fake.githubToken("ghu")}";\n`],
  ["a GitHub token", `const t = "${fake.githubToken("ghr")}";\n`],
  ["a GitHub token", `const t = "${fake.githubFineGrained}";\n`],
  ["an AWS access key", `aws_access_key_id = ${fake.awsKey}\n`],
  ["a private key", `${fake.privateKey("RSA")}\nMIIEow...\n`],
  ["a private key", `${fake.privateKey("")}\nMIIEvQ...\n`],
  ["a private key", `${fake.privateKey("OPENSSH")}\nb3Blbn...\n`],
  ["a Better Auth secret", `BETTER_AUTH_SECRET=${fake.authSecret}\n`],
  ["a Better Auth secret", `BETTER_AUTH_SECRET: "${fake.authSecret}"\n`],
  [
    "a database URL with a password for a remote host",
    `DATABASE_URL=${fake.dbUrl("postgresql", "prod.example.com:5432")}\n`,
  ],
  [
    "a database URL with a password for a remote host",
    `DATABASE_URL=${fake.dbUrl("postgres", "ep-quiet-sky-123.neon.tech")}\n`,
  ],
  [
    "a database URL with a password for a remote host",
    `DATABASE_URL=${fake.dbUrl("POSTGRESQL", "prod.example.com")}\n`,
  ],
];
// Regression: a host that only starts with a local name (db., localhost.) used to slip through.
const LOOKALIKE_HOSTS = [
  "db.example.com:5432",
  "db.abcdefgh.supabase.co:5432",
  "localhost.attacker.example",
  "127.0.0.1.nip.io:5432",
  "db-test.internal.example",
];
const LOCAL_HOSTS = [
  "localhost:5433",
  "127.0.0.1:5434",
  "db:5432",
  "db-test:5432",
  "localhost",
];
const FORBIDDEN_FILES = [
  ".env",
  "prisma/.env",
  ".env.local",
  ".env.development",
  "config/.env.production",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
  ".env.example.local",
  ".env.bak",
  ".env.staging",
  "config/.env.old",
  ".envrc",
  ".env-prod",
  ".env_local",
  "certs/server.pem",
  "certs/CLIENT.PEM",
  "certs/api.key",
  "certs/client.p12",
  "certs/client.pfx",
  "id_rsa",
  "home/.ssh/id_ed25519",
  "id_ecdsa",
];

describe("pre-commit hook: blocks secrets", () => {
  let run: ReturnType<typeof runHook>;
  beforeAll(() => {
    const files: Record<string, string> = {};
    SECRET_CASES.forEach(([, content], i) => {
      files[`secrets/case-${i}.ts`] = content;
    });
    LOOKALIKE_HOSTS.forEach((host, i) => {
      files[`hosts/host-${i}.ts`] =
        `const u = "${fake.dbUrl("postgresql", host)}";\n`;
    });
    run = runHook(repoWith(files));
  });

  it("fails the commit", () => {
    expect(run.status).toBe(1);
  });

  it.each(SECRET_CASES.map(([name], i) => [name, i] as const))(
    "blocks %s (case %i)",
    (name, i) => {
      expect(
        reported(run.stderr, `secrets/case-${i}.ts:1: looks like ${name}`),
      ).toBe(true);
    },
  );

  it.each(LOOKALIKE_HOSTS.map((host, i) => [host, i] as const))(
    "blocks a remote database host that looks local: %s",
    (_host, i) => {
      expect(
        reported(
          run.stderr,
          `hosts/host-${i}.ts:1: looks like a database URL with a password`,
        ),
      ).toBe(true);
    },
  );

  it("checks every line, not just the first", () => {
    const content = `// ok\n// still ok\nconst key = "${fake.anthropicKey}";\n`;
    const { status, stderr } = runHook(repoWith({ "notes.md": content }));
    expect(status).toBe(1);
    expect(
      reported(stderr, "notes.md:3: looks like an Anthropic API key"),
    ).toBe(true);
  });

  it("scans the env templates' content (a real key pasted into a template)", () => {
    const { status, stderr } = runHook(
      repoWith({
        ".env.example": `ANTHROPIC_API_KEY=${fake.anthropicKey}\n`,
        ".env.test": `DATABASE_URL=${fake.dbUrl("postgresql", "prod.example.com")}\n`,
      }),
    );
    expect(status).toBe(1);
    expect(
      reported(stderr, ".env.example:1: looks like an Anthropic API key"),
    ).toBe(true);
    expect(
      reported(
        stderr,
        ".env.test:1: looks like a database URL with a password",
      ),
    ).toBe(true);
  });

  it("scans a key added to a file that is already committed", () => {
    const dir = repoWith({ "src/config.ts": "export const a = 1;\n" });
    commitStaged(dir);
    stage(dir, {
      "src/config.ts": `export const a = 1;\nexport const k = "${fake.anthropicKey}";\n`,
    });
    expect(git(dir, ["diff", "--cached", "--name-status"])).toMatch(
      /^M\s+src\/config\.ts/,
    );
    const { status, stderr } = runHook(dir);
    expect(status).toBe(1);
    expect(
      reported(stderr, "src/config.ts:2: looks like an Anthropic API key"),
    ).toBe(true);
  });

  it("scans a renamed file", () => {
    const body = Array.from(
      { length: 10 },
      (_, i) => `export const v${i} = ${i};\n`,
    ).join("");
    const dir = repoWith({ "src/old.ts": body });
    commitStaged(dir);
    git(dir, ["mv", "src/old.ts", "src/new.ts"]);
    stage(dir, {
      "src/new.ts": `${body}export const k = "${fake.anthropicKey}";\n`,
    });
    expect(git(dir, ["diff", "--cached", "--name-status"])).toMatch(
      /^R\d*\s+src\/old\.ts\s+src\/new\.ts/m,
    );
    const { status, stderr } = runHook(dir);
    expect(status).toBe(1);
    expect(
      reported(stderr, "src/new.ts:11: looks like an Anthropic API key"),
    ).toBe(true);
  });

  // What gets committed is the staged copy, so that's what is scanned, not the file on disk.
  it("scans the staged copy even after the key is deleted from the file on disk", () => {
    const dir = repoWith({
      "src/k.ts": `export const k = "${fake.anthropicKey}";\n`,
    });
    writeFileSync(path.join(dir, "src/k.ts"), "export const k = '';\n");
    const { status, stderr } = runHook(dir);
    expect(status).toBe(1);
    expect(
      reported(stderr, "src/k.ts:1: looks like an Anthropic API key"),
    ).toBe(true);
  });

  it("ignores a key that is only on disk and not staged", () => {
    const dir = repoWith({ "src/k.ts": "export const k = '';\n" });
    writeFileSync(
      path.join(dir, "src/k.ts"),
      `export const k = "${fake.anthropicKey}";\n`,
    );
    expect(runHook(dir).status).toBe(0);
  });

  // Windows PowerShell 5.1 writes `echo ... > file` as UTF-16 with a byte-order mark.
  it("scans UTF-16 text files (both byte orders)", () => {
    const le = Buffer.from(
      `ANTHROPIC_API_KEY=${fake.anthropicKey}\r\n`,
      "utf16le",
    );
    const { status, stderr } = runHook(
      repoWith({
        "utf16le.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
        "utf16be.txt": Buffer.concat([
          Buffer.from([0xfe, 0xff]),
          Buffer.from(le).swap16(),
        ]),
      }),
    );
    expect(status).toBe(1);
    expect(
      reported(stderr, "utf16le.txt:1: looks like an Anthropic API key"),
    ).toBe(true);
    expect(
      reported(stderr, "utf16be.txt:1: looks like an Anthropic API key"),
    ).toBe(true);
  });
});

describe("pre-commit hook: blocks forbidden files", () => {
  let run: ReturnType<typeof runHook>;
  beforeAll(() => {
    run = runHook(
      repoWith(
        Object.fromEntries(
          FORBIDDEN_FILES.map((f) => [
            f,
            // Real key and certificate files are binary (DER); the name alone must block them.
            /\.(pem|key|p12|pfx)$|id_/i.test(f)
              ? Buffer.from([0x30, 0x82, 0x00, 0x01, 0x00, 0x02])
              : "X=1\n",
          ]),
        ),
      ),
    );
  });

  it("fails the commit", () => {
    expect(run.status).toBe(1);
  });

  it.each(FORBIDDEN_FILES)("blocks %s", (file) => {
    expect(
      reported(run.stderr, `${file}: this file must never be committed`),
    ).toBe(true);
  });

  it("blocks files over 5 MB", () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, "a");
    const { status, stderr } = runHook(repoWith({ "big.txt": big }));
    expect(status).toBe(1);
    expect(reported(stderr, "big.txt: 5.0 MB is too large")).toBe(true);
  });

  it("checks the staged size, even if the file on disk was emptied", () => {
    const dir = repoWith({ "big.txt": Buffer.alloc(5 * 1024 * 1024 + 1, "a") });
    writeFileSync(path.join(dir, "big.txt"), "");
    const { status, stderr } = runHook(dir);
    expect(status).toBe(1);
    expect(reported(stderr, "big.txt: 5.0 MB is too large")).toBe(true);
  });

  it("allows a file of exactly 5 MB", () => {
    const max = Buffer.alloc(5 * 1024 * 1024, "a");
    expect(runHook(repoWith({ "max.txt": max })).status).toBe(0);
  });
});

describe("pre-commit hook: allows safe content", () => {
  it("allows ordinary files, the real env templates and local database URLs", () => {
    const files: Record<string, string> = {
      "src/a.ts": "export const a = 1;\n",
      "README.md": "# Hi\n",
      // The committed templates exactly as they are (dummy secrets, local database URLs).
      ".env.example": readFileSync(path.join(root, ".env.example"), "utf8"),
      ".env.test": readFileSync(path.join(root, ".env.test"), "utf8"),
      "prisma/.env.example": "DATABASE_URL=\n",
    };
    LOCAL_HOSTS.forEach((host, i) => {
      const url = [
        "postgresql:",
        "",
        `teachback:teachback@${host}/teachback`,
      ].join("/");
      files[`local/host-${i}.ts`] = `const u = "${url}";\n`;
    });
    const { status, stderr } = runHook(repoWith(files));
    expect(stderr).toBe("");
    expect(status).toBe(0);
  });

  it("allows a commit with nothing staged (amending only the message)", () => {
    expect(runHook(repoWith({})).status).toBe(0);
  });

  it("allows a line marked gitleaks:allow (documented false-positive escape)", () => {
    const content = `const sample = "${fake.anthropicKey}"; // gitleaks:allow\n`;
    const { status } = runHook(repoWith({ "src/sample.ts": content }));
    expect(status).toBe(0);
  });

  it("gitleaks:allow only covers its own line", () => {
    const content = `const a = "${fake.anthropicKey}"; // gitleaks:allow\nconst b = "${fake.anthropicKey}";\n`;
    const { status, stderr } = runHook(repoWith({ "src/two.ts": content }));
    expect(status).toBe(1);
    expect(
      reported(stderr, "src/two.ts:2: looks like an Anthropic API key"),
    ).toBe(true);
    expect(reported(stderr, "src/two.ts:1:")).toBe(false);
  });
});

describe("pre-commit hook: Prettier and ESLint on staged files", () => {
  // The hook runs the project's own Prettier and ESLint, so the temp repo gets the real
  // node_modules (a link, removed safely by removeAll) and the real config files.
  function repoWithTooling(files: Record<string, string>) {
    const dir = repoWith({});
    linkNodeModules(dir);
    for (const f of ["eslint.config.mjs", ".prettierrc.json", "tsconfig.json"])
      copyFileSync(path.join(root, f), path.join(dir, f));
    stage(dir, files);
    return dir;
  }
  // Prettier and ESLint may colour their output even when it isn't a terminal.
  const plainLines = (output: string) =>
    output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  /** Prettier --check prints `[warn] <file>` for each unformatted file. */
  const prettierFlagged = (output: string, file: string) =>
    plainLines(output).some((l) => l.trim() === `[warn] ${file}`);
  /**
   * ESLint's default output: the file's absolute path on its own line, then its problems (some
   * span several lines), until the next file's path or the `✖ N problems` summary.
   */
  const eslintFlagged = (output: string, file: string, rule: string) => {
    const lines = plainLines(output);
    // A bare absolute path; a message's own `path:line:col` location line doesn't count.
    const isHeader = (l: string) =>
      /^([A-Za-z]:\\|\/)\S/.test(l) && !/:\d+:\d+$/.test(l.trim());
    const start = lines.findIndex(
      (l) => isHeader(l) && l.trim().endsWith(file),
    );
    if (start < 0) return false;
    const end = lines.findIndex(
      (l, i) => i > start && (isHeader(l) || l.startsWith("✖")),
    );
    return lines
      .slice(start + 1, end < 0 ? undefined : end)
      .some((l) => l.includes(rule));
  };

  it("blocks unformatted files and lint errors, in every language it checks", () => {
    const { status, stderr, output } = runHook(
      repoWithTooling({
        "ugly.mjs": "export const   x=1\n",
        "ugly.ts": "export const   y=2\n",
        "ugly.json": '{"a":1}\n',
        "ugly.md": "*  item\n",
        "ugly.css": "a{color:red}\n",
        "ugly.yml": "a:   1\n",
        "ugly.yaml": "b:   2\n",
        "unsafe.mjs": 'export const a = eval("1");\n',
        "unsafe.cjs": 'module.exports = eval("1");\n',
        "unsafe.ts": 'export const b = eval("1");\n',
        "unsafe.tsx": 'export const C = () => <p>{eval("1")}</p>;\n',
        "unsafe.jsx": 'export const D = () => <p>{eval("1")}</p>;\n',
      }),
    );
    expect(status).toBe(1);
    expect(reported(stderr, "Formatting: run `npm run format`")).toBe(true);
    expect(reported(stderr, "ESLint errors above")).toBe(true);
    for (const file of [
      "ugly.mjs",
      "ugly.ts",
      "ugly.json",
      "ugly.md",
      "ugly.css",
      "ugly.yml",
      "ugly.yaml",
    ])
      expect(prettierFlagged(output, file), file).toBe(true);
    for (const file of [
      "unsafe.mjs",
      "unsafe.cjs",
      "unsafe.ts",
      "unsafe.tsx",
      "unsafe.jsx",
    ])
      expect(eslintFlagged(output, file, "no-eval"), file).toBe(true);
  });

  it("blocks lint warnings too", () => {
    const { status, stderr, output } = runHook(
      repoWithTooling({ "warn.ts": "const unused = 1;\nexport {};\n" }),
    );
    // Only a warning: this is what --max-warnings=0 turns into a failure.
    expect(plainLines(output).join("\n")).toContain("(0 errors, 1 warning)");
    expect(status).toBe(1);
    expect(reported(stderr, "ESLint errors above")).toBe(true);
  });

  it("allows formatted, lint-clean files", () => {
    const { status } = runHook(
      repoWithTooling({
        "clean.mjs": "export const x = 1;\n",
        "clean.ts": "export const y = 2;\n",
        // ESLint ignores generated code; staging it must not count as a lint warning.
        "src/generated/prisma/client.ts": "export const z = 3;\n",
      }),
    );
    expect(status).toBe(0);
  });
});

describe("pre-commit hook: wiring", () => {
  // `npm install` runs `prepare` → install-hooks.mjs → core.hooksPath=.githooks → the shim runs the script.
  function repoWithHooksInstalled(
    files: Record<string, string>,
    { crlfShims = false } = {},
  ) {
    const dir = repoWith(files);
    cpSync(path.join(root, ".githooks"), path.join(dir, ".githooks"), {
      recursive: true,
    });
    for (const name of readdirSync(path.join(dir, ".githooks"))) {
      const shim = path.join(dir, ".githooks", name);
      // A fresh clone on macOS/Linux can have non-executable hooks; install-hooks must fix that.
      chmodSync(shim, 0o644);
      if (crlfShims)
        writeFileSync(shim, readFileSync(shim, "utf8").replace(/\n/g, "\r\n"));
    }
    cpSync(path.join(root, "scripts"), path.join(dir, "scripts"), {
      recursive: true,
      filter: (src) => !src.endsWith(".json"),
    });
    execFileSync(process.execPath, ["scripts/install-hooks.mjs"], {
      cwd: dir,
      env,
    });
    return dir;
  }
  const gitHook = (cwd: string) =>
    spawnSync("git", ["hook", "run", "pre-commit"], {
      cwd,
      env,
      encoding: "utf8",
    });
  // A real `git commit` in the throwaway repo: git runs the hook with its own temporary index
  // (GIT_INDEX_FILE), which the hook must read for `commit -a` and `commit <path>`.
  const gitCommit = (cwd: string, args: string[]) =>
    spawnSync("git", ["-c", "commit.gpgsign=false", "commit", ...args], {
      cwd,
      env: { ...env, ...author },
      encoding: "utf8",
    });

  it("npm install runs install-hooks.mjs (the prepare script)", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepare).toBe("node scripts/install-hooks.mjs");
  });

  it("install-hooks.mjs points git at .githooks", () => {
    const dir = repoWithHooksInstalled({ "a.txt": "a\n" });
    expect(git(dir, ["config", "core.hooksPath"]).trim()).toBe(".githooks");
  });

  it("install-hooks.mjs repairs hooks saved with Windows line endings", () => {
    const dir = repoWithHooksInstalled({ "a.txt": "a\n" }, { crlfShims: true });
    const shim = readFileSync(path.join(dir, ".githooks/pre-commit"), "utf8");
    expect(shim).not.toContain("\r\n");
    expect(gitHook(dir).status).toBe(0);
  });

  it("git's pre-commit hook blocks a staged fake Anthropic key", () => {
    const dir = repoWithHooksInstalled({
      "src/ai.ts": `export const key = "${fake.anthropicKey}";\n`,
    });
    const res = gitHook(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Commit blocked by pre-commit checks");
  });

  it("git's pre-commit hook lets a clean commit through", () => {
    const dir = repoWithHooksInstalled({ "src/ok.ts": "export {};\n" });
    expect(gitHook(dir).status).toBe(0);
  });

  it.each([
    ["git commit -a", ["-a", "-m", "test: x"]],
    ["git commit <path>", ["-m", "test: x", "--", "src/config.ts"]],
  ])("`%s` with a key in a tracked file is blocked", (_name, args) => {
    const dir = repoWithHooksInstalled({
      "src/config.ts": "export const a = 1;\n",
    });
    commitStaged(dir);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    writeFileSync(
      path.join(dir, "src/config.ts"),
      `export const k = "${fake.anthropicKey}";\n`,
    );
    const res = gitCommit(dir, args);
    expect(res.stderr).toContain("Commit blocked by pre-commit checks");
    expect(res.status).not.toBe(0);
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });
});
