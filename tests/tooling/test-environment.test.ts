import { describe, expect, it } from "vitest";

// Sample unit test: *.test.ts runs in Node, so server code is tested without a fake DOM.
describe("unit test environment", () => {
  it("runs *.test.ts files in Node, not jsdom", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });
});
