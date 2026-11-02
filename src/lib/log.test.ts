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
