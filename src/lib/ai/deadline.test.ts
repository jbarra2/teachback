import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "./deadline";

afterEach(() => vi.useRealTimers());

describe("withDeadline", () => {
  it("passes the result through when the work finishes in time", async () => {
    await expect(withDeadline(Promise.resolve("done"), 1_000)).resolves.toBe(
      "done",
    );
  });

  it("passes a failure through unchanged", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("boom")), 1_000),
    ).rejects.toThrow("boom");
  });

  it("gives up with an AI timeout when the work takes too long", async () => {
    vi.useFakeTimers();
    const result = withDeadline(new Promise(() => {}), 5_000);
    const settled = expect(result).rejects.toMatchObject({
      name: "AiError",
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
  });

  it("clears its timer, so a finished run leaves nothing pending", async () => {
    vi.useFakeTimers();
    await withDeadline(Promise.resolve(1), 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
