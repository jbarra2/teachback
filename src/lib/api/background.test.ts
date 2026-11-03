import { afterEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
vi.mock("next/server", () => ({ after }));

const error = vi.fn();
vi.mock("@/lib/log", () => ({ log: { error } }));

const { runAfterResponse } = await import("./background");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("runAfterResponse", () => {
  describe("under test (NODE_ENV=test)", () => {
    it("runs the work inline, so a test can await it", async () => {
      const work = vi.fn(async () => {});
      await runAfterResponse(work);
      expect(work).toHaveBeenCalledOnce();
      expect(after).not.toHaveBeenCalled();
    });

    it("waits for async work to finish", async () => {
      let finished = false;
      await runAfterResponse(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished = true;
      });
      expect(finished).toBe(true);
    });

    it("logs a failure by name only and doesn't reject", async () => {
      await expect(
        runAfterResponse(async () => {
          throw new TypeError("postgres://user:secret@db/teachback");
        }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith("Background task failed", {
        errorName: "TypeError",
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    });
  });

  it("logs a thrown non-Error by its type", async () => {
    await runAfterResponse(() => {
      throw "a plain string";
    });
    expect(error).toHaveBeenCalledWith("Background task failed", {
      errorName: "string",
    });
  });

  describe("in the app", () => {
    it.each(["production", "development"])(
      "hands the work to Next's after() under NODE_ENV=%s without running it now",
      async (nodeEnv) => {
        vi.stubEnv("NODE_ENV", nodeEnv);
        const work = vi.fn(async () => {});
        await runAfterResponse(work);
        expect(after).toHaveBeenCalledOnce();
        expect(work).not.toHaveBeenCalled();
        await after.mock.calls[0][0]();
        expect(work).toHaveBeenCalledOnce();
      },
    );

    it("catches and logs a failure inside after() too", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await runAfterResponse(() => {
        throw new RangeError("boom");
      });
      await expect(after.mock.calls[0][0]()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith("Background task failed", {
        errorName: "RangeError",
      });
    });
  });
});
