// Temp folders for tooling tests that need real git repos or a real project on disk.
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

/** Deletes a temp folder. A node_modules link inside is unlinked first; a real node_modules is never deleted. */
export function removeTempDir(dir: string) {
  const link = path.join(dir, "node_modules");
  let isLink = false;
  try {
    isLink = lstatSync(link).isSymbolicLink();
    if (!isLink) throw new Error(`${link} is a real directory, not deleting`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (isLink) unlinkSync(link); // throws on a real directory, so the delete below never follows it
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Temp folders named `<prefix>…`, deleted together by `removeAll()`. Creating the set also clears
 * folders that interrupted runs left behind (Ctrl+C skips afterAll), but only ones over an hour
 * old, so a run in progress elsewhere is untouched.
 */
export function tempDirs(prefix: string) {
  for (const name of readdirSync(os.tmpdir())) {
    if (!name.startsWith(prefix)) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      const stat = lstatSync(dir); // lstat: never follow a link someone planted in the temp folder
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > 60 * 60 * 1000)
        removeTempDir(dir);
    } catch {
      // Already gone, or left alone on purpose.
    }
  }
  const made: string[] = [];
  return {
    make() {
      const dir = realpathSync.native(
        mkdtempSync(path.join(os.tmpdir(), prefix)),
      );
      made.push(dir);
      return dir;
    },
    removeAll() {
      for (const dir of made) removeTempDir(dir);
    },
  };
}

/** Links the repo's node_modules into `dir`, so tools run there use the project's own packages. */
export function linkNodeModules(dir: string) {
  symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(dir, "node_modules"),
    "junction", // ignored outside Windows, where it's a normal directory symlink
  );
}

/**
 * process.env without variables that would point a child process at another run or repo.
 * Prefixes match case-insensitively: Windows treats `git_dir` and `GIT_DIR` as the same variable.
 */
export function cleanEnv(prefixes: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const upper = prefixes.map((p) => p.toUpperCase());
  for (const key of Object.keys(env))
    if (upper.some((p) => key.toUpperCase().startsWith(p))) delete env[key];
  return env;
}
