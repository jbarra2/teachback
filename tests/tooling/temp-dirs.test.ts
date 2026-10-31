import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { removeTempDir, tempDirs } from "../helpers/temp-dirs";

// The tooling tests link the real node_modules into temp repos, so deleting a temp repo must
// never follow that link. These use a decoy folder, never the real node_modules.
const dirs = tempDirs("teachback-tempdirs-");
afterAll(() => dirs.removeAll());

describe("removeTempDir", () => {
  it("deletes the temp folder but not what its node_modules link points to", () => {
    const decoy = dirs.make();
    writeFileSync(path.join(decoy, "keep.txt"), "still here");
    const box = dirs.make();
    symlinkSync(decoy, path.join(box, "node_modules"), "junction");
    writeFileSync(path.join(box, "repo-file.txt"), "x");

    removeTempDir(box);

    expect(existsSync(box)).toBe(false);
    expect(existsSync(path.join(decoy, "keep.txt"))).toBe(true);
  });

  it("refuses to delete a folder whose node_modules is a real directory", () => {
    const box = dirs.make();
    mkdirSync(path.join(box, "node_modules"));
    writeFileSync(path.join(box, "node_modules", "pkg.txt"), "x");

    expect(() => removeTempDir(box)).toThrow(/real directory/);
    expect(existsSync(path.join(box, "node_modules", "pkg.txt"))).toBe(true);

    rmSync(box, { recursive: true, force: true }); // removeAll would refuse it too
  });
});
