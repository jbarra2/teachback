import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const push = (line: unknown) => lines.push(JSON.parse(String(line)));
  return Object.assign(lines, {
    toLog: vi.spyOn(console, "log").mockImplementation(push),
    toWarn: vi.spyOn(console, "warn").mockImplementation(push),
    toError: vi.spyOn(console, "error").mockImplementation(push),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("writes one JSON line with the level, the message and the fields", () => {
    const lines = capture();
    log.error("Request failed", { requestId: "r1", status: 500 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      msg: "Request failed",
      requestId: "r1",
      status: 500,
    });
    expect(Date.parse(String(lines[0].time))).not.toBeNaN();
  });

  it("sends each level to the matching console method", () => {
    const { toLog, toWarn, toError } = capture();
    log.info("a");
    log.warn("b");
    log.error("c");
    expect(toLog).toHaveBeenCalledTimes(1);
    expect(toWarn).toHaveBeenCalledTimes(1);
    expect(toError).toHaveBeenCalledTimes(1);
  });

  it("drops debug lines", () => {
    const { toLog } = capture();
    log.debug("noisy");
    expect(toLog).not.toHaveBeenCalled();
  });

  it("hides email addresses in the message", () => {
    const lines = capture();
    log.info("Sign-up attempt for existing email: Ada.L@example.com");
    expect(JSON.stringify(lines)).not.toContain("example.com");
    expect(lines[0].msg).toBe("Sign-up attempt for existing email: [email]");
  });

  it("keeps only plain values in the fields, so an error object or a body can't be logged", () => {
    const lines = capture();
    const fields = {
      ok: "kept",
      error: new Error("connection failed: secret-marker-db"),
      body: { password: "hunter22" },
      list: ["x"],
    } as unknown as Record<string, string>;
    log.error("x", fields);
    expect(lines[0].ok).toBe("kept");
    expect(JSON.stringify(lines)).not.toMatch(/secret|hunter22/);
    expect(lines[0]).not.toHaveProperty("error");
    expect(lines[0]).not.toHaveProperty("body");
    expect(lines[0]).not.toHaveProperty("list");
  });

  it("can't overwrite the level, time or message through the fields", () => {
    const lines = capture();
    log.warn("real", { level: "info", msg: "fake", time: "never" });
    expect(lines[0]).toMatchObject({ level: "warn", msg: "real" });
    expect(lines[0].time).not.toBe("never");
  });

  it("hides email addresses in field values too", () => {
    const lines = capture();
    log.info("x", { who: "ada@example.com" });
    expect(lines[0].who).toBe("[email]");
  });
});

// T14: redaction. Whatever a caller or a library passes, these never reach a log line.
describe("log redaction", () => {
  it.each([
    "cookie",
    "Cookie",
    "set-cookie",
    "authorization",
    "Authorization",
    "token",
    "sessionToken",
    "session_token",
    "accessToken",
    "secret",
    "clientSecret",
    "password",
    "newPassword",
    "apiKey",
    "api_key",
    "x-api-key",
    "BETTER_AUTH_SECRET",
    "ANTHROPIC_API_KEY",
    "sessionId",
  ])("redacts the value of a field named %j", (key) => {
    const lines = capture();
    log.info("x", { [key]: "value-marker-123" });
    expect(lines[0][key]).toBe("[redacted]");
    expect(JSON.stringify(lines)).not.toContain("value-marker-123");
  });

  it.each([
    "text",
    "rawText",
    "noteText",
    "answer",
    "content",
    "body",
    "prompt",
    "note",
    "studentAnswer",
    "answerText",
    "questionText",
    "feedback",
    "excerpt",
    "chunkText",
    "quote",
    "question",
    "chunk",
  ])(
    "never writes a field named %j, which could hold a student's notes or answer",
    (key) => {
      const lines = capture();
      log.info("x", { [key]: "The mitochondria is the powerhouse" });
      expect(lines[0][key]).toBe("[redacted]");
      expect(JSON.stringify(lines)).not.toContain("powerhouse");
    },
  );

  it("keeps ordinary fields", () => {
    const lines = capture();
    log.info("x", {
      requestId: "r1",
      path: "/api/courses",
      status: 429,
      userIdKnown: true,
    });
    expect(lines[0]).toMatchObject({
      requestId: "r1",
      path: "/api/courses",
      status: 429,
      userIdKnown: true,
    });
  });

  // Built from parts so secret scanners don't read the fake values as real credentials.
  const ANTHROPIC_PREFIX = ["sk", "ant", "api03"].join("-");
  const DB_URL = [
    "postgresql:",
    "",
    "teach:pa55word@db.example:5432",
    "app",
  ].join("/");

  const SECRETS: [string, string, string][] = [
    [
      "an Anthropic key",
      `key ${ANTHROPIC_PREFIX}-AbC_dEf-123456789`,
      ANTHROPIC_PREFIX,
    ],
    [
      "a bearer token",
      "sent Authorization: Bearer eyJhbGciOi.payload.sig",
      "eyJhbGciOi",
    ],
    [
      "basic credentials",
      "sent Authorization: Basic dXNlcjpodW50ZXIy",
      "dXNlcjpodW50ZXIy",
    ],
    [
      "a session data cookie",
      // Low-entropy fake values, so secret scanners don't take them for real ones.
      "cookie better-auth.session_data=xxxxxxxxdata.xxxx; Path=/",
      "xxxxxxxxdata",
    ],
    [
      "a session cookie",
      "cookie better-auth.session_token=xxxxxxxxtoken.xxxx; Path=/",
      "xxxxxxxxtoken",
    ],
    [
      "a secure session cookie",
      "__Secure-better-auth.session_token=tok456.sig",
      "tok456.sig",
    ],
    ["a database URL's password", `connect failed: ${DB_URL}`, "pa55word"],
    [
      "a token in a query string",
      "GET /reset?token=tok789xyz&x=1",
      "tok789xyz",
    ],
    ["a password in a query string", "body password=hunter22", "hunter22"],
    ["an API key in a query string", "GET /x?api_key=k123secret", "k123secret"],
    [
      "a password in JSON",
      'failed: {"email":"a","password":"hunter33"}',
      "hunter33",
    ],
    ["a token after a colon", "refresh failed, token: tok321abc", "tok321abc"],
    [
      "a secret in single quotes",
      "config secret: 'sh-secret-99'",
      "sh-secret-99",
    ],
  ];

  it.each(SECRETS)("hides %s in the message", (_name, text, secret) => {
    const lines = capture();
    log.error(text);
    expect(JSON.stringify(lines)).not.toContain(secret);
    expect(String(lines[0].msg)).toContain("[redacted]");
  });

  it.each(SECRETS)("hides %s in a field value", (_name, text, secret) => {
    const lines = capture();
    log.error("x", { detail: text });
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it("keeps the readable part of a database URL", () => {
    const lines = capture();
    log.error(`connect failed: ${DB_URL}`);
    expect(lines[0].msg).toBe(
      "connect failed: postgresql://[redacted]@db.example:5432/app",
    );
  });
});
