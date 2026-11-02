import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_KEYS, enabledMockEndpoints, parseMockEndpoints } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseMockEndpoints", () => {
  it.each([undefined, "", " ", ","])("mocks nothing for %j", (value) => {
    expect(parseMockEndpoints(value).size).toBe(0);
  });

  it("reads a comma list, ignoring spaces, case and duplicates", () => {
    expect([...parseMockEndpoints(" courses, MAP ,courses,,next ")]).toEqual([
      "courses",
      "map",
      "next",
    ]);
  });

  it("ignores unknown keys", () => {
    expect([...parseMockEndpoints("courses,users,all,*")]).toEqual(["courses"]);
  });

  it("accepts every documented key", () => {
    expect([...parseMockEndpoints(MOCK_KEYS.join(","))]).toEqual([
      ...MOCK_KEYS,
    ]);
  });
});

describe("enabledMockEndpoints", () => {
  it("reads NEXT_PUBLIC_MOCK_ENDPOINTS", () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENDPOINTS", "question,answer");
    expect([...enabledMockEndpoints()]).toEqual(["question", "answer"]);
  });

  it("is off when the variable is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENDPOINTS", "");
    expect(enabledMockEndpoints().size).toBe(0);
  });
});
