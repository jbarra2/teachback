import { afterEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));
const logError = vi.fn();
vi.mock("@/lib/log", () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { checkHealth, HEALTH_DB_TIMEOUT_MS } = await import("./health");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("checkHealth", () => {
  it("reports the database up when a query answers", async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    expect(await checkHealth()).toEqual({ status: "ok", db: "up" });
  });

  it("reports it down when the query fails, and logs only the error's name", async () => {
    queryRaw.mockRejectedValue(
      new Error("connect ECONNREFUSED postgresql://u:secret-pw@db:5432/app"),
    );
    expect(await checkHealth()).toEqual({ status: "error", db: "down" });
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-pw");
    expect(logError).toHaveBeenCalledWith(
      "Health check: database unreachable",
      { errorName: "Error" },
    );
  });

  it("reports it down when the query hangs, instead of hanging the health check", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {}));
    const result = checkHealth();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(await result).toEqual({ status: "error", db: "down" });
  });

  it("waits a little under the timeout without giving up", async () => {
    vi.useFakeTimers();
    let answer: (rows: unknown) => void = () => {};
    queryRaw.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const result = checkHealth();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS - 10);
    answer([{ ok: 1 }]);
    expect(await result).toEqual({ status: "ok", db: "up" });
  });
});
