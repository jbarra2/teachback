// The mocks driven through the real typed client, all keys on, with a network that must not be used.
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, unwrap } from "@/lib/api-client";
import { MOCK_KEYS } from "./config";
import {
  CONCEPT_IDS,
  COURSE_2_ID,
  COURSE_ID,
  DOCUMENT_ID,
  answerResults,
  concepts,
  courseMap,
  courses,
  nextConcept,
  question,
} from "./fixtures";

const UNKNOWN_ID = "cunknown00000000000000001";

function mockedApi() {
  const network = vi.fn<(request: Request) => Promise<Response>>(async () => {
    throw new Error("the mocks should answer every call");
  });
  const api = createApiClient({
    baseUrl: "http://test.local",
    fetch: network,
    mocks: new Set(MOCK_KEYS),
    mockDelayMs: 0,
    onUnauthenticated: () => {},
  });
  return { api, network };
}

async function rejection(call: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error;
}

describe("courses mock", () => {
  it("lists, creates and shows courses", async () => {
    const { api, network } = mockedApi();
    expect(await unwrap(api.GET("/api/courses"))).toEqual(courses);

    const { data, response } = await api.POST("/api/courses", {
      body: { name: "  CHEM 142  " },
    });
    expect(response.status).toBe(201);
    expect(data).toMatchObject({ name: "CHEM 142" });
    expect(data?.id).toMatch(/^c[a-z0-9]{24}$/);

    const list = await unwrap(api.GET("/api/courses"));
    expect(list).toHaveLength(courses.length + 1);

    const created = await unwrap(
      api.GET("/api/courses/{id}", { params: { path: { id: data!.id } } }),
    );
    expect(created.documents).toEqual([]);

    const demo = await unwrap(
      api.GET("/api/courses/{id}", { params: { path: { id: COURSE_ID } } }),
    );
    expect(demo.documents.map((doc) => doc.status)).toEqual([
      "READY",
      "FAILED",
    ]);
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(121)])(
    "rejects the name %j like the server",
    async (name) => {
      const { api } = mockedApi();
      const error = await rejection(
        unwrap(api.POST("/api/courses", { body: { name } })),
      );
      expect(error).toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
      expect(error.details?.fieldErrors.name).toHaveLength(1);
    },
  );

  it("doesn't share state between clients", async () => {
    const first = mockedApi().api;
    await unwrap(first.POST("/api/courses", { body: { name: "New" } }));
    const second = mockedApi().api;
    expect(await unwrap(second.GET("/api/courses"))).toEqual(courses);
  });
});

