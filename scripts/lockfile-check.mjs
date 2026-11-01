#!/usr/bin/env node
/**
 * Supply chain guard (TESTING §5). Node built-ins only, so it can run before `npm ci` and can't be
 * swapped out by the lockfile it checks (CI's `deps` job). tests/tooling/lockfile.test.ts tests it.
 *
 *   node scripts/lockfile-check.mjs              npm config, package.json and every lockfile entry
 *   node scripts/lockfile-check.mjs --installed  what `npm ci --ignore-scripts` actually installed
 *
 * Merges need no approval and version bumps skip the lead's review, so this makes the dangerous
 * kinds of dependency change fail CI instead:
 * - npm config that redirects installs (.npmrc, npm-shrinkwrap.json), root install scripts or a root
 *   binding.gyp, or package.json keys that tools read as config;
 * - a package from outside the npm registry, or a version spec that isn't a registry range;
 * - a lockfile entry that installs another package or version than its key and `version` say
 *   (npm fetches `resolved` as written and checks only the lockfile's own `integrity`);
 * - a lockfile entry nothing depends on, or two packages claiming the same command in
 *   node_modules/.bin (npm installs both and links whichever sorts first);
 * - a package outside the allowlist that runs install scripts (or has a binding.gyp, which npm builds).
 * With --installed it also compares what npm recorded as fetched (node_modules/.package-lock.json)
 * and each installed package.json with the lockfile.
 * Widening a list here is a change to scripts/, which needs the lead's review.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** Packages allowed to run preinstall/install/postinstall scripts (or node-gyp) on `npm ci`. */
export const INSTALL_SCRIPTS_ALLOWED = ["esbuild", "fsevents", "unrs-resolver"];

/** Files that change where or how npm installs. None may exist in the repo. */
export const NPM_CONFIG_FILES = [
  ".npmrc",
  "npm-shrinkwrap.json",
  ".yarnrc",
  ".yarnrc.yml",
];

/**
 * The only top-level package.json keys. Tools read others as config (Next reads postcss/babel,
 * Prettier a `prettier` key that beats .prettierrc.json, npm `gypfile`, `overrides`, ...).
 */
export const PACKAGE_JSON_KEYS = [
  "name",
  "version",
  "private",
  "engines",
  "devEngines",
  "scripts",
  "dependencies",
  "devDependencies",
];

/** Root scripts npm runs on install (`npm ci`, `npm install`) or around packing and publishing. */
export const isLifecycleScript = (name) =>
  /^(pre|post)?(install|prepare|publish|pack)$|^prepublishOnly$|^dependencies$/.test(
    name,
  );

/**
 * `16.4.3`, `^4`, `~1.2`: no git, github:, file:, link:, npm: aliases, URLs, ranges or dist-tags,
 * and nothing ending like a tarball (npm reads `1.0.0-x.tgz` as a local file, in any case).
 */
export const isRegistrySpec = (spec) =>
  /^[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(spec) &&
  !/\.(tgz|tar|tar\.gz)$/i.test(spec);

/** A plain semver version: nothing that could change the tarball URL built from it. */
const isVersion = (v) =>
  /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v);

/** The package a lockfile key installs: `node_modules/a/node_modules/@s/b` → `@s/b`. */
export const packageName = (key) =>
  key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);

/** The one registry tarball npm should fetch for name@version. */
export const tarballUrl = (name, version) =>
  `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

/** Why a lockfile entry may install something other than what it names, or null. */
export function entryProblem(key, entry) {
  const name = packageName(key);
  if (entry.link) return "is a link";
  if (entry.name !== undefined && entry.name !== name)
    return `is an alias for ${entry.name}`;
  if (!entry.version) return "has no version";
  if (!isVersion(entry.version)) return `has an odd version ${entry.version}`;
  if (entry.resolved !== tarballUrl(name, entry.version))
    return `resolves to ${entry.resolved}`;
  if (new URL(entry.resolved).href !== entry.resolved)
    return `resolves to ${entry.resolved}, which isn't a plain URL`;
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? ""))
    return "has no sha512 integrity";
  return null;
}

/** A package's commands as npm links them: `{ name: path }`, paths without a leading `./`. */
export function binMap(bin, name) {
  if (!bin) return {};
  const map = typeof bin === "string" ? { [name.split("/").pop()]: bin } : bin;
  return Object.fromEntries(
    Object.entries(map)
      .map(([cmd, file]) => [
        cmd,
        String(file).replace(/\\/g, "/").replace(/^\.\//, ""),
      ])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/** The location `name` resolves to from lockfile key `from`, walking up node_modules like Node. */
function resolveFrom(packages, from, name) {
  for (let at = from; ;) {
    const candidate = at
      ? `${at}/node_modules/${name}`
      : `node_modules/${name}`;
    if (candidate in packages) return candidate;
    if (at === "") return null;
    const up = at.lastIndexOf("/node_modules/");
    at = up < 0 ? "" : at.slice(0, up);
  }
}

/** Lockfile keys that nothing in package.json reaches through the entries' dependencies. */
export function unreachableEntries(pkg, packages) {
  const seen = new Set();
  const queue = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].map((name) => resolveFrom(packages, "", name));
  while (queue.length) {
    const key = queue.pop();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key];
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ])
      for (const name of Object.keys(entry[field] ?? {}))
        queue.push(resolveFrom(packages, key, name));
  }
  return Object.keys(packages).filter((key) => key !== "" && !seen.has(key));
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const installedEntries = (lock) =>
  Object.entries(lock.packages ?? {}).filter(([key]) => key !== "");

