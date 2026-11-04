// T21 · Map + next-concept endpoints against the real stack (db-test, Better Auth sessions, withApi):
// the security matrix (TESTING §3) for GET /api/courses/{id}/map and GET /api/courses/{id}/next-concept,
// plus the PLAN §9 order. Every response is checked against openapi.yaml (S7).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as mapRoute from "@/app/api/courses/[id]/map/route";
import * as nextRoute from "@/app/api/courses/[id]/next-concept/route";
import { db } from "@/lib/db";
import { as, asAnonymous, createUser, type TestUser } from "../helpers/api";
import { expectMatchesOpenApi } from "../helpers/openapi-assert";

const MAP = "GET /api/courses/{id}/map";
const NEXT = "GET /api/courses/{id}/next-concept";

/** A well-formed id that no row has. */
const MISSING_ID = "cmissing00000000000000000";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

let ada: TestUser;
let grace: TestUser;

beforeAll(async () => {
  ada = await createUser({ name: "Ada" });
  grace = await createUser({ name: "Grace" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Rows the API can't create yet (concepts and edges come from T12, attempts and mastery from T22).
async function addCourse(owner: TestUser, name: string) {
  return db.course.create({ data: { userId: owner.id, name } });
}

async function addConcept(
  courseId: string,
  name: string,
  nameKey = name.toLowerCase(),
) {
  return db.concept.create({
    data: { courseId, name, nameKey, summary: `About ${name}.` },
  });
}

async function setMastery(
  user: TestUser,
  conceptId: string,
  score: number,
  attempts: number,
  lastSeenAt: Date | null = new Date(),
) {
  await db.mastery.create({
    data: { userId: user.id, conceptId, score, attempts, lastSeenAt },
  });
}

async function addEdge(fromId: string, toId: string) {
  await db.conceptEdge.create({ data: { fromId, toId } });
}

/** One answer by `user` to a new question on the concept. */
async function addAttempt(
  user: TestUser,
  conceptId: string,
  fields: {
    createdAt?: Date;
    confidence?: "HIGH" | "MEDIUM" | "LOW";
    id?: string;
  } = {},
) {
  const question = await db.question.create({
    data: {
      conceptId,
      text: "Explain it in your own words.",
      kind: "EXPLAIN",
      sourceChunkIds: [],
    },
  });
  await db.attempt.create({
    data: {
      userId: user.id,
      questionId: question.id,
      answer: "My answer.",
      verdict: "CORRECT",
      confidence: "HIGH",
      feedback: {},
      ...fields,
    },
  });
}

const map = (user: TestUser, id: string) =>
  as(user).call(mapRoute.GET, {
    url: `/api/courses/${id}/map`,
    params: { id },
  });
const next = (user: TestUser, id: string) =>
  as(user).call(nextRoute.GET, {
    url: `/api/courses/${id}/next-concept`,
    params: { id },
  });

/** The next concept's id for `user`, after checking the response against the spec. */
async function nextId(user: TestUser, courseId: string) {
  const res = await next(user, courseId);
  expect(res.status).toBe(200);
  const body = (await expectMatchesOpenApi(res, NEXT)) as {
    conceptId: string;
  } | null;
  return body?.conceptId ?? null;
}

/** S8: no user ids, tokens or session data in a body. */
function expectNothingPrivate(body: unknown) {
  const text = JSON.stringify(body);
  for (const secret of [ada.id, grace.id, "userId"])
    expect(text).not.toContain(secret);
  expect(text).not.toMatch(/token|session|password/i);
}

const ROUTES = [
  [MAP, mapRoute.GET, "map"],
  [NEXT, nextRoute.GET, "next-concept"],
] as const;

describe("S1: both routes need a session", () => {
  it.each(ROUTES)("S1: %s with no session → 401", async (key, GET, path) => {
    const res = await asAnonymous().call(GET, {
      url: `/api/courses/${MISSING_ID}/${path}`,
      params: { id: MISSING_ID },
    });
    expect(res.status).toBe(401);
    expect(await expectMatchesOpenApi(res, key)).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it.each(ROUTES)(
    "S1: %s with a tampered session cookie → 401, even for my own course",
    async (key, GET, path) => {
      const course = await addCourse(ada, "Tampered");
      await addConcept(course.id, "Hidden");
      const tampered = { ...ada, cookie: `${ada.cookie.slice(0, -4)}AAA=` };
      const res = await as(tampered).call(GET, {
        url: `/api/courses/${course.id}/${path}`,
        params: { id: course.id },
      });
      expect(res.status).toBe(401);
      const body = await expectMatchesOpenApi(res, key);
      expect(body).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(JSON.stringify(body)).not.toContain("Hidden");
    },
  );
});

describe("GET /api/courses/{id}/map", () => {
  it("returns my course's concepts as nodes by name, ignoring case, with my mastery, and its edges", async () => {
    const course = await addCourse(ada, "Biology");
    const osmosis = await addConcept(course.id, "Osmosis");
    const cell = await addConcept(course.id, "Cell membrane");
    const mito = await addConcept(course.id, "Mitochondria");
    // Lowercase first letter: a byte-order ("C") collation would put it last.
    const mrna = await addConcept(course.id, "mRNA");
    const golgi = await addConcept(course.id, "Golgi body");
    await setMastery(ada, cell.id, 0.5, 1);
    await setMastery(ada, mito.id, 0.75, 2);
    // A mastered score after one answer is still REVIEW: MASTERED needs two (PLAN §9).
    await setMastery(ada, golgi.id, 0.8, 1);
    await addEdge(osmosis.id, cell.id);
    await addEdge(cell.id, mito.id);
    await addEdge(cell.id, osmosis.id);
    await addEdge(mrna.id, mito.id);

    const res = await map(ada, course.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await expectMatchesOpenApi(res, MAP);
    expect(body).toEqual({
      nodes: [
        { id: cell.id, name: "Cell membrane", state: "REVIEW", score: 0.5 },
        { id: golgi.id, name: "Golgi body", state: "REVIEW", score: 0.8 },
        { id: mito.id, name: "Mitochondria", state: "MASTERED", score: 0.75 },
        { id: mrna.id, name: "mRNA", state: "PRACTICE", score: 0 },
        { id: osmosis.id, name: "Osmosis", state: "PRACTICE", score: 0 },
      ],
      // By `from`, then `to`, compared as plain strings: the same order on every request.
      edges: [
        { from: osmosis.id, to: cell.id },
        { from: cell.id, to: mito.id },
        { from: cell.id, to: osmosis.id },
        { from: mrna.id, to: mito.id },
      ].sort((a, b) =>
        a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
      ),
    });
    expectNothingPrivate(body);
  });

  it("orders nodes by the normalized name key, not by the stored name's collation", async () => {
    const course = await addCourse(ada, "Keys");
    // Created out of order, so insertion order can't produce the expected list either.
    const alpha = await addConcept(course.id, "Alpha", "bbb alpha");
    const zeta = await addConcept(course.id, "Zeta", "aaa zeta");
    const body = (await expectMatchesOpenApi(
      await map(ada, course.id),
      MAP,
    )) as { nodes: { id: string }[] };
    expect(body.nodes.map(({ id }) => id)).toEqual([zeta.id, alpha.id]);
  });

  it("S2: never shows another user's mastery of my concepts", async () => {
    const course = await addCourse(ada, "Physics");
    const force = await addConcept(course.id, "Force");
    await setMastery(grace, force.id, 1, 5);
    const body = await expectMatchesOpenApi(await map(ada, course.id), MAP);
    expect(body).toEqual({
      nodes: [{ id: force.id, name: "Force", state: "PRACTICE", score: 0 }],
      edges: [],
    });
  });

  it("S2/S8: never returns an edge to a concept outside the course, in either direction", async () => {
    const course = await addCourse(ada, "Chemistry");
    const atom = await addConcept(course.id, "Atom");
    const mine = await addCourse(ada, "My other course");
    const elsewhere = await addConcept(mine.id, "Elsewhere");
    const theirs = await addCourse(grace, "Grace's course");
    const secret = await addConcept(theirs.id, "Secret concept");
    // Rows the ingestion pipeline never writes, but a map must not trust that.
    await addEdge(atom.id, secret.id);
    await addEdge(secret.id, atom.id);
    await addEdge(atom.id, elsewhere.id);
    await addEdge(elsewhere.id, atom.id);

    const body = await expectMatchesOpenApi(await map(ada, course.id), MAP);
    expect(body).toEqual({
      nodes: [{ id: atom.id, name: "Atom", state: "PRACTICE", score: 0 }],
      edges: [],
    });
    const text = JSON.stringify(body);
    for (const leaked of [secret.id, elsewhere.id, "Secret", "Elsewhere"])
      expect(text).not.toContain(leaked);
  });

  it("drops an edge from a concept to itself", async () => {
    const course = await addCourse(ada, "Loops");
    const loop = await addConcept(course.id, "Recursion");
    const base = await addConcept(course.id, "Base case");
    await addEdge(loop.id, loop.id);
    await addEdge(base.id, loop.id);
    const body = (await expectMatchesOpenApi(
      await map(ada, course.id),
      MAP,
    )) as { edges: unknown[] };
    expect(body.edges).toEqual([{ from: base.id, to: loop.id }]);
  });

  it("returns an empty map for a course with no concepts yet, even when my other courses have some", async () => {
    const sibling = await addCourse(ada, "Sibling");
    const a = await addConcept(sibling.id, "Sibling A");
    const b = await addConcept(sibling.id, "Sibling B");
    await addEdge(a.id, b.id);
    const course = await addCourse(ada, "New");
    const res = await map(ada, course.id);
    expect(res.status).toBe(200);
    expect(await expectMatchesOpenApi(res, MAP)).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("S2: another user's course → 404, the same answer as a course that doesn't exist", async () => {
    const theirs = await addCourse(grace, "Grace's course");
    const secret = await addConcept(theirs.id, "Secret concept");
    const other = await addConcept(theirs.id, "Other secret");
    await addEdge(secret.id, other.id);
    const res = await map(ada, theirs.id);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await expectMatchesOpenApi(res, MAP);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(body)).not.toMatch(/secret/i);

    const missing = await map(ada, MISSING_ID);
    expect(missing.status).toBe(404);
    expect(await expectMatchesOpenApi(missing, MAP)).toEqual(body);
  });
});

describe("GET /api/courses/{id}/next-concept", () => {
  it("returns null for a course with no concepts yet, even when my other courses have some", async () => {
    const sibling = await addCourse(ada, "Sibling");
    await addConcept(sibling.id, "Sibling concept");
    const course = await addCourse(ada, "Empty");
    const res = await next(ada, course.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.clone().text()).toBe("null");
    expect(await expectMatchesOpenApi(res, NEXT)).toBeNull();
  });

  it("offers PRACTICE before REVIEW before MASTERED, with only its id, name and state", async () => {
    const course = await addCourse(ada, "States");
    const mastered = await addConcept(course.id, "Mastered");
    const review = await addConcept(course.id, "Review");
    const practice = await addConcept(course.id, "Practice");
    // REVIEW scores higher than MASTERED (one attempt isn't enough to master), so a pick by score
    // alone would offer MASTERED before REVIEW. A seen PRACTICE concept is always under 0.4.
    await setMastery(ada, mastered.id, 0.8, 2);
    await setMastery(ada, review.id, 0.9, 1);
    await setMastery(ada, practice.id, 0.3, 1);

    const res = await next(ada, course.id);
    expect(res.status).toBe(200);
    const body = await expectMatchesOpenApi(res, NEXT);
    expect(body).toEqual({
      conceptId: practice.id,
      name: "Practice",
      state: "PRACTICE",
    });
    expectNothingPrivate(body);

    await db.concept.delete({ where: { id: practice.id } });
    expect(
      await expectMatchesOpenApi(await next(ada, course.id), NEXT),
    ).toEqual({ conceptId: review.id, name: "Review", state: "REVIEW" });
    await db.concept.delete({ where: { id: review.id } });
    expect(
      await expectMatchesOpenApi(await next(ada, course.id), NEXT),
    ).toEqual({ conceptId: mastered.id, name: "Mastered", state: "MASTERED" });
  });

  it("offers the lowest score first within a state", async () => {
    const course = await addCourse(ada, "Scores");
    const higher = await addConcept(course.id, "Higher");
    const lower = await addConcept(course.id, "Lower");
    // Seen longer ago, so a pick by lastSeenAt alone would take `higher`.
    await setMastery(ada, higher.id, 0.3, 1, daysAgo(3));
    await setMastery(ada, lower.id, 0.1, 1, daysAgo(1));
    expect(await nextId(ada, course.id)).toBe(lower.id);
  });

  it("at the same score, offers an unseen concept first, then the one seen longest ago", async () => {
    const course = await addCourse(ada, "Recency");
    const recent = await addConcept(course.id, "Recent");
    const older = await addConcept(course.id, "Older");
    await setMastery(ada, recent.id, 0, 1, daysAgo(1));
    await setMastery(ada, older.id, 0, 1, daysAgo(2));
    expect(await nextId(ada, course.id)).toBe(older.id);

    const unseen = await addConcept(course.id, "Unseen");
    expect(await nextId(ada, course.id)).toBe(unseen.id);
  });

  it("skips the concept of my latest answer in this course", async () => {
    const course = await addCourse(ada, "Skip");
    const weak = await addConcept(course.id, "Weak");
    const strong = await addConcept(course.id, "Strong");
    await setMastery(ada, weak.id, 0, 1);
    await setMastery(ada, strong.id, 0.5, 1);
    await addAttempt(ada, strong.id, { createdAt: daysAgo(2) });
    // Without the skip, `weak` would be next; my latest answer was on `weak`.
    await addAttempt(ada, weak.id, { createdAt: daysAgo(1) });
    expect(await nextId(ada, course.id)).toBe(strong.id);

    // A newer answer on `strong` makes it the one to skip instead.
    await addAttempt(ada, strong.id);
    expect(await nextId(ada, course.id)).toBe(weak.id);
  });

  it("offers the concept of my latest answer when it's the only one", async () => {
    const course = await addCourse(ada, "Only");
    const only = await addConcept(course.id, "Only concept");
    await setMastery(ada, only.id, 0.5, 1);
    await addAttempt(ada, only.id);
    // With nothing else to offer, the latest answer can't matter, so it isn't even looked up.
    const lookup = vi.spyOn(db.attempt, "findFirst");
    expect(await nextId(ada, course.id)).toBe(only.id);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("counts a LOW-confidence answer as my latest answer, though it didn't change my mastery", async () => {
    const course = await addCourse(ada, "Low");
    const weak = await addConcept(course.id, "Weak");
    const strong = await addConcept(course.id, "Strong");
    await setMastery(ada, weak.id, 0, 1, daysAgo(5));
    await setMastery(ada, strong.id, 0.5, 1, daysAgo(5));
    await addAttempt(ada, strong.id, { createdAt: daysAgo(2) });
    await addAttempt(ada, weak.id, { confidence: "LOW" });
    expect(await nextId(ada, course.id)).toBe(strong.id);
  });

  // Both insertion orders: without the id tie-break, the database may return tied rows in
  // insertion order or the reverse, so one of the two runs fails either way.
  it.each(["first", "second"] as const)(
    "breaks a tie between answers saved at the same moment by the higher id (inserted %s)",
    async (order) => {
      const course = await addCourse(ada, `Ties ${order}`);
      const weak = await addConcept(course.id, "Weak");
      const strong = await addConcept(course.id, "Strong");
      await setMastery(ada, weak.id, 0, 1);
      await setMastery(ada, strong.id, 0.5, 1);
      const at = daysAgo(1);
      const tag = order === "first" ? "a" : "b";
      const lower = () =>
        addAttempt(ada, strong.id, {
          createdAt: at,
          id: `cattempt${tag}${"0".repeat(14)}1`,
        });
      const higher = () =>
        addAttempt(ada, weak.id, {
          createdAt: at,
          id: `cattempt${tag}${"0".repeat(14)}2`,
        });
      if (order === "first") {
        await higher();
        await lower();
      } else {
        await lower();
        await higher();
      }
      // The higher id is on `weak`, so `weak` counts as my latest answer and is skipped.
      expect(await nextId(ada, course.id)).toBe(strong.id);
    },
  );

  it("ignores my answers in my other courses", async () => {
    const course = await addCourse(ada, "This course");
    const weak = await addConcept(course.id, "Weak");
    const strong = await addConcept(course.id, "Strong");
    await setMastery(ada, weak.id, 0, 1);
    await setMastery(ada, strong.id, 0.5, 1);
    await addAttempt(ada, weak.id, { createdAt: daysAgo(2) });
    const other = await addCourse(ada, "Other course");
    const elsewhere = await addConcept(other.id, "Elsewhere");
    // My latest answer overall is in the other course; this course's latest is still `weak`.
    await addAttempt(ada, elsewhere.id, { createdAt: daysAgo(1) });
    expect(await nextId(ada, course.id)).toBe(strong.id);
  });

  it("S2: another user's answers in my course never change what I'm offered", async () => {
    const course = await addCourse(ada, "Shared?");
    const weak = await addConcept(course.id, "Weak");
    const strong = await addConcept(course.id, "Strong");
    await setMastery(ada, weak.id, 0, 1);
    await setMastery(ada, strong.id, 0.5, 1);
    await addAttempt(ada, strong.id, { createdAt: daysAgo(2) });
    // A row no route can write: Grace's answer on my concept, newer than mine.
    await addAttempt(grace, weak.id, { createdAt: daysAgo(1) });
    expect(await nextId(ada, course.id)).toBe(weak.id);
  });

  it("S2: another user's mastery of my concepts never changes the order", async () => {
    const course = await addCourse(ada, "Their mastery");
    const first = await addConcept(course.id, "First");
    const second = await addConcept(course.id, "Second");
    // I haven't seen `first`; Grace's row is the only one for it, so read as mine it would make
    // `first` MASTERED and `second` the pick.
    await setMastery(grace, first.id, 1, 5);
    await setMastery(ada, second.id, 0.3, 1);
    expect(
      await expectMatchesOpenApi(await next(ada, course.id), NEXT),
    ).toEqual({ conceptId: first.id, name: "First", state: "PRACTICE" });
  });

  it("S2: another user's course → 404, the same answer as a course that doesn't exist", async () => {
    const theirs = await addCourse(grace, "Grace's course");
    await addConcept(theirs.id, "Secret concept");
    const res = await next(ada, theirs.id);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await expectMatchesOpenApi(res, NEXT);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(body)).not.toMatch(/secret/i);

    const missing = await next(ada, MISSING_ID);
    expect(missing.status).toBe(404);
    expect(await expectMatchesOpenApi(missing, NEXT)).toEqual(body);
  });
});

describe("both routes", () => {
  it.each(
    ROUTES.flatMap(([key, GET, path]) =>
      [
        "../courses",
        "not-an-id",
        "c123",
        "CCOURSE000000000000000001",
        `${MISSING_ID}x`,
      ].map((id) => [key, id, GET, path] as const),
    ),
  )(
    "S4: %s with a malformed id (%s) → 400 VALIDATION_ERROR",
    async (key, id, GET, path) => {
      const res = await as(ada).call(GET, {
        url: `/api/courses/${encodeURIComponent(id)}/${path}`,
        params: { id },
      });
      expect(res.status).toBe(400);
      expect(await expectMatchesOpenApi(res, key)).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { fieldErrors: { id: [expect.any(String)] } },
        },
      });
    },
  );

  it.each([
    [MAP, "course", "findFirst", (id: string) => map(ada, id)],
    [NEXT, "course", "findFirst", (id: string) => next(ada, id)],
    [NEXT, "attempt", "findFirst", (id: string) => next(ada, id)],
  ] as const)(
    "%s: a database error (%s.%s) → 500 INTERNAL, generic, with a request id",
    async (key, model, method, call) => {
      // Two concepts, so next-concept also looks up my latest answer.
      const course = await addCourse(ada, "Broken");
      await addConcept(course.id, "One");
      await addConcept(course.id, "Two");
      vi.spyOn(db[model], method).mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5434 password=hunter2"),
      );
      const res = await call(course.id);
      expect(res.status).toBe(500);
      const body = await expectMatchesOpenApi(res, key);
      expect(body).toMatchObject({ error: { code: "INTERNAL" } });
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|hunter2|5434/);
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    },
  );
});
