import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_KEYS, type MockKey } from "./config";
import { MOCK_DELAY_MS, createMockFetch } from "./fetch";
import { CONCEPT_IDS, COURSE_ID, DOCUMENT_ID, question } from "./fixtures";

const BASE = "http://test.local";

/** One request per mock key, as the client would send it. */
const REQUESTS: Record<MockKey, () => Request> = {
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
});

describe("createMockFetch", () => {
  it("is the real fetch itself when nothing is mocked", () => {
    const real = realApi();
    expect(createMockFetch({ enabled: new Set(), fetch: real })).toBe(real);
  });

  it.each(MOCK_KEYS)(
    "mocks only the %s endpoints when that key is on",
    async (key) => {
      const real = realApi();
      const mockFetch = createMockFetch({
        enabled: new Set([key]),
        fetch: real,
        delayMs: 0,
      });

      for (const other of MOCK_KEYS) {
        real.mockClear();
        const response = await mockFetch(REQUESTS[other]());
        const body: unknown = await response.json();
        if (other === key) {
          expect(real).not.toHaveBeenCalled();
          expect(body).not.toEqual({ from: "real" });
        } else {
          expect(real).toHaveBeenCalledOnce();
          expect(body).toEqual({ from: "real" });
        }
      }
    },
  );

  it("passes paths no mock knows to the real API", async () => {
    const real = realApi();
    const mockFetch = createMockFetch({
      enabled: new Set(MOCK_KEYS),
      fetch: real,
      delayMs: 0,
    });
    await mockFetch(new Request(`${BASE}/api/health`));
    await mockFetch(new Request(`${BASE}/api/courses`, { method: "DELETE" }));
    expect(real).toHaveBeenCalledTimes(2);
  });

  it(`answers after about ${MOCK_DELAY_MS} ms`, async () => {
    vi.useFakeTimers();
    const mockFetch = createMockFetch({ enabled: new Set(["courses"]) });
    let settled = false;
    const pending = mockFetch(REQUESTS.courses()).then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(MOCK_DELAY_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(200);
  });
});
