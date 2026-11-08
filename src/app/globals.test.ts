// WCAG AA contrast for the theme colors in globals.css (T30), in light and dark mode.
// Text needs 4.5:1 (1.4.3); a form control's outline needs 3:1 (1.4.11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /--([\w-]+):\s*(#[0-9a-f]{6});/gi,
  ))
    found[name] = value;
  return found;
}

/** The first `:root { ... }` after `from` in the stylesheet. */
function rootBlock(from: number): string {
  const start = css.indexOf(":root {", from);
  if (start < 0) throw new Error("no :root block");
  return css.slice(start, css.indexOf("}", start));
}

const light = tokens(rootBlock(0));
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = { ...light, ...tokens(rootBlock(darkStart)) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// success/warning/danger are the three mastery states (Mastered / Review / Practice).
const TEXT = ["foreground", "muted", "primary", "success", "warning", "danger"];
const BACKGROUNDS = ["background", "surface"];

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_mode, theme) => {
  it("defines every token the checks use", () => {
    for (const name of [...TEXT, ...BACKGROUNDS, "control-border"])
      expect(theme[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme["primary-foreground"]).toBeDefined();
  });

  it.each(TEXT.flatMap((text) => BACKGROUNDS.map((bg) => [text, bg])))(
    "%s text on %s meets 4.5:1",
    (text, bg) => {
      expect(contrast(theme[text], theme[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["primary", "danger"])("button text on %s meets 4.5:1", (fill) => {
    expect(
      contrast(theme["primary-foreground"], theme[fill]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BACKGROUNDS)("form control outlines on %s meet 3:1", (bg) => {
    expect(contrast(theme["control-border"], theme[bg])).toBeGreaterThanOrEqual(
      3,
    );
  });
});