/** Problems with npm config, package.json and the lockfile. Reads files only; runs nothing. */
export function manifestProblems(root) {
  const problems = [];
  for (const file of [...NPM_CONFIG_FILES, "binding.gyp"])
    if (existsSync(path.join(root, file))) problems.push(`${file} exists`);

  const pkg = readJson(path.join(root, "package.json"));
  for (const key of Object.keys(pkg))
    if (!PACKAGE_JSON_KEYS.includes(key))
      problems.push(`package.json has ${key}`);
  let count = 0;
  for (const field of ["dependencies", "devDependencies"])
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      count++;
      if (!isRegistrySpec(spec))
        problems.push(
          `package.json ${field}.${name}: "${spec}" isn't a registry range`,
        );
    }
  if (count === 0) problems.push("package.json lists no dependencies");
  // T02 adds `postinstall: prisma generate` (PLAN §10); allow it here when it lands.
  const lifecycle = Object.keys(pkg.scripts ?? {}).filter(isLifecycleScript);
  if (
    lifecycle.join() !== "prepare" ||
    pkg.scripts.prepare !== "node scripts/install-hooks.mjs"
  )
    problems.push(
      `package.json install scripts: ${JSON.stringify(lifecycle.map((s) => `${s}=${pkg.scripts[s]}`))}`,
    );

  const lock = readJson(path.join(root, "package-lock.json"));
  const entries = installedEntries(lock);
  if (entries.length === 0)
    problems.push("package-lock.json lists no packages");
  for (const [key, entry] of entries) {
    const problem = entryProblem(key, entry);
    if (problem) problems.push(`${key} ${problem}`);
    if (
      entry.hasInstallScript &&
      !INSTALL_SCRIPTS_ALLOWED.includes(packageName(key))
    )
      problems.push(`${key} runs install scripts`);
  }
  for (const key of unreachableEntries(pkg, lock.packages ?? {}))
    problems.push(`${key}: nothing in package.json depends on it`);

  // Top-level packages are the ones linked into node_modules/.bin.
  const claims = {};
  for (const [key, entry] of entries)
    if (key.lastIndexOf("node_modules/") === 0)
      for (const cmd of Object.keys(binMap(entry.bin, packageName(key))))
        (claims[cmd] ??= []).push(key);
  for (const [cmd, keys] of Object.entries(claims))
    if (keys.length > 1)
      problems.push(`.bin/${cmd} is claimed by ${keys.join(" and ")}`);
  return problems;
}

/**
 * Problems with the installed tree. npm's own record of what it fetched
 * (node_modules/.package-lock.json) must match the lockfile entry for entry; each installed
 * package.json must have the entry's name, version and commands; and only allowlisted packages
 * may run install scripts, which npm decides from the installed package.json (and binding.gyp).
 * Packages for other platforms aren't installed; at least half the entries must be.
 */
export function installedProblems(root) {
  const problems = [];
  const lock = readJson(path.join(root, "package-lock.json"));
  const entries = installedEntries(lock);

  const hiddenPath = path.join(root, "node_modules", ".package-lock.json");
  if (!existsSync(hiddenPath))
    problems.push("node_modules/.package-lock.json is missing: run `npm ci`");
  else
    for (const [key, fetched] of Object.entries(
      readJson(hiddenPath).packages ?? {},
    )) {
      const expected = lock.packages[key];
      if (!expected)
        problems.push(`${key}: installed, but not in package-lock.json`);
      else
        for (const field of ["version", "resolved", "integrity"])
          if (fetched[field] !== expected[field])
            problems.push(
              `${key}: npm fetched ${field} ${fetched[field]}, the lockfile says ${expected[field]}`,
            );
    }

  let checked = 0;
  for (const [key, entry] of entries) {
    const manifestPath = path.join(root, key, "package.json");
    if (!existsSync(manifestPath)) continue;
    checked++;
    const manifest = readJson(manifestPath);
    const name = packageName(key);
    if (manifest.name !== name || manifest.version !== entry.version)
      problems.push(
        `${key}: installed ${manifest.name}@${manifest.version} (run \`npm ci\` if you just pulled)`,
      );
    if (!isDeepStrictEqual(binMap(manifest.bin, name), binMap(entry.bin, name)))
      problems.push(`${key}: its commands differ from the lockfile's bin`);
    const runsScripts =
      ["preinstall", "install", "postinstall"].some(
        (s) => manifest.scripts?.[s],
      ) || existsSync(path.join(root, key, "binding.gyp"));
    if (runsScripts && !INSTALL_SCRIPTS_ALLOWED.includes(name))
      problems.push(`${key}: runs install scripts`);
  }
  if (checked <= entries.length / 2)
    problems.push(
      `only ${checked} of ${entries.length} packages are installed: run \`npm ci\``,
    );
  return problems;
}

// ---------- command line ----------
// import.meta.main is true however the script was reached (a symlink or junction included).
if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const installed = process.argv.includes("--installed");
  const problems = installed ? installedProblems(root) : manifestProblems(root);
  for (const p of problems) console.error(`  ✖ ${p}`);
  console.log(
    problems.length
      ? `\nDependency check failed (${problems.length}). See scripts/lockfile-check.mjs.`
      : installed
        ? "Installed packages match the lockfile."
        : "npm config, package.json and the lockfile are clean.",
  );
  process.exit(problems.length ? 1 : 0);
}
