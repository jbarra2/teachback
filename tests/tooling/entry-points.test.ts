import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { repoRoot as root } from "../helpers/temp-dirs";

// Every HTTP entry point goes through withApi() (PLAN §4), and every one lives under src/app/api/,
// where the security matrix (TESTING §3) covers it. Anything else Next.js would serve as code
// skips withApi() unseen: a route.ts elsewhere, a "use server" function (a public POST endpoint),
// a metadata route handler (opengraph-image.tsx, sitemap.ts, ...), or a Pages Router src/pages/.
const code = /\.[cm]?[jt]sx?$/;
// Next's own list (next/dist/lib/metadata/is-metadata-route.js), including numbered variants
// such as icon1.tsx. Under src/app/ these are served as handlers, api/ included.
const METADATA_ROUTE =
  /\/((opengraph-image|twitter-image|icon|apple-icon)\d?|sitemap|robots|manifest)(\.[^/]+)?\.[cm]?[jt]sx?$/;

/** Why `file` (repo-relative, `/`-separated) is an entry point outside the rules, or null. */
function strayEntryPoint(file: string): string | null {
  if (file.startsWith("src/pages/")) return "Pages Router file";
  // Next 16 runs src/proxy.ts (PLAN §4) on matching requests; a middleware.ts would too.
  if (/^(src\/)?(middleware|proxy)\.[cm]?[jt]sx?$/.test(file))
    return file === "src/proxy.ts" ? null : "middleware";
  if (file.startsWith("src/app/") && METADATA_ROUTE.test(file))
    return "metadata route handler";
  if (file.startsWith("src/app/api/")) return null;
  if (/\/route\.[cm]?[jt]sx?$/.test(file)) return "route handler";
  return null;
}

/**
 * True if the source mentions the "use server" directive anywhere, comments included. Next also
 * reads it after a comment on the same line, so any mention counts; a false alarm costs little.
 */
