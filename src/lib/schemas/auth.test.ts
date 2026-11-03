import { describe, expect, it } from "vitest";
import { LIMITS } from "./common";
import { SignInBody, SignUpBody, safeNextPath } from "./auth";

const GOOD = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse",
};

describe("LIMITS for accounts", () => {
  it("matches the sign-up form (T05) and RFC 5321's address length", () => {
    expect(LIMITS).toMatchObject({
      passwordMin: 8,
      passwordMax: 128,
      userName: 100,
      email: 254,
    });
  });
});

// 64 + 1 + 189 = 254 characters, with every domain label within DNS's 63.
const EMAIL_254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;

describe("email length", () => {
  it("accepts an address of exactly 254 characters and refuses 255", () => {
    expect(EMAIL_254).toHaveLength(254);
    for (const schema of [SignUpBody, SignInBody]) {
      const body = { name: "Ada", email: EMAIL_254, password: "correct-horse" };
      const fields =
        schema === SignInBody
          ? { email: body.email, password: body.password }
          : body;
      expect(schema.safeParse(fields).success).toBe(true);
      expect(
        schema.safeParse({ ...fields, email: `a${EMAIL_254}` }).success,
      ).toBe(false);
    }
  });
});

describe("SignUpBody", () => {
  it("accepts a normal sign-up and returns the trimmed, lowercased values", () => {
    expect(
      SignUpBody.parse({
        name: "  Ada Lovelace ",
        email: " Ada@Example.COM ",
        password: " pass word ",
        rememberMe: true,
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      // Passwords are never trimmed: spaces are part of them.
      password: " pass word ",
      rememberMe: true,
    });
  });

  it.each([
    [
      "an image URL, which Better Auth would store unchecked",
      { image: "x".repeat(10_000) },
    ],
    ["a callbackURL", { callbackURL: "https://evil.example" }],
    ["emailVerified", { emailVerified: true }],
    ["an id", { id: "c000000000000000000000000" }],
  ])("refuses %s", (_name, extra) => {
    const result = SignUpBody.safeParse({ ...GOOD, ...extra });
    expect(result.success).toBe(false);
  });

  it.each([
    ["a name over 100 characters", { name: "a".repeat(101) }],
    ["a blank name", { name: "   " }],
    ["a name with NUL", { name: "Ada\u0000" }],
    ["a 7-character password", { password: "1234567" }],
    ["a 129-character password", { password: "p".repeat(129) }],
    [
      "an email over 254 characters",
      { email: `${"a".repeat(245)}@example.com` },
    ],
    ["a malformed email", { email: "not-an-email" }],
    ["a non-boolean rememberMe", { rememberMe: "yes" }],
    ["a number for the name", { name: 42 }],
  ])("refuses %s", (_name, change) => {
    expect(SignUpBody.safeParse({ ...GOOD, ...change }).success).toBe(false);
  });

  it("allows a name of exactly 100 characters, counted as characters", () => {
    expect(
      SignUpBody.safeParse({ ...GOOD, name: "a".repeat(100) }).success,
    ).toBe(true);
    expect(
      SignUpBody.safeParse({ ...GOOD, name: "😀".repeat(100) }).success,
    ).toBe(true);
  });

  it("allows passwords of exactly 8 and 128 characters", () => {
    for (const password of ["p".repeat(8), "p".repeat(128)])
      expect(SignUpBody.safeParse({ ...GOOD, password }).success).toBe(true);
  });

  it.each(["name", "email", "password"])("requires %s", (field) => {
    const body: Record<string, unknown> = { ...GOOD };
    delete body[field];
    expect(SignUpBody.safeParse(body).success).toBe(false);
  });
});

describe("SignInBody", () => {
  it("accepts an email and password, and normalizes the email", () => {
    expect(
      SignInBody.parse({ email: " ADA@example.com", password: "x" }),
    ).toEqual({ email: "ada@example.com", password: "x" });
  });

  // A password that sign-up accepted must sign in unchanged: same cap, spaces kept.
  it("accepts a 128-character password and keeps its spaces", () => {
    for (const password of ["p".repeat(128), " pass word "])
      expect(
        SignInBody.parse({ email: "ada@example.com", password }).password,
      ).toBe(password);
  });

  it.each([
    ["a name", { name: "Ada" }],
    ["a callbackURL", { callbackURL: "https://evil.example" }],
    ["an empty password", { password: "" }],
    ["a 129-character password", { password: "p".repeat(129) }],
  ])("refuses %s", (_name, change) => {
    expect(
      SignInBody.safeParse({
        email: "ada@example.com",
        password: "x",
        ...change,
      }).success,
    ).toBe(false);
  });
});

describe("safeNextPath (where to go after sign-in)", () => {
  const ORIGIN = "https://teachback.example.test";

  it.each([
    ["/courses?x=1", "/courses?x=1"],
    [
      "/courses/c1/practice?concept=c2#top",
      "/courses/c1/practice?concept=c2#top",
    ],
    ["/", "/"],
  ])("keeps the same-origin path %j", (next, expected) => {
    expect(safeNextPath(next, ORIGIN)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    // URLSearchParams decodes %09 to a tab, and URL parsing strips tabs: "//evil.example".
    "/\t/evil.example",
    "/\n/evil.example",
    // Paths other than /courses, so the fallback can't be mistaken for the path passing through.
    "https://evil.example/x",
    "http://teachback.example.test/x",
    "javascript:alert(1)",
    "data:text/html,hi",
    // Same origin while parsing, but dot segments are removed after the origin is fixed, so the
    // path that comes out is "//evil.example": another site, as a redirect target.
    "/.//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/a/..//evil.example",
    "/courses/../..//evil.example/x?y=1",
  ])("sends %j to /courses instead", (next) => {
    expect(safeNextPath(next, ORIGIN)).toBe("/courses");
  });

  it.each([null, undefined, ""])("uses /courses when next is %j", (next) => {
    expect(safeNextPath(next, ORIGIN)).toBe("/courses");
  });

  it("decodes nothing itself, so an encoded tab stays part of a local path", () => {
    expect(safeNextPath("/%09/evil.example", ORIGIN)).toBe("/%09/evil.example");
  });
});
