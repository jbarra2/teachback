import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  entryProblem,
  INSTALL_SCRIPTS_ALLOWED,
  installedProblems,
  isLifecycleScript,
  isRegistrySpec,
  manifestProblems,
  NPM_CONFIG_FILES,
  PACKAGE_JSON_KEYS,
} from "../../scripts/lockfile-check.mjs";
import { repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// scripts/lockfile-check.mjs is the supply chain guard CI's `deps` job runs with plain Node, before
// `npm ci` and again on what `npm ci --ignore-scripts` installed. These tests pin its lists, each
// check, its verdict on this repo, and its exit codes.
vi.setConfig({ testTimeout: 60_000 });

// The installed-tree fixtures hold small fake node_modules folders, which removeTempDir refuses to
// delete (it guards the repo's own). So they're removed here: leftovers from an interrupted run
// first, then this run's folders after the tests.
const PREFIX = "teachback-lockfile-";
const tmp = realpathSync.native(os.tmpdir());
const removeFakeNodeModules = (dir: string) => {
  if (!dir.startsWith(path.join(tmp, PREFIX)))
    throw new Error(`not a lockfile fixture: ${dir}`);
  rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
};
for (const name of readdirSync(tmp))
  if (name.startsWith(PREFIX)) {
    const dir = path.join(tmp, name);
    try {
      const stat = lstatSync(dir);
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > 60 * 60 * 1000)
        removeFakeNodeModules(dir);
    } catch {
      // Already gone.
    }
  }
const dirs = tempDirs(PREFIX);
const fixtures: string[] = [];
const links: string[] = [];
afterAll(() => {
  for (const link of links) unlinkSync(link);
  for (const dir of fixtures) removeFakeNodeModules(dir);
  dirs.removeAll();
});

type Entry = Record<string, unknown>;
const good = {
  version: "4.6.7",
  resolved: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz",
  integrity: "sha512-AbC+/1==",
};

describe("the lists (each change is a lead review)", () => {
  it("allows install scripts only for esbuild, fsevents and unrs-resolver", () => {
    expect(INSTALL_SCRIPTS_ALLOWED).toEqual([
      "esbuild",
      "fsevents",
      "unrs-resolver",
    ]);
  });

  it("refuses every npm and yarn config file", () => {
    expect(NPM_CONFIG_FILES).toEqual([
      ".npmrc",
      "npm-shrinkwrap.json",
      ".yarnrc",
      ".yarnrc.yml",
    ]);
  });

  it("allows only the reviewed package.json keys", () => {
    expect(PACKAGE_JSON_KEYS).toEqual([
      "name",
      "version",
      "private",
      "engines",
      "devEngines",
      "scripts",
      "dependencies",
      "devDependencies",
    ]);
  });
});