const mentionsServerAction = (source: string) =>
  /["'`]use(?:\s|\\x20|\\u0020|\\u\{0*20\})server["'`]/.test(source) ||
  hasUseServerString(source);

/**
 * True if any string in the code reads "use server" once decoded. Next compiles project files with
 * SWC, which reads the directive's value, so `"use server"` or a line continuation counts too.
 */
function hasUseServerString(source: string): boolean {
  const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "use server"
    )
      found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Tracked and new files, minus what .gitignore hides (node_modules, .next, coverage). -z with
// quotePath off keeps non-ASCII paths as they are; otherwise git quotes them and they'd vanish.
const gitFiles = (...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "core.quotePath=false", "ls-files", "-z", ...args],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
const listed = gitFiles("--cached", "--others", "--exclude-standard");
const deleted = new Set(gitFiles("--deleted"));
const files = listed.filter((f) => !deleted.has(f));

// The two test files that name the directive on purpose.
const NAMES_THE_DIRECTIVE = [
  "tests/tooling/entry-points.test.ts",
  "tests/tooling/project-config.test.ts",
];

describe("entry-point rules (the patterns themselves)", () => {
  it.each([
    ["src/app/(app)/courses/route.ts", "route handler"],
    ["src/app/(auth)/callback/route.js", "route handler"],
    ["src/app/api-v2/route.ts", "route handler"],
    ["src/app/(app)/opengraph-image.tsx", "metadata route handler"],
    ["src/app/(app)/notes/[id]/opengraph-image1.tsx", "metadata route handler"],
    ["src/app/icon1.tsx", "metadata route handler"],
    ["src/app/apple-icon2.ts", "metadata route handler"],
    ["src/app/sitemap.ts", "metadata route handler"],
    ["src/app/robots.ts", "metadata route handler"],
    ["src/app/manifest.ts", "metadata route handler"],
    ["src/app/(app)/twitter-image2.tsx", "metadata route handler"],
    ["src/app/(app)/courses/[courseId]/résumé/route.ts", "route handler"],
    ["src/app/icon.tsx", "metadata route handler"],
    ["src/app/api/opengraph-image.tsx", "metadata route handler"],
    ["src/pages/api/hello.ts", "Pages Router file"],
    ["src/app/api/courses/route.ts", null],
    ["src/app/api/auth/[...all]/route.ts", null],
    ["src/app/(app)/page.tsx", null],
    ["src/components/router.ts", null],
    ["src/components/ui/icon.tsx", null],
    ["src/app/icon.png", null],
    ["src/middleware.ts", "middleware"],
    ["middleware.ts", "middleware"],
    ["proxy.ts", "middleware"],
    ["src/proxy.ts", null],
  ])("%s → %s", (file, expected) => {
    expect(strayEntryPoint(file)).toBe(expected);
  });

  it.each([
    ['"use server";\nexport async function act() {}', true],
    ["'use server'\nexport async function act() {}", true],
    ['export async function act() {\n  "use server";\n}', true],
    ['/* form helpers */ "use server";\nexport async function save() {}', true],
    ['// "use server" is banned here\nexport const x = 1;', true],
    ['"use client";\nexport function Button() {}', false],
    ["// server-side helpers\nexport const x = 1;", false],
    ['"use\\x20server";\nexport async function save() {}', true],
    ['"use\\u0020server";\nexport async function save() {}', true],
    ['"\\u0075se server";\nexport async function save() {}', true],
    ['"use \\\nserver";\nexport async function save() {}', true],
    ["const directive = `use server`;", true],
  ])("mentionsServerAction(%j) → %s", (source, expected) => {
    expect(mentionsServerAction(source)).toBe(expected);
  });
});

describe("HTTP entry points (PLAN §4)", () => {
  it("finds the source files, and every one git lists is on disk", () => {
    expect(files).toContain("src/app/layout.tsx");
    expect(files).toContain("scripts/setup.mjs");
    expect(files.filter((f) => !existsSync(path.join(root, f)))).toEqual([]);
  });

  // Next serves a root app/ instead of src/app/, and pages/ next to either, so both stay out.
  it("serves only src/app/ (no pages/ and no root app/)", () => {
    for (const dir of ["src/pages", "pages", "app"])
      expect(existsSync(path.join(root, dir)), dir).toBe(false);
  });

  it("has no entry point outside src/app/api/", () => {
    expect(
      files.filter((f) => code.test(f) && strayEntryPoint(f) !== null),
    ).toEqual([]);
  });

  // A file git or GitHub shows as binary can't be reviewed, and the secret scans skip it. That
  // happens with a NUL byte, or with `binary`/`-diff` in a .gitattributes in any folder.
  it("keeps every text file free of NUL bytes", () => {
    const text = /\.([cm]?[jt]sx?|json|md|ya?ml|css)$/;
    expect(
      files.filter(
        (f) => text.test(f) && readFileSync(path.join(root, f)).includes(0),
      ),
    ).toEqual([]);
  });

  it("has git see only images as binary", () => {
    // `git ls-files --eol`: "i/<index eol> w/<worktree eol> attr/<attrs>\t<path>".
    const binary = gitFiles("--eol", "--cached")
      .map((line) => ({ info: line.split("\t")[0], file: line.split("\t")[1] }))
      .filter(({ info }) =>
        /\bi\/-text\b|\bw\/-text\b|attr\/\S*-diff|attr\/\S*binary/.test(info),
      )
      .map(({ file }) => file);
    expect(binary.length).toBeGreaterThan(0);
    expect(
      binary.filter((f) => !/\.(png|jpe?g|gif|webp|ico|pdf)$/.test(f)),
    ).toEqual([]);
  });

  it("has one .gitattributes, the reviewed root one", () => {
    expect(
      files.filter((f) => f.split("/").pop() === ".gitattributes"),
    ).toEqual([".gitattributes"]);
    expect(readFileSync(path.join(root, ".gitattributes"), "utf8")).toBe(
      [
        "# Normalize line endings (Windows + macOS team). Hooks and shell scripts must be LF.",
        "* text=auto eol=lf",
        ".githooks/* text eol=lf",
        "*.sh text eol=lf",
        "*.pdf binary",
        "*.png binary",
        "*.jpg binary",
        "",
      ].join("\n"),
    );
  });

  // Anywhere in the repo: a "use server" module outside src/ still becomes an endpoint once a
  // page imports it.
  it('has no Server Actions ("use server") anywhere', () => {
    expect(
      files.filter(
        (f) =>
          code.test(f) &&
          !NAMES_THE_DIRECTIVE.includes(f) &&
          mentionsServerAction(readFileSync(path.join(root, f), "utf8")),
      ),
    ).toEqual([]);
  });
});
