import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAuthSecret } from "./auth-secret";

const GOOD_SECRET = "a-random-test-secret-that-is-long-enough-0123";
// Better Auth signs with this public value when no secret is set (outside production, without an error).
// Read from the installed package, so an upgrade that changes it fails here instead of passing.
const BETTER_AUTH_DEFAULT_SECRET = /DEFAULT_SECRET = "([^"]+)"/.exec(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../node_modules/better-auth/dist/utils/constants.mjs",
    ),
    "utf8",
  ),
)?.[1];

describe("readAuthSecret", () => {
  it("returns a secret of 32 or more characters", () => {
    expect(readAuthSecret({ BETTER_AUTH_SECRET: GOOD_SECRET })).toBe(
      GOOD_SECRET,
    );
    const exactly32 = "s".repeat(32);
    expect(readAuthSecret({ BETTER_AUTH_SECRET: exactly32 })).toBe(exactly32);
  });

  it("returns the secret without surrounding whitespace", () => {
    expect(readAuthSecret({ BETTER_AUTH_SECRET: `  ${GOOD_SECRET}\n` })).toBe(
      GOOD_SECRET,
    );
  });

  it("knows Better Auth's current default secret", () => {
    expect(BETTER_AUTH_DEFAULT_SECRET).toMatch(/^better-auth-secret-/);
  });

  // Each message gives advice that works: setup generates a secret only when the line is missing,
  // empty or the placeholder (scripts/setup.mjs), so the other two say to delete the line first.
  const NOT_SET = /^BETTER_AUTH_SECRET is not set\. Run `npm run setup`/;
  const DEFAULT =
    /^BETTER_AUTH_SECRET is Better Auth's public example value\. Delete that line from \.env and run `npm run setup`/;
  const TOO_SHORT =
    /^BETTER_AUTH_SECRET must be at least 32 characters\. Delete that line from \.env and run `npm run setup`/;
  it.each([
    ["missing", {}, NOT_SET],
    ["empty", { BETTER_AUTH_SECRET: "" }, NOT_SET],
    ["blank", { BETTER_AUTH_SECRET: " ".repeat(40) }, NOT_SET],
    [
      "the .env.example placeholder",
      { BETTER_AUTH_SECRET: "replace-me" },
      NOT_SET,
    ],
    [
      "Better Auth's public default",
      { BETTER_AUTH_SECRET: BETTER_AUTH_DEFAULT_SECRET },
      DEFAULT,
    ],
    ["31 characters", { BETTER_AUTH_SECRET: "s".repeat(31) }, TOO_SHORT],
    [
      "short once trimmed",
      { BETTER_AUTH_SECRET: `  ${"s".repeat(31)}  ` },
      TOO_SHORT,
    ],
  ])("refuses a secret that is %s", (_label, env, message) => {
    expect(() => readAuthSecret(env)).toThrow(message);
  });

  // CI and the integration tests sign sessions with it, so it has to pass.
  it("accepts the committed test secret in .env.test", () => {
    const line = /^BETTER_AUTH_SECRET=(.*)$/m.exec(
      readFileSync(
        path.resolve(import.meta.dirname, "../../.env.test"),
        "utf8",
      ),
    );
    expect(line).not.toBeNull();
    expect(() =>
      readAuthSecret({ BETTER_AUTH_SECRET: line![1] }),
    ).not.toThrow();
  });

  // Setup generates `randomBytes(32).toString("base64")`: 44 characters.
  it("accepts the kind of secret setup generates", () => {
    const generated = Buffer.alloc(32, 7).toString("base64");
    expect(generated).toHaveLength(44);
    expect(readAuthSecret({ BETTER_AUTH_SECRET: generated })).toBe(generated);
  });

  // Better Auth prefers the rotation list over `secret`, which would skip the checks above.
  it.each([`1:${BETTER_AUTH_DEFAULT_SECRET}`, ""])(
    "refuses BETTER_AUTH_SECRETS=%j, even next to a good secret",
    (secrets) => {
      expect(() =>
        readAuthSecret({
          BETTER_AUTH_SECRET: GOOD_SECRET,
          BETTER_AUTH_SECRETS: secrets,
        }),
      ).toThrow(/BETTER_AUTH_SECRETS/);
    },
  );

  it.each(["weak-secret-value-xyz", `1:${GOOD_SECRET}`])(
    "never puts the secret in its error (%#)",
    (value) => {
      const env =
        value === "weak-secret-value-xyz"
          ? { BETTER_AUTH_SECRET: value }
          : { BETTER_AUTH_SECRET: GOOD_SECRET, BETTER_AUTH_SECRETS: value };
      let message = "";
      try {
        readAuthSecret(env);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/BETTER_AUTH_SECRET/);
      expect(message).not.toContain(value);
      expect(message).not.toContain(GOOD_SECRET);
    },
  );

  it("reads process.env when given nothing", () => {
    const before = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = GOOD_SECRET;
    try {
      expect(readAuthSecret()).toBe(GOOD_SECRET);
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = before;
    }
  });
});