describe("the checks themselves", () => {
  it.each([
    ["preinstall", true],
    ["install", true],
    ["postinstall", true],
    ["prepare", true],
    ["preprepare", true],
    ["prepublish", true],
    ["prepublishOnly", true],
    ["prepack", true],
    ["dependencies", true],
    ["test", false],
    ["build", false],
    ["pretest", false],
  ])("isLifecycleScript(%j) → %s", (name, expected) => {
    expect(isLifecycleScript(name)).toBe(expected);
  });

  it.each([
    ["16.4.3", true],
    ["^4", true],
    ["~1.2.3-beta.1", true],
    ["github:evil/pkg", false],
    ["git+ssh://git@github.com/evil/pkg.git", false],
    ["npm:other@1.0.0", false],
    ["file:../pkg", false],
    ["https://example.com/pkg.tgz", false],
    ["1.0.0-x.tgz", false],
    ["1.0.0-x.tar", false],
    ["1.0.0-x.tar.gz", false],
    ["4.6.7-a.TGZ", false],
    ["4.6.7-a.Tgz", false],
    ["^4.6.7-a.TAR", false],
    ["4.6.7-a.TAR.GZ", false],
    ["latest", false],
    [">=1.0.0", false],
    ["*", false],
  ])("isRegistrySpec(%j) → %s", (spec, ok) => {
    expect(isRegistrySpec(spec)).toBe(ok);
  });

  it.each<[string, string, Entry, string | null]>([
    ["a plain entry", "node_modules/zod", good, null],
    [
      "a scoped, nested entry",
      "node_modules/a/node_modules/@s/b",
      {
        ...good,
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/@s/b/-/b-1.0.0.tgz",
      },
      null,
    ],
    [
      "another package's tarball",
      "node_modules/zod",
      {
        ...good,
        resolved: "https://registry.npmjs.org/esb-tools/-/esb-tools-4.6.7.tgz",
      },
      "resolves to",
    ],
    [
      "another version's tarball",
      "node_modules/zod",
      { ...good, resolved: "https://registry.npmjs.org/zod/-/zod-9.9.9.tgz" },
      "resolves to",
    ],
    [
      "dot segments in the version",
      "node_modules/a/node_modules/zod",
      {
        ...good,
        version: "1.0.0/../../../evil/-/evil-1.0.0",
        resolved:
          "https://registry.npmjs.org/zod/-/zod-1.0.0/../../../evil/-/evil-1.0.0.tgz",
      },
      "has an odd version",
    ],
    [
      "a version tag",
      "node_modules/zod",
      { ...good, version: "latest" },
      "has an odd version",
    ],
    [
      "a git host",
      "node_modules/zod",
      { ...good, resolved: "git+ssh://git@github.com/evil/zod.git" },
      "resolves to",
    ],
    [
      "an alias",
      "node_modules/zod",
      { ...good, name: "not-zod" },
      "is an alias",
    ],
    ["a link", "node_modules/zod", { link: true }, "is a link"],
    [
      "no version",
      "node_modules/zod",
      { ...good, version: undefined },
      "has no version",
    ],
    [
      "a sha1 integrity",
      "node_modules/zod",
      { ...good, integrity: "sha1-AAAA" },
      "has no sha512 integrity",
    ],
    [
      "no integrity",
      "node_modules/zod",
      { ...good, integrity: undefined },
      "has no sha512 integrity",
    ],
  ])("entryProblem: %s", (_, key, entry, problem) => {
    const result = entryProblem(key, entry);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });
});

type Files = { pkg: Entry; lock: { packages: Record<string, Entry> } };

/** A temp copy of this repo's package.json and lockfile, changed by `change`. */
function manifestFixture(change: (files: Files, dir: string) => void) {
  const dir = dirs.make();
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as Entry;
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  ) as Files["lock"];
  change({ pkg, lock }, dir);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
  return dir;
}

/** A valid registry entry for a package that isn't in this repo. */
const helperEntry = (extra: Entry = {}) => ({
  version: "1.0.0",
  resolved: "https://registry.npmjs.org/aaa-helper/-/aaa-helper-1.0.0.tgz",
  integrity: "sha512-AbC+/1==",
  dev: true,
  ...extra,
});
const dependOn = (pkg: Entry, name: string) =>
  ((pkg.devDependencies as Entry)[name] = "^1.0.0");

