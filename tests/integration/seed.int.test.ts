// T08 · The demo seed (prisma/seed.ts) against db-test: what each demo user gets, that re-runs and
// retries are safe, that existing accounts and progress are never changed, and that it refuses to
// run in production. (A one-file exception to the lead's tests/integration/, approved on #8.)
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { conceptNameKey } from "@/lib/ai/extract-concepts";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chunk } from "@/lib/ingest/chunk";
import {
  DEMO_COURSES,
  DEMO_USERS,
  type DemoCourse,
  type DemoUserKey,
  formatOutcome,
  seedDemoData,
  type SeedOutcome,
} from "../../prisma/seed";
import { createUser } from "../helpers/api";
import { resetDatabase } from "../helpers/reset-db";

/** The API's Id pattern (src/lib/schemas/common.ts): routes answer 400 to anything else. */
const ID = /^c[a-z0-9]{24}$/;

// Tables are emptied per file by the integration setup; these tests each need a fresh start.
beforeEach(async () => {
  await resetDatabase();
});

const userId = async (key: DemoUserKey) =>
  (
    await db.user.findUniqueOrThrow({
      where: { email: DEMO_USERS[key].email },
      select: { id: true },
    })
  ).id;

/** Everything of one user's, with the ids it points at. */
async function snapshot(key: DemoUserKey) {
  const id = await userId(key);
  return db.course.findMany({
    where: { userId: id },
    orderBy: { name: "asc" },
    include: {
      documents: { include: { chunks: { orderBy: { order: "asc" } } } },
      concepts: {
        orderBy: { name: "asc" },
        include: { chunks: true, outEdges: true, questions: true },
      },
    },
  });
}

/** Row counts for every model the seed writes. */
const counts = async () => ({
  users: await db.user.count(),
  accounts: await db.account.count(),
  courses: await db.course.count(),
  documents: await db.document.count(),
  chunks: await db.chunk.count(),
  concepts: await db.concept.count(),
  links: await db.conceptChunk.count(),
  edges: await db.conceptEdge.count(),
  questions: await db.question.count(),
});

const seeded = (status: "created" | "already-seeded") =>
  (Object.keys(DEMO_USERS) as DemoUserKey[]).map((user) => ({
    user,
    email: DEMO_USERS[user].email,
    status,
  }));

describe("seedDemoData: what each demo user gets", () => {
  it("gives demo user A one course, a READY document of about 10 chunks, 5 linked concepts with edges, and 2 questions", async () => {
    expect(await seedDemoData()).toEqual(seeded("created"));

    const [course, ...others] = await snapshot("a");
    expect(others).toEqual([]);
    expect(course.name).toBe(DEMO_COURSES.a.name);
    expect(course.documents).toHaveLength(1);
    const [document] = course.documents;
    expect(document).toMatchObject({ status: "READY", error: null });

    // The real chunker's output, in order.
    const text = readFileSync(
      path.resolve("fixtures/seed", DEMO_COURSES.a.document.file),
      "utf8",
    );
    expect(document.rawText).toBe(text);
    expect(
      document.chunks.map(({ order, text, refLabel }) => ({
        order,
        text,
        refLabel,
      })),
    ).toEqual(chunk(text, DEMO_COURSES.a.document.title));
    expect(document.chunks.length).toBeGreaterThanOrEqual(8);
    expect(document.chunks.length).toBeLessThanOrEqual(12);

    const chunkIds = new Set(document.chunks.map((c) => c.id));
    expect(course.concepts).toHaveLength(5);
    for (const concept of course.concepts) {
      // The key uploads merge on (T12), so notes uploaded later join these concepts.
      expect(concept.nameKey).toBe(conceptNameKey(concept.name));
      expect(concept.chunks.length).toBeGreaterThan(0);
      for (const link of concept.chunks)
        expect(chunkIds).toContain(link.chunkId);
    }

    const conceptIds = new Set(course.concepts.map((c) => c.id));
    const edges = course.concepts.flatMap((c) => c.outEdges);
    expect(edges).toHaveLength(DEMO_COURSES.a.edges.length);
    for (const edge of edges) expect(conceptIds).toContain(edge.toId);

    const questions = course.concepts.flatMap((c) =>
      c.questions.map((q) => ({ q, linked: c.chunks.map((l) => l.chunkId) })),
    );
    expect(questions).toHaveLength(2);
    for (const { q, linked } of questions) {
      expect(q.sourceChunkIds.length).toBeGreaterThan(0);
      // Sources are chunks of the question's own concept, as generateQuestion requires.
      for (const id of q.sourceChunkIds) expect(linked).toContain(id);
    }

    // Every id a route could be asked for has the API's Id format.
    const ids = [
      course.id,
      document.id,
      ...chunkIds,
      ...conceptIds,
      ...edges.map((e) => e.id),
      ...questions.map(({ q }) => q.id),
    ];
    for (const id of ids) expect(id).toMatch(ID);
  });

  it("gives demo user B a small course of their own that shares nothing with A's", async () => {
    await seedDemoData();
    const a = await snapshot("a");
    const [course, ...others] = await snapshot("b");
    expect(others).toEqual([]);
    expect(course.name).toBe(DEMO_COURSES.b.name);
    expect(course.documents).toHaveLength(1);
    expect(course.concepts.length).toBeGreaterThan(0);

    const own = new Set(
      course.documents.flatMap((d) => d.chunks.map((c) => c.id)),
    );
    const aChunks = new Set(
      a.flatMap((c) => c.documents.flatMap((d) => d.chunks.map((x) => x.id))),
    );
    for (const concept of course.concepts) {
      for (const link of concept.chunks) expect(own).toContain(link.chunkId);
      for (const q of concept.questions)
        for (const id of q.sourceChunkIds) {
          expect(own).toContain(id);
          expect(aChunks).not.toContain(id);
        }
    }
    expect(course.concepts.flatMap((c) => c.questions)).toHaveLength(1);
  });

  it("keeps every seeded note fictional: no real course codes or institutions", () => {
    for (const course of Object.values(DEMO_COURSES)) {
      const text = readFileSync(
        path.resolve("fixtures/seed", course.document.file),
        "utf8",
      );
      expect(text).toContain("fictional course");
      expect(text).not.toMatch(/\b[A-Z]{2,4} ?\d{3}\b|universit|college/i);
    }
  });
});

