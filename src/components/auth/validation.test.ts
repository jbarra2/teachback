import { describe, expect, it } from "vitest";
import {
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  emailError,
  nameError,
  passwordError,
  validateLogin,
  validateSignup,
} from "./validation";

describe("emailError", () => {
  it.each(["a@b.co", "first.last+tag@uni.example.edu", "  pad@ded.com  "])(
    "accepts %j",
    (email) => {
      expect(emailError(email)).toBeUndefined();
    },
  );

  it.each(["", "   "])("asks for an email when given %j", (email) => {
    expect(emailError(email)).toBe("Enter your email address.");
  });

  it.each([
    "plain",
    "no-at.com",
    "a@b",
    "a b@c.com",
    "a@b c.com",
    "@b.com",
    "a@.com",
  ])("rejects %j", (email) => {
    expect(emailError(email)).toMatch(/valid email/);
  });
});

describe("passwordError", () => {
  it("asks for a password when empty", () => {
    expect(passwordError("")).toBe("Enter your password.");
  });

  it.each([
    [PASSWORD_MIN - 1, false],
    [PASSWORD_MIN, true],
    [PASSWORD_MAX, true],
    [PASSWORD_MAX + 1, false],
  ])("length %i is valid: %s", (length, valid) => {
    const error = passwordError("x".repeat(length));
    if (valid) expect(error).toBeUndefined();
    else expect(error).toMatch(/characters/);
  });

  it("counts spaces as characters (passwords aren't trimmed)", () => {
    expect(passwordError("        ")).toBeUndefined();
  });
});

describe("nameError", () => {
  it.each(["", "   "])("asks for a name when given %j", (name) => {
    expect(nameError(name)).toBe("Enter your name.");
  });

  it("allows up to the maximum after trimming", () => {
    expect(nameError(` ${"a".repeat(NAME_MAX)} `)).toBeUndefined();
    expect(nameError("a".repeat(NAME_MAX + 1))).toMatch(/at most/);
  });
});

describe("validateLogin / validateSignup", () => {
  it("returns only the fields with errors", () => {
    expect(validateLogin({ email: "a@b.co", password: "short" })).toEqual({
      password: `Use at least ${PASSWORD_MIN} characters.`,
    });
  });

  it("returns no errors for valid values", () => {
    expect(validateLogin({ email: "a@b.co", password: "long enough" })).toEqual(
      {},
    );
    expect(
      validateSignup({ name: "Ada", email: "a@b.co", password: "long enough" }),
    ).toEqual({});
  });

  it("checks every signup field", () => {
    expect(
      Object.keys(validateSignup({ name: "", email: "", password: "" })),
    ).toEqual(["name", "email", "password"]);
  });
});