describe("manifestProblems (before npm ci)", () => {
  it("finds nothing in this repo", () => {
    expect(manifestProblems(root)).toEqual([]);
  });

  it.each<[string, (files: Files, dir: string) => void, string]>([
    [
      ".npmrc",
      (_, dir) =>
        writeFileSync(
          path.join(dir, ".npmrc"),
          "registry=https://evil.invalid/\n",
        ),
      ".npmrc exists",
    ],
    [
      "npm-shrinkwrap.json",
      (_, dir) => writeFileSync(path.join(dir, "npm-shrinkwrap.json"), "{}"),
      "npm-shrinkwrap.json exists",
    ],
    [
      ".yarnrc",
      (_, dir) => writeFileSync(path.join(dir, ".yarnrc"), ""),
      ".yarnrc exists",
    ],
    [
      ".yarnrc.yml",
      (_, dir) => writeFileSync(path.join(dir, ".yarnrc.yml"), ""),
      ".yarnrc.yml exists",
    ],
    [
      "a root binding.gyp",
      (_, dir) => writeFileSync(path.join(dir, "binding.gyp"), "{}"),
      "binding.gyp exists",
    ],
    [
      "a github dependency",
      ({ pkg }) => ((pkg.dependencies as Entry).zod = "github:colinhacks/zod"),
      'dependencies.zod: "github:colinhacks/zod"',
    ],
    [
      "a tarball-looking devDependency",
      ({ pkg }) => ((pkg.devDependencies as Entry).vitest = "5.0.5-a.TGZ"),
      'devDependencies.vitest: "5.0.5-a.TGZ"',
    ],
    [
      "overrides",
      ({ pkg }) => (pkg.overrides = { zod: "4.0.0" }),
      "package.json has overrides",
    ],
    [
      "optionalDependencies",
      ({ pkg }) => (pkg.optionalDependencies = {}),
      "package.json has optionalDependencies",
    ],
    [
      "peerDependencies",
      ({ pkg }) => (pkg.peerDependencies = {}),
      "package.json has peerDependencies",
    ],
    [
      "bundleDependencies",
      ({ pkg }) => (pkg.bundleDependencies = []),
      "package.json has bundleDependencies",
    ],
    [
      "workspaces",
      ({ pkg }) => (pkg.workspaces = []),
      "package.json has workspaces",
    ],
    [
      "a prettier config key",
      ({ pkg }) => (pkg.prettier = "evil-prettier-config"),
      "package.json has prettier",
    ],
    ["gypfile", ({ pkg }) => (pkg.gypfile = true), "package.json has gypfile"],
    [
      "a preinstall script",
      ({ pkg }) => ((pkg.scripts as Entry).preinstall = "node x.mjs"),
      "install scripts",
    ],
    [
      "a changed prepare script",
      ({ pkg }) => ((pkg.scripts as Entry).prepare = "node evil.mjs"),
      "install scripts",
    ],
    [
      "a substituted tarball",
      ({ lock }) =>
        (lock.packages["node_modules/zod"].resolved =
          "https://registry.npmjs.org/esb-tools/-/esb-tools-4.6.7.tgz"),
      "node_modules/zod resolves to",
    ],
    [
      "a new install script",
      ({ lock }) => (lock.packages["node_modules/zod"].hasInstallScript = true),
      "node_modules/zod runs install scripts",
    ],
    [
      "an entry nothing depends on",
      ({ lock }) => (lock.packages["node_modules/aaa-helper"] = helperEntry()),
      "node_modules/aaa-helper: nothing in package.json depends on it",
    ],
    [
      "a package claiming another's command",
      ({ pkg, lock }) => {
        dependOn(pkg, "aaa-helper");
        lock.packages["node_modules/aaa-helper"] = helperEntry({
          bin: { eslint: "cli.js" },
        });
      },
      ".bin/eslint is claimed by node_modules/eslint and node_modules/aaa-helper",
    ],
    [
      "an empty lockfile",
      ({ lock }) => (lock.packages = { "": {} }),
      "lists no packages",
    ],
  ])("reports %s", (_, change, problem) => {
    const problems = manifestProblems(manifestFixture(change));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it("reports a package.json with no dependencies (and everything left unreachable)", () => {
    const problems = manifestProblems(
      manifestFixture(({ pkg }) => {
        pkg.dependencies = {};
        pkg.devDependencies = {};
      }),
    );
    expect(problems[0]).toBe("package.json lists no dependencies");
    expect(
      problems
        .slice(1)
        .every((p) => p.endsWith("nothing in package.json depends on it")),
    ).toBe(true);
  });

  it("accepts a new package that package.json depends on", () => {
    const dir = manifestFixture(({ pkg, lock }) => {
      dependOn(pkg, "aaa-helper");
      lock.packages["node_modules/aaa-helper"] = helperEntry({
        bin: { "aaa-helper": "cli.js" },
      });
    });
    expect(manifestProblems(dir)).toEqual([]);
  });

  it("follows nested dependencies the way Node resolves them", () => {
    const dir = manifestFixture(({ pkg, lock }) => {
      dependOn(pkg, "aaa-helper");
      lock.packages["node_modules/aaa-helper"] = helperEntry({
        dependencies: { zod: "^3" },
      });
      lock.packages["node_modules/aaa-helper/node_modules/zod"] = {
        version: "3.0.0",
        resolved: "https://registry.npmjs.org/zod/-/zod-3.0.0.tgz",
        integrity: "sha512-AbC+/1==",
      };
    });
    expect(manifestProblems(dir)).toEqual([]);
  });
});

type Installed = Record<
  string,
  {
    version?: string;
    name?: string;
    scripts?: Record<string, string>;
    gyp?: boolean;
    bin?: unknown;
    lockBin?: unknown;
  }
>;

/**
 * A small installed tree: lockfile entries, the package.json each installed package has, and the
 * node_modules/.package-lock.json npm writes (as fetched, unless `fetched` changes it).
 */
function installedFixture(
  installed: Installed,
  {
    lockOnly = [],
    fetched,
  }: {
    lockOnly?: string[];
    fetched?: (hidden: Record<string, Entry>) => void;
  } = {},
) {
  const dir = dirs.make();
  fixtures.push(dir);
  const packages: Record<string, Entry> = { "": {} };
  for (const [key, p] of Object.entries(installed)) {
    const name = key.slice(key.lastIndexOf("node_modules/") + 13);
    packages[key] = {
      version: "1.0.0",
      resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-1.0.0.tgz`,
      integrity: "sha512-AbC+/1==",
      ...(p.lockBin === undefined ? {} : { bin: p.lockBin }),
    };
    mkdirSync(path.join(dir, key), { recursive: true });
    writeFileSync(
      path.join(dir, key, "package.json"),
      JSON.stringify({
        name: p.name ?? name,
        version: p.version ?? "1.0.0",
        scripts: p.scripts,
        bin: p.bin,
      }),
    );
    if (p.gyp) writeFileSync(path.join(dir, key, "binding.gyp"), "{}");
  }
  if (Object.keys(installed).length > 0) {
    const hidden = Object.fromEntries(
      Object.entries(packages)
        .filter(([key]) => key in installed)
        .map(([key, e]) => [key, { ...e }]),
    );
    fetched?.(hidden);
    writeFileSync(
      path.join(dir, "node_modules", ".package-lock.json"),
      JSON.stringify({ packages: hidden }),
    );
  }
  for (const key of lockOnly) packages[key] = { version: "1.0.0" };
  writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ packages }),
  );
  return dir;
}

describe("installedProblems (after npm ci --ignore-scripts)", () => {
  it("finds nothing in this repo's node_modules", () => {
    expect(installedProblems(root)).toEqual([]);
  });

  it("accepts an allowlisted install script, matching commands and a package for another platform", () => {
    const dir = installedFixture(
      {
        "node_modules/a": { bin: "./cli.js", lockBin: { a: "cli.js" } },
        "node_modules/esbuild": { scripts: { postinstall: "node install.js" } },
      },
      { lockOnly: ["node_modules/@esbuild/darwin-arm64"] },
    );
    expect(installedProblems(dir)).toEqual([]);
  });

  it.each<
    [string, Installed, string, ((hidden: Record<string, Entry>) => void)?]
  >([
    [
      "another version installed",
      { "node_modules/a": { version: "6.6.6" }, "node_modules/b": {} },
      "node_modules/a: installed a@6.6.6",
    ],
    [
      "another package installed",
      { "node_modules/a": { name: "evil" }, "node_modules/b": {} },
      "node_modules/a: installed evil@1.0.0",
    ],
    [
      "a postinstall script",
      {
        "node_modules/a": { scripts: { postinstall: "node x.js" } },
        "node_modules/b": {},
      },
      "node_modules/a: runs install scripts",
    ],
    [
      "a preinstall script",
      {
        "node_modules/a": { scripts: { preinstall: "node x.js" } },
        "node_modules/b": {},
      },
      "node_modules/a: runs install scripts",
    ],
    [
      "an install script",
      {
        "node_modules/a": { scripts: { install: "node x.js" } },
        "node_modules/b": {},
      },
      "node_modules/a: runs install scripts",
    ],
    [
      "a binding.gyp",
      { "node_modules/a": { gyp: true }, "node_modules/b": {} },
      "node_modules/a: runs install scripts",
    ],
    [
      "commands that differ from the lockfile",
      {
        "node_modules/a": { bin: { vitest: "evil.js" } },
        "node_modules/b": {},
      },
      "node_modules/a: its commands differ",
    ],
    [
      "npm fetched another tarball",
      { "node_modules/a": {}, "node_modules/b": {} },
      "node_modules/a: npm fetched resolved file:4.6.7-a.TGZ",
      (hidden) => (hidden["node_modules/a"].resolved = "file:4.6.7-a.TGZ"),
    ],
    [
      "npm fetched other bytes",
      { "node_modules/a": {}, "node_modules/b": {} },
      "node_modules/a: npm fetched integrity sha512-OTHER",
      (hidden) => (hidden["node_modules/a"].integrity = "sha512-OTHER"),
    ],
    [
      "npm installed a package the lockfile doesn't list",
      { "node_modules/a": {}, "node_modules/b": {} },
      "node_modules/evil: installed, but not in package-lock.json",
      (hidden) => (hidden["node_modules/evil"] = { version: "1.0.0" }),
    ],
  ])("reports %s", (_, installed, problem, fetched) => {
    const problems = installedProblems(
      installedFixture(installed, { fetched }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it("reports a missing node_modules instead of passing", () => {
    const problems = installedProblems(
      installedFixture({}, { lockOnly: ["node_modules/a", "node_modules/b"] }),
    );
    expect(problems).toEqual([
      "node_modules/.package-lock.json is missing: run `npm ci`",
      "only 0 of 2 packages are installed: run `npm ci`",
    ]);
  });
});

describe("node scripts/lockfile-check.mjs (what CI runs)", () => {
  /** Runs a copy of the script whose repo root is `dir`, optionally through a link to it. */
  function runCheck(
    dir: string,
    args: string[] = [],
    { viaLink = false } = {},
  ) {
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    cpSync(
      path.join(root, "scripts/lockfile-check.mjs"),
      path.join(dir, "scripts/lockfile-check.mjs"),
    );
    let base = dir;
    if (viaLink) {
      base = `${dir}-link`;
      symlinkSync(dir, base, "junction"); // "junction" is ignored outside Windows
      links.push(base);
    }
    return spawnSync(
      process.execPath,
      [path.join(base, "scripts/lockfile-check.mjs"), ...args],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
  }

  it("exits 0 on a clean repo copy", () => {
    const res = runCheck(manifestFixture(() => {}));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      "npm config, package.json and the lockfile are clean.",
    );
  });

  it("exits 1 and names the problem", () => {
    const res = runCheck(
      manifestFixture((_, dir) => writeFileSync(path.join(dir, ".npmrc"), "x")),
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(".npmrc exists");
  });

  it("still checks when run through a symlink or junction", () => {
    const res = runCheck(
      manifestFixture((_, dir) => writeFileSync(path.join(dir, ".npmrc"), "x")),
      [],
      { viaLink: true },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(".npmrc exists");
  });

  it("checks the installed tree with --installed", () => {
    const bad = runCheck(
      installedFixture({ "node_modules/a": { version: "6.6.6" } }),
      ["--installed"],
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("installed a@6.6.6");
    const ok = runCheck(installedFixture({ "node_modules/a": {} }), [
      "--installed",
    ]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("Installed packages match the lockfile.");
  });
});