describe("seedDemoData: demo accounts", () => {
  it("creates accounts that sign in with the README's credentials", async () => {
    await seedDemoData();
    const readme = readFileSync(path.resolve("README.md"), "utf8");
    for (const { email, password } of Object.values(DEMO_USERS)) {
      expect(readme).toContain(email);
      expect(readme).toContain(password);
      const { user } = await auth.api.signInEmail({
        body: { email, password },
      });
      expect(user.email).toBe(email);
    }
  });

  it("finishes the data of an account that a failed run created", async () => {
    // As if a run died right after sign-up: the account exists, the course doesn't.
    const a = await createUser(DEMO_USERS.a);
    expect(await seedDemoData()).toEqual(seeded("created"));
    expect(await userId("a")).toBe(a.id);
    expect(await snapshot("a")).toHaveLength(1);
  });

  it("leaves an existing account with a different password untouched, and still seeds the other user", async () => {
    const owner = await createUser({
      ...DEMO_USERS.a,
      password: "someone-elses-password",
    });
    const before = await db.account.findFirstOrThrow({
      where: { userId: owner.id },
    });

    expect(await seedDemoData()).toEqual([
      {
        user: "a",
        email: DEMO_USERS.a.email,
        status: "conflict",
        reason: "the account already exists with a different password",
      },
      { user: "b", email: DEMO_USERS.b.email, status: "created" },
    ]);
    expect(
      await db.account.findFirstOrThrow({ where: { userId: owner.id } }),
    ).toEqual(before);
    expect(await db.course.count({ where: { userId: owner.id } })).toBe(0);
    expect(await snapshot("b")).toHaveLength(1);
  });

  it("leaves an existing account with no password untouched", async () => {
    const { id } = await db.user.create({
      data: { id: "existing-user", name: "Someone", email: DEMO_USERS.b.email },
    });
    expect((await seedDemoData())[1]).toEqual({
      user: "b",
      email: DEMO_USERS.b.email,
      status: "conflict",
      reason: "the account already exists without a password",
    });
    expect(await db.account.count({ where: { userId: id } })).toBe(0);
    expect(await db.course.count({ where: { userId: id } })).toBe(0);
  });
});

