// The test-only fake API: which requests it answers, which it hands on, and that it never reaches
// the real network by accident.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_ENDPOINTS,
  type FakeEndpoint,
  createFakeFetch,
} from "./fake-fetch";
import { CONCEPT_IDS, COURSE_ID, DOCUMENT_ID, question } from "./fixtures";

const BASE = "http://test.local";

/** One request per fake endpoint, as the client would send it. */
const REQUESTS: Record<FakeEndpoint, () => Request> = {
  courses: () => new Request(`${BASE}/api/courses`),
  documents: () => new Request(`${BASE}/api/documents/${DOCUMENT_ID}`),
  concepts: () => new Request(`${BASE}/api/courses/${COURSE_ID}/concepts`),
  question: () =>
    new Request(`${BASE}/api/concepts/${CONCEPT_IDS.osmosis}/question`, {
      method: "POST",
    }),
  answer: () =>
    new Request(`${BASE}/api/questions/${question.questionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer: "Water follows the solute." }),
    }),
  map: () => new Request(`${BASE}/api/courses/${COURSE_ID}/map`),
  next: () => new Request(`${BASE}/api/courses/${COURSE_ID}/next-concept`),
};

function realApi() {
  return vi.fn<(request: Request) => Promise<Response>>(async () =>
    Response.json({ from: "real" }, { status: 200 }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createFakeFetch", () => {
  it("is the given fetch itself when no endpoint is faked", () => {
    const real = realApi();
    expect(createFakeFetch({ endpoints: [], fetch: real })).toBe(real);
  });

  it.each(FAKE_ENDPOINTS)(
    "fakes only the %s endpoints when that one is on",
    async (endpoint) => {
      const real = realApi();
      const fakeFetch = createFakeFetch({ endpoints: [endpoint], fetch: real });

      for (const other of FAKE_ENDPOINTS) {
        real.mockClear();
        const response = await fakeFetch(REQUESTS[other]());
        const body: unknown = await response.json();
        if (other === endpoint) {
          expect(real).not.toHaveBeenCalled();
          expect(body).not.toEqual({ from: "real" });
        } else {
          expect(real).toHaveBeenCalledOnce();
          expect(body).toEqual({ from: "real" });
        }
      }
    },
  );

  it("fakes every endpoint by default", async () => {
    const real = realApi();
    const fakeFetch = createFakeFetch({ fetch: real });
    for (const endpoint of FAKE_ENDPOINTS) {
      const response = await fakeFetch(REQUESTS[endpoint]());
      expect(response.ok).toBe(true);
    }
    expect(real).not.toHaveBeenCalled();
  });

  it("hands paths it doesn't know to the given fetch", async () => {
    const real = realApi();
    const fakeFetch = createFakeFetch({ fetch: real });
    await fakeFetch(new Request(`${BASE}/api/health`));
    await fakeFetch(new Request(`${BASE}/api/courses`, { method: "DELETE" }));
    expect(real).toHaveBeenCalledTimes(2);
  });

  it("rejects a request it can't answer instead of using the real network", async () => {
    const globalFetch = vi.fn(async () => Response.json({ from: "real" }));
    vi.stubGlobal("fetch", globalFetch);
    const fakeFetch = createFakeFetch({ endpoints: ["courses"] });

    await expect(fakeFetch(new Request(`${BASE}/api/health`))).rejects.toThrow(
      "GET /api/health",
    );
    await expect(fakeFetch(REQUESTS.map())).rejects.toThrow(
      `GET /api/courses/${COURSE_ID}/map`,
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("answers on the next tick unless given a delay", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = createFakeFetch()(REQUESTS.courses()).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(200);
  });

  it("waits delayMs before answering", async () => {
    vi.useFakeTimers();
    const fakeFetch = createFakeFetch({ delayMs: 50 });
    let settled = false;
    const pending = fakeFetch(REQUESTS.courses()).then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(200);
  });
});
