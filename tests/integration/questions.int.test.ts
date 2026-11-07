// T17 · Question generation against the real stack (db-test, Better Auth sessions, withApi, the
// fake AI provider): the security matrix (TESTING §3) for POST /api/concepts/{id}/question and
// its behaviour. Every response is checked against openapi.yaml (S7).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as questionRoute from "@/app/api/concepts/[id]/question/route";
import { FAKE_FAILURE_MODES, setFakeFailure } from "@/lib/ai/fake";
import type * as generateModule from "@/lib/ai/generate-question";
import { db } from "@/lib/db";
import {
  resetRateLimitOverrides,
  setRateLimitOverrides,
} from "@/lib/rate-limit";
import { ID_PATTERN } from "@/lib/schemas";
import { as, asAnonymous, createUser, type TestUser } from "../helpers/api";
import { expectMatchesOpenApi } from "../helpers/openapi-assert";

// The real generateQuestion, unless a test swaps in its own to see what it's given.
const generation = vi.hoisted(() => ({
  override: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
vi.mock("@/lib/ai/generate-question", async (importOriginal) => {
  const actual = await importOriginal<typeof generateModule>();
  return {
    ...actual,
    generateQuestion: (...args: Parameters<typeof actual.generateQuestion>) =>
      generation.override
        ? generation.override(...args)
        : actual.generateQuestion(...args),
  };
});

const OP = "POST /api/concepts/{id}/question";
const MISSING_ID = "cmissing00000000000000000";

let ada: TestUser;
let grace: TestUser;

beforeAll(async () => {
  ada = await createUser({ name: "Ada" });
  grace = await createUser({ name: "Grace" });
});

afterEach(() => {
  generation.override = null;
  setFakeFailure(null);
  resetRateLimitOverrides();
  vi.restoreAllMocks();
});

/** A course with one document of `sections` chunks, and a concept linked to all of them. */
async function addConcept(owner: TestUser, sections = 2) {
  const course = await db.course.create({
    data: { userId: owner.id, name: "Bio" },
  });
  const document = await db.document.create({
    data: {
      courseId: course.id,
      title: "Week 1",
      sourceType: "TEXT",
      rawText: "notes",
      status: "READY",
    },
  });
  const chunks = [];
  for (let order = 0; order < sections; order++)
    chunks.push(
      await db.chunk.create({
        data: {
          documentId: document.id,
          order,
          text: `Section ${order}: cells divide by mitosis and membranes control entry.`,
          refLabel: `Week 1 › Part ${order + 1}`,
        },
      }),
    );
  const concept = await db.concept.create({
    data: {
      courseId: course.id,
      name: "Mitosis",
      nameKey: "mitosis",
      summary: "How cells divide.",
      chunks: { create: chunks.map((chunk) => ({ chunkId: chunk.id })) },
    },
  });
  return { course, document, chunks, concept };
}

const ask = (user: TestUser, id: string) =>
  as(user).call(questionRoute.POST, {
    method: "POST",
    url: `/api/concepts/${id}/question`,
    params: { id },
  });

async function expectError(res: Response, code: string) {
  expect(await expectMatchesOpenApi(res, OP)).toMatchObject({
    error: { code },
  });
}

describe("POST /api/concepts/{id}/question", () => {
  it("200: a question citing this concept's notes, saved, in the contract's shape", async () => {
    const { concept, chunks } = await addConcept(ada);
    const res = await ask(ada, concept.id);
    expect(res.status).toBe(200);
    const body = (await expectMatchesOpenApi(res, OP)) as {
      questionId: string;
      text: string;
      kind: string;
      sources: { chunkId: string; refLabel: string }[];
    };
    // S8: only the contract's fields.
    expect(Object.keys(body).sort()).toEqual([
      "kind",
      "questionId",
      "sources",
      "text",
    ]);
    expect(body.questionId).toMatch(ID_PATTERN);
    expect(body.kind).toBe("EXPLAIN");
    expect(body.sources).toEqual([
      { chunkId: chunks[0].id, refLabel: "Week 1 › Part 1" },
      { chunkId: chunks[1].id, refLabel: "Week 1 › Part 2" },
    ]);
    const saved = await db.question.findUniqueOrThrow({
      where: { id: body.questionId },
    });
    expect(saved).toMatchObject({
      conceptId: concept.id,
      text: body.text,
      kind: "EXPLAIN",
      sourceChunkIds: [chunks[0].id, chunks[1].id],
    });
  });

  it("sends the concept, its notes in order, and only the 5 most recent questions", async () => {
    const { concept } = await addConcept(ada, 3);
    for (let i = 1; i <= 7; i++)
      await db.question.create({
        data: {
          conceptId: concept.id,
          text: `Earlier question ${i}`,
          kind: "WHY",
          sourceChunkIds: [],
          createdAt: new Date(Date.UTC(2026, 0, i)),
        },
      });
    let seen: unknown[] = [];
    generation.override = async (...args) => {
      seen = args;
      return { text: "Why?", kind: "WHY", sourceKeys: ["s1"] };
    };
    expect((await ask(ada, concept.id)).status).toBe(200);
    const [conceptArg, sources, recent] = seen as [
      { name: string; summary: string },
      { key: string; refLabel: string; text: string }[],
      string[],
    ];
    expect(conceptArg).toEqual({
      name: "Mitosis",
      summary: "How cells divide.",
    });
    expect(sources.map((s) => [s.key, s.refLabel])).toEqual([
      ["s1", "Week 1 › Part 1"],
      ["s2", "Week 1 › Part 2"],
      ["s3", "Week 1 › Part 3"],
    ]);
    expect(recent).toEqual([
      "Earlier question 7",
      "Earlier question 6",
      "Earlier question 5",
      "Earlier question 4",
      "Earlier question 3",
    ]);
  });

  it("sends notes oldest document first, then in each document's order, however they were linked", async () => {
    const course = await db.course.create({
      data: { userId: ada.id, name: "Order" },
    });
    const doc = (title: string, createdAt: Date) =>
      db.document.create({
        data: {
          courseId: course.id,
          title,
          sourceType: "TEXT",
          rawText: "x",
          status: "READY",
          createdAt,
        },
      });
    // The newer document is created first, and chunks are inserted in reverse order.
    const newer = await doc("Week 2", new Date(Date.UTC(2026, 1, 1)));
    const older = await doc("Week 1", new Date(Date.UTC(2026, 0, 1)));
    const chunk = (documentId: string, order: number, refLabel: string) =>
      db.chunk.create({
        data: { documentId, order, text: refLabel, refLabel },
      });
    const made = [
      await chunk(newer.id, 1, "W2 b"),
      await chunk(newer.id, 0, "W2 a"),
      await chunk(older.id, 1, "W1 b"),
      await chunk(older.id, 0, "W1 a"),
    ];
    const concept = await db.concept.create({
      data: {
        courseId: course.id,
        name: "Ordered",
        nameKey: "ordered",
        summary: "x",
        chunks: {
          create: [made[2], made[0], made[3], made[1]].map((c) => ({
            chunkId: c.id,
          })),
        },
      },
    });
    let sources: { refLabel: string }[] = [];
    generation.override = async (_c, s) => {
      sources = s as { refLabel: string }[];
      return { text: "Why?", kind: "WHY", sourceKeys: ["s1"] };
    };
    expect((await ask(ada, concept.id)).status).toBe(200);
    expect(sources.map((s) => s.refLabel)).toEqual([
      "W1 a",
      "W1 b",
      "W2 a",
      "W2 b",
    ]);
  });

  it("the recent questions are this concept's own, never another concept's or user's", async () => {
    const { concept } = await addConcept(ada);
    const other = await addConcept(ada);
    const hers = await addConcept(grace);
    const q = (conceptId: string, text: string, day: number) =>
      db.question.create({
        data: {
          conceptId,
          text,
          kind: "WHY",
          sourceChunkIds: [],
          createdAt: new Date(Date.UTC(2030, 0, day)),
        },
      });
    await q(concept.id, "MINE", 1);
    await q(other.concept.id, "OTHER-CONCEPT", 2);
    await q(hers.concept.id, "OTHER-USER", 3);
    let recent: string[] = [];
    generation.override = async (_c, _s, r) => {
      recent = r as string[];
      return { text: "Why?", kind: "WHY", sourceKeys: ["s1"] };
    };
    await ask(ada, concept.id);
    expect(recent).toEqual(["MINE"]);
  });

  it("never sends another concept's notes, even from the same document", async () => {
    const { concept, document, course } = await addConcept(ada, 1);
    const other = await db.chunk.create({
      data: {
        documentId: document.id,
        order: 5,
        text: "OTHER-NOTES",
        refLabel: "Other",
      },
    });
    await db.concept.create({
      data: {
        courseId: course.id,
        name: "Other",
        nameKey: "other",
        summary: "x",
        chunks: { create: [{ chunkId: other.id }] },
      },
    });
    let sources: { text: string }[] = [];
    generation.override = async (_c, s) => {
      sources = s as { text: string }[];
      return { text: "Why?", kind: "WHY", sourceKeys: ["s1"] };
    };
    await ask(ada, concept.id);
    expect(sources.map((s) => s.text).join(" ")).not.toContain("OTHER-NOTES");
  });

  it("maps the model's source keys back to this concept's chunks", async () => {
    const { concept, chunks } = await addConcept(ada, 3);
    generation.override = async () => ({
      text: "Compare them.",
      kind: "COMPARE",
      sourceKeys: ["s3"],
    });
    const body = (await (await ask(ada, concept.id)).json()) as {
      sources: { chunkId: string }[];
    };
    expect(body.sources.map((s) => s.chunkId)).toEqual([chunks[2].id]);
  });

  it("drops a source key that isn't one of this concept's chunks", async () => {
    const { concept, chunks } = await addConcept(ada, 2);
    generation.override = async () => ({
      text: "Why?",
      kind: "WHY",
      sourceKeys: ["s1", "s99"],
    });
    const body = (await (await ask(ada, concept.id)).json()) as {
      questionId: string;
      sources: { chunkId: string }[];
    };
    expect(body.sources.map((s) => s.chunkId)).toEqual([chunks[0].id]);
    const saved = await db.question.findUniqueOrThrow({
      where: { id: body.questionId },
    });
    expect(saved.sourceChunkIds).toEqual([chunks[0].id]);
  });

  it("S1: no session → 401, and no question is saved", async () => {
    const { concept } = await addConcept(ada);
    const res = await asAnonymous().call(questionRoute.POST, {
      method: "POST",
      url: `/api/concepts/${concept.id}/question`,
      params: { id: concept.id },
    });
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHENTICATED");
    expect(await db.question.count({ where: { conceptId: concept.id } })).toBe(
      0,
    );
  });

  it("S2: another user's concept → 404, the same as one that doesn't exist, and nothing is saved", async () => {
    const { concept } = await addConcept(grace);
    for (const id of [concept.id, MISSING_ID]) {
      const res = await ask(ada, id);
      expect(res.status).toBe(404);
      await expectError(res, "NOT_FOUND");
    }
    expect(await db.question.count({ where: { conceptId: concept.id } })).toBe(
      0,
    );
  });

  it("S2: a concept with no notes linked → 404, since there's nothing to ask from", async () => {
    const course = await db.course.create({
      data: { userId: ada.id, name: "Empty" },
    });
    const concept = await db.concept.create({
      data: {
        courseId: course.id,
        name: "Bare",
        nameKey: "bare",
        summary: "x",
      },
    });
    const res = await ask(ada, concept.id);
    expect(res.status).toBe(404);
    await expectError(res, "NOT_FOUND");
  });

  it.each([
    [
      "a foreign Origin",
      (u: TestUser) => as(u).fromOrigin("https://evil.example"),
    ],
    ["Sec-Fetch-Site: cross-site", (u: TestUser) => as(u).crossSite()],
  ])("S3: %s → 403, and nothing is saved", async (_name, caller) => {
    const { concept } = await addConcept(ada);
    const res = await caller(ada).call(questionRoute.POST, {
      method: "POST",
      url: `/api/concepts/${concept.id}/question`,
      params: { id: concept.id },
    });
    expect(res.status).toBe(403);
    await expectError(res, "FORBIDDEN_ORIGIN");
    expect(await db.question.count({ where: { conceptId: concept.id } })).toBe(
      0,
    );
  });

  it("S4: a malformed id → 400", async () => {
    const res = await ask(ada, "not-an-id");
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION_ERROR");
  });

  it("S5: a body over 64 KB → 413", async () => {
    const { concept } = await addConcept(ada);
    const res = await as(ada).call(questionRoute.POST, {
      method: "POST",
      url: `/api/concepts/${concept.id}/question`,
      params: { id: concept.id },
      body: { x: "y".repeat(70 * 1024) },
    });
    expect(res.status).toBe(413);
    await expectError(res, "PAYLOAD_TOO_LARGE");
  });

  it("S6: past the AI limit → 429 with Retry-After, per user, and no question is saved", async () => {
    const now = new Date(Date.UTC(2033, 0, 1, 12, 0, 30));
    setRateLimitOverrides({ limits: { aiPerMinute: 1 }, now: () => now });
    const { concept } = await addConcept(ada);
    expect((await ask(ada, concept.id)).status).toBe(200);
    const res = await ask(ada, concept.id);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    await expectError(res, "RATE_LIMITED");
    expect(await db.question.count({ where: { conceptId: concept.id } })).toBe(
      1,
    );
    const hers = await addConcept(grace);
    expect((await ask(grace, hers.concept.id)).status).toBe(200);
  });

  it.each(FAKE_FAILURE_MODES.filter((mode) => mode !== "fabricated_evidence"))(
    "S9: AI failure %s → 502 AI_UNAVAILABLE with a friendly message, and no question saved",
    async (mode) => {
      const { concept } = await addConcept(ada);
      setFakeFailure(mode);
      const res = await ask(ada, concept.id);
      expect(res.status).toBe(502);
      expect(await expectMatchesOpenApi(res, OP)).toEqual({
        error: {
          code: "AI_UNAVAILABLE",
          message: "The AI service is unavailable right now.",
        },
      });
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(
        await db.question.count({ where: { conceptId: concept.id } }),
      ).toBe(0);
    },
  );

  it("S9: a question citing none of the notes is unusable → 502, nothing saved", async () => {
    const { concept } = await addConcept(ada);
    // What the real generateQuestion does when the model keeps citing unknown chunks.
    generation.override = async () => {
      const { AiError } = await import("@/lib/ai/errors");
      throw new AiError("INVALID_OUTPUT");
    };
    const res = await ask(ada, concept.id);
    expect(res.status).toBe(502);
    await expectError(res, "AI_UNAVAILABLE");
    expect(await db.question.count({ where: { conceptId: concept.id } })).toBe(
      0,
    );
  });

  it("an unexpected error is a 500 with a request id, never the error's text", async () => {
    const { concept } = await addConcept(ada);
    generation.override = async () => {
      throw new Error("SECRET-DETAIL from a library");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask(ada, concept.id);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await expectMatchesOpenApi(res, OP))).not.toContain(
      "SECRET",
    );
  });
});