describe("seedDemoData: re-runs and retries", () => {
  it("is idempotent: a second run creates nothing and changes nothing", async () => {
    await seedDemoData();
    const before = {
      counts: await counts(),
      a: await snapshot("a"),
      b: await snapshot("b"),
    };
    expect(await seedDemoData()).toEqual(seeded("already-seeded"));
    expect({
      counts: await counts(),
      a: await snapshot("a"),
      b: await snapshot("b"),
    }).toEqual(before);
  });

  it("never resets progress: attempts, mastery and the user's own courses survive a re-run", async () => {
    await seedDemoData();
    const id = await userId("a");
    const question = await db.question.findFirstOrThrow({
      where: { concept: { course: { userId: id } } },
    });
    await db.attempt.create({
      data: {
        userId: id,
        questionId: question.id,
        answer: "It splits the array, sorts each half and merges them.",
        verdict: "PARTIAL",
        confidence: "HIGH",
        feedback: {},
      },
    });
    await db.mastery.create({
      data: {
        userId: id,
        conceptId: question.conceptId,
        score: 0.5,
        attempts: 1,
      },
    });
    await db.course.create({ data: { userId: id, name: "My own course" } });
    const before = {
      attempts: await db.attempt.findMany(),
      mastery: await db.mastery.findMany(),
      courses: await snapshot("a"),
    };

    await seedDemoData();
    expect({
      attempts: await db.attempt.findMany(),
      mastery: await db.mastery.findMany(),
      courses: await snapshot("a"),
    }).toEqual(before);
  });

  it("rolls a failed course back completely, and a retry then succeeds", async () => {
    // Two concepts with the same name break @@unique([courseId, nameKey]) halfway through.
    const broken: DemoCourse = {
      ...DEMO_COURSES.a,
      concepts: [DEMO_COURSES.a.concepts[0], DEMO_COURSES.a.concepts[0]],
      edges: [],
      questions: [],
    };
    const [a, b] = await seedDemoData({ courses: { a: broken } });
    expect(a).toMatchObject({ user: "a", status: "failed" });
    // Our own message, never the database's (which can quote values).
    expect(a).toHaveProperty(
      "reason",
      "the database or Better Auth returned an error",
    );
    expect(b).toMatchObject({ user: "b", status: "created" });
    const id = await userId("a");
    expect(await db.course.count({ where: { userId: id } })).toBe(0);
    expect(await db.document.count({ where: { course: { userId: id } } })).toBe(
      0,
    );

    expect(await seedDemoData()).toEqual([
      { user: "a", email: DEMO_USERS.a.email, status: "created" },
      { user: "b", email: DEMO_USERS.b.email, status: "already-seeded" },
    ]);
    expect(await snapshot("a")).toHaveLength(1);
  });

  it("refuses a concept that matches no section, without writing its course", async () => {
    const unmatched: DemoCourse = {
      ...DEMO_COURSES.b,
      concepts: [
        { name: "Tries", summary: "Prefix trees.", sections: ["Tries"] },
      ],
      questions: [],
    };
    const [, b] = await seedDemoData({ courses: { b: unmatched } });
    expect(b).toEqual({
      user: "b",
      email: DEMO_USERS.b.email,
      status: "failed",
      reason: 'No chunk matches the sections of "Tries".',
    });
    expect(
      await db.course.count({ where: { userId: await userId("b") } }),
    ).toBe(0);
  });

  it("serializes two runs at once, so neither creates a duplicate course", async () => {
    await Promise.all([seedDemoData(), seedDemoData()]);
    expect(await db.course.count()).toBe(2);
    expect(await db.user.count()).toBe(2);
  });
});

describe("formatOutcome", () => {
  const email = DEMO_USERS.a.email;

  it("tells you to delete the account only when an existing account blocks the seed", () => {
    const conflict = formatOutcome({
      user: "a",
      email,
      status: "conflict",
      reason: "the account already exists with a different password",
    });
    expect(conflict).toContain("Delete that account yourself");
    const failed = formatOutcome({
      user: "a",
      email,
      status: "failed",
      reason: "the database or Better Auth returned an error",
    });
    expect(failed).not.toContain("Delete");
    expect(failed).toContain("safe to run the seed again");
  });

  it("says sign-in was verified for a seeded account, and never prints a password", () => {
    for (const status of ["created", "already-seeded"] as const)
      expect(formatOutcome({ user: "a", email, status })).toMatch(
        /sign-in verified/,
      );
    const outcomes: SeedOutcome[] = [
      { user: "a", email, status: "created" },
      { user: "a", email, status: "already-seeded" },
      { user: "a", email, status: "conflict", reason: "a reason" },
      { user: "a", email, status: "failed", reason: "a reason" },
    ];
    for (const line of outcomes.map(formatOutcome)) {
      expect(line).toContain(email);
      expect(line).not.toContain(DEMO_USERS.a.password);
    }
  });
});

describe("seedDemoData: production", () => {
  it("refuses to run when NODE_ENV is production, before writing anything", async () => {
    await expect(
      seedDemoData({ env: { NODE_ENV: "production" } }),
    ).rejects.toThrow(/Refusing to seed: NODE_ENV is production/);
    expect(await counts()).toEqual({
      users: 0,
      accounts: 0,
      courses: 0,
      documents: 0,
      chunks: 0,
      concepts: 0,
      links: 0,
      edges: 0,
      questions: 0,
    });
  });
});
