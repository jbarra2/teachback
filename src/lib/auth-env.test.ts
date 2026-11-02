import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_TEST_SECRET,
  assertAuthEnvReady,
  authEnvProblems,
  readAuthEnv,
} from "./auth-env";

const PROD = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://teachback.example.test",
  BETTER_AUTH_SECRET: "a-real-production-secret-that-is-long-enough",
  TRUSTED_IP_HEADER: "x-real-ip",
};

describe("readAuthEnv", () => {
  it("reads the base URL, the app origin and the trusted IP header", () => {
    expect(readAuthEnv(PROD)).toEqual({
      baseURL: "https://teachback.example.test",
      appOrigin: "https://teachback.example.test",
      trustedIpHeader: "x-real-ip",
      secureCookies: true,
    });
  });

  it("uses plain cookies for an http base URL (local development)", () => {
    const env = readAuthEnv({ BETTER_AUTH_URL: "http://localhost:3000" });
    expect(env.secureCookies).toBe(false);
    expect(env.appOrigin).toBe("http://localhost:3000");
  });

  it("treats blank values as unset and lowercases the header name", () => {
    expect(
      readAuthEnv({ BETTER_AUTH_URL: "  ", TRUSTED_IP_HEADER: " X-Real-IP " }),
    ).toEqual({
      baseURL: undefined,
      appOrigin: undefined,
      trustedIpHeader: "x-real-ip",
      secureCookies: false,
    });
  });

  it("never throws, so a production build with test values still compiles", () => {
    expect(() =>
      readAuthEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "not a url" }),
    ).not.toThrow();
  });
});

describe("authEnvProblems", () => {
  it("finds nothing wrong with a complete production setup", () => {
    expect(authEnvProblems(PROD)).toEqual([]);
  });

  it.each([
    [
      "BETTER_AUTH_URL is unset",
      { BETTER_AUTH_URL: undefined },
      "BETTER_AUTH_URL",
    ],
    [
      "BETTER_AUTH_URL is http",
      { BETTER_AUTH_URL: "http://teachback.example.test" },
      "BETTER_AUTH_URL",
    ],
    [
      "BETTER_AUTH_URL isn't a URL",
      { BETTER_AUTH_URL: "teachback" },
      "BETTER_AUTH_URL",
    ],
    [
      "BETTER_AUTH_URL is https but not a valid URL",
      { BETTER_AUTH_URL: "https://not a host" },
      "BETTER_AUTH_URL",
    ],
    [
      "TRUSTED_IP_HEADER is unset",
      { TRUSTED_IP_HEADER: undefined },
      "TRUSTED_IP_HEADER",
    ],
    [
      "TRUSTED_IP_HEADER isn't a header name",
      { TRUSTED_IP_HEADER: "x real ip" },
      "TRUSTED_IP_HEADER",
    ],
    [
      "the secret is the public test one",
      { BETTER_AUTH_SECRET: PUBLIC_TEST_SECRET },
      "BETTER_AUTH_SECRET",
    ],
    [
      "TEST is set, which Better Auth reads as a test run",
      { TEST: "1" },
      "TEST",
    ],
  ])("reports it in production when %s", (_name, change, variable) => {
    const problems = authEnvProblems({ ...PROD, ...change });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(variable);
  });

  it.each([
    ["BETTER_AUTH_TELEMETRY", "1"],
    ["BETTER_AUTH_TRUSTED_ORIGINS", "https://evil.example"],
    // The auth route reads TRUSTED_IP_HEADER before it removes the client's copy of its own header,
    // so naming that header would let every client choose its own rate-limit address.
    ["TRUSTED_IP_HEADER", "x-teachback-client-ip"],
    ["TRUSTED_IP_HEADER", " X-TeachBack-Client-IP "],
  ])("refuses %s=%j in every environment", (variable, value) => {
    expect(authEnvProblems({ ...PROD, [variable]: value })).toEqual([
      expect.stringContaining(variable),
    ]);
    expect(
      authEnvProblems({ NODE_ENV: "development", [variable]: value }),
    ).toEqual([expect.stringContaining(variable)]);
  });

  it("allows development without a trusted IP header or https", () => {
    expect(
      authEnvProblems({
        NODE_ENV: "development",
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: PUBLIC_TEST_SECRET,
      }),
    ).toEqual([]);
  });

  it("never puts a variable's value in the message", () => {
    const secretish = "https://user:hunter22@evil.example";
    const problems = authEnvProblems({
      ...PROD,
      BETTER_AUTH_URL: secretish,
      BETTER_AUTH_SECRET: PUBLIC_TEST_SECRET,
      BETTER_AUTH_TRUSTED_ORIGINS: secretish,
    });
    expect(problems.join(" ")).not.toMatch(/hunter22|test-secret/);
  });

  it("knows the exact public secret that .env.test commits", () => {
    const envTest = readFileSync(
      path.resolve(import.meta.dirname, "../../.env.test"),
      "utf8",
    );
    expect(envTest).toContain(`BETTER_AUTH_SECRET=${PUBLIC_TEST_SECRET}\n`);
  });
});

describe("assertAuthEnvReady", () => {
  it("passes a good production setup", () => {
    expect(() => assertAuthEnvReady(PROD)).not.toThrow();
  });

  it("throws listing the problem variables, not their values", () => {
    expect(() =>
      assertAuthEnvReady({ ...PROD, BETTER_AUTH_SECRET: PUBLIC_TEST_SECRET }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});