describe("course data mocks", () => {
  it("returns concepts, the map and the next concept for the demo course", async () => {
    const { api } = mockedApi();
    const params = { params: { path: { id: COURSE_ID } } };
    expect(await unwrap(api.GET("/api/courses/{id}/concepts", params))).toEqual(
      concepts,
    );
    expect(await unwrap(api.GET("/api/courses/{id}/map", params))).toEqual(
      courseMap,
    );
    expect(
      await unwrap(api.GET("/api/courses/{id}/next-concept", params)),
    ).toEqual(nextConcept);
  });

  it("returns empty data for a course without notes", async () => {
    const { api } = mockedApi();
    const params = { params: { path: { id: COURSE_2_ID } } };
    expect(await unwrap(api.GET("/api/courses/{id}/concepts", params))).toEqual(
      [],
    );
    expect(await unwrap(api.GET("/api/courses/{id}/map", params))).toEqual({
      nodes: [],
      edges: [],
    });
    expect(
      await unwrap(api.GET("/api/courses/{id}/next-concept", params)),
    ).toBeNull();
  });

  it("only links concepts that exist", () => {
    const ids = new Set(courseMap.nodes.map((node) => node.id));
    for (const edge of courseMap.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });

  it.each([
    "/api/courses/{id}",
    "/api/courses/{id}/concepts",
    "/api/courses/{id}/map",
    "/api/courses/{id}/next-concept",
  ] as const)("%s is a 404 for an unknown course", async (path) => {
    const { api } = mockedApi();
    const error = await rejection(
      unwrap(api.GET(path, { params: { path: { id: UNKNOWN_ID } } })),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("documents mock", () => {
  function upload(
    api: ReturnType<typeof mockedApi>["api"],
    courseId: string,
    title: string,
  ) {
    return api.POST("/api/documents", {
      body: { courseId, title, text: "Cells are the unit of life." },
      bodySerializer(body) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body))
          if (value !== undefined) form.append(key, value);
        return form;
      },
    });
  }

  it("accepts an upload and steps it to READY across polls", async () => {
    const { api } = mockedApi();
    const { data, response } = await upload(api, COURSE_ID, "Week 3");
    expect(response.status).toBe(202);
    expect(data?.status).toBe("QUEUED");

    const poll = () =>
      unwrap(
        api.GET("/api/documents/{id}", { params: { path: { id: data!.id } } }),
      );
    expect(await poll()).toMatchObject({
      status: "PROCESSING",
      conceptCount: 0,
    });
    expect(await poll()).toMatchObject({ status: "READY", conceptCount: 3 });
    expect(await poll()).toMatchObject({ status: "READY" });

    const course = await unwrap(
      api.GET("/api/courses/{id}", { params: { path: { id: COURSE_ID } } }),
    );
    expect(course.documents.map((doc) => doc.title)).toContain("Week 3");
  });

  it("reports the seeded documents as they are", async () => {
    const { api } = mockedApi();
    expect(
      await unwrap(
        api.GET("/api/documents/{id}", {
          params: { path: { id: DOCUMENT_ID } },
        }),
      ),
    ).toEqual({
      id: DOCUMENT_ID,
      status: "READY",
      conceptCount: concepts.length,
    });
  });

  it("rejects a missing title and an unknown course", async () => {
    const { api } = mockedApi();
    expect(await rejection(unwrap(upload(api, COURSE_ID, " ")))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(
      await rejection(unwrap(upload(api, UNKNOWN_ID, "Notes"))),
    ).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await rejection(
        unwrap(
          api.GET("/api/documents/{id}", {
            params: { path: { id: UNKNOWN_ID } },
          }),
        ),
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("practice mocks", () => {
  it("asks a question about a known concept", async () => {
    const { api } = mockedApi();
    expect(
      await unwrap(
        api.POST("/api/concepts/{id}/question", {
          params: { path: { id: CONCEPT_IDS.osmosis } },
        }),
      ),
    ).toEqual(question);
  });

  it("cycles CORRECT, PARTIAL and INCORRECT feedback", async () => {
    const { api } = mockedApi();
    const answer = () =>
      unwrap(
        api.POST("/api/questions/{id}/answer", {
          params: { path: { id: question.questionId } },
          body: { answer: "Water moves toward more solute." },
        }),
      );
    const verdicts = [];
    for (let i = 0; i < 4; i++)
      verdicts.push((await answer()).feedback.verdict);
    expect(verdicts).toEqual(["CORRECT", "PARTIAL", "INCORRECT", "CORRECT"]);
    expect(answerResults).toHaveLength(3);
  });

  it.each(["", " ", "x".repeat(4001)])(
    "rejects the answer %j like the server",
    async (text) => {
      const { api } = mockedApi();
      const error = await rejection(
        unwrap(
          api.POST("/api/questions/{id}/answer", {
            params: { path: { id: question.questionId } },
            body: { answer: text },
          }),
        ),
      );
      expect(error).toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    },
  );

  it("is a 404 for an unknown concept or question", async () => {
    const { api } = mockedApi();
    const params = { params: { path: { id: UNKNOWN_ID } } };
    expect(
      await rejection(unwrap(api.POST("/api/concepts/{id}/question", params))),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await rejection(
        unwrap(
          api.POST("/api/questions/{id}/answer", {
            ...params,
            body: { answer: "Anything" },
          }),
        ),
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
  });
});
