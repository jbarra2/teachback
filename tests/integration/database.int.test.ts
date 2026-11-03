import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ID_PATTERN, LIMITS } from "@/lib/schemas";
import { createUser } from "../helpers/api";

// The database the migrations build (T02's live checks, committed in T07). tests/tooling checks the
// schema's SQL text; these read what PostgreSQL actually has after `migrate deploy`, which also
// catches a later migration that alters or drops something.

async function newCourse(name = "Biology") {
  const user = await createUser();
  return db.course.create({ data: { userId: user.id, name } });
}

/** One row of every model under a user: course, document, chunk, two concepts and so on. */
async function buildTree(userId: string) {
  const course = await db.course.create({ data: { userId, name: "Bio" } });
  const document = await db.document.create({
    data: {
      courseId: course.id,
      title: "Week 1",
      sourceType: "TEXT",
      rawText: "Cells.",
    },
  });
  const chunk = await db.chunk.create({
    data: {
      documentId: document.id,
      order: 0,
      text: "Cells.",
      refLabel: "Week 1",
    },
  });
  const [a, b] = await Promise.all(
    ["a", "b"].map((key) =>
      db.concept.create({
        data: { courseId: course.id, name: key, nameKey: key, summary: key },
      }),
    ),
  );
  await db.conceptChunk.create({
    data: { conceptId: a.id, chunkId: chunk.id },
  });
  const edge = await db.conceptEdge.create({
    data: { fromId: a.id, toId: b.id },
  });
  const question = await db.question.create({
    data: {
      conceptId: a.id,
      text: "Why?",
      kind: "WHY",
      sourceChunkIds: [chunk.id],
    },
  });
  const attempt = await db.attempt.create({
    data: {
      userId,
      questionId: question.id,
      answer: "Because.",
      verdict: "PARTIAL",
      confidence: "HIGH",
      feedback: {},
    },
  });
  await db.mastery.create({ data: { userId, conceptId: a.id } });
  return { course, document, chunk, a, b, edge, question, attempt };
}

/** How many rows each model holds under a user and their tree. */
async function countTree(
  userId: string,
  tree: Awaited<ReturnType<typeof buildTree>>,
) {
  return {
    session: await db.session.count({ where: { userId } }),
    account: await db.account.count({ where: { userId } }),
    course: await db.course.count({ where: { userId } }),
    document: await db.document.count({ where: { courseId: tree.course.id } }),
    chunk: await db.chunk.count({ where: { documentId: tree.document.id } }),
    concept: await db.concept.count({ where: { courseId: tree.course.id } }),
    conceptChunk: await db.conceptChunk.count({
      where: { chunkId: tree.chunk.id },
    }),
    conceptEdge: await db.conceptEdge.count({ where: { fromId: tree.a.id } }),
    question: await db.question.count({ where: { conceptId: tree.a.id } }),
    attempt: await db.attempt.count({ where: { userId } }),
    mastery: await db.mastery.count({ where: { userId } }),
  };
}

describe("the migrated database: what PostgreSQL has", () => {
  it("caps text columns at the PLAN §7 limits", async () => {
    const rows = await db.$queryRaw<
      { table_name: string; column_name: string; max: number }[]
    >`
      SELECT table_name, column_name, character_maximum_length AS max
      FROM information_schema.columns
      WHERE table_schema = 'public' AND character_maximum_length IS NOT NULL
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name, column_name`;
    expect(rows.map((r) => [r.table_name, r.column_name, r.max])).toEqual([
      ["Attempt", "answer", LIMITS.answer],
      ["Course", "name", LIMITS.courseName],
      ["Document", "title", LIMITS.documentTitle],
    ]);
  });

  it("has the schema's 15 foreign keys, each to the right table, and every one cascades", async () => {
    const keys = await db.$queryRaw<{ key: string; on_delete: string }[]>`
      SELECT f.relname || '.' || a.attname || ' -> ' || t.relname AS key,
             c.confdeltype::text AS on_delete
      FROM pg_constraint c
      JOIN pg_class f ON f.oid = c.conrelid
      JOIN pg_class t ON t.oid = c.confrelid
      CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
      ORDER BY key`;
    // Each @relation in prisma/schema.prisma, one column each.
    expect(keys.map((k) => k.key)).toEqual(
      [
        "Attempt.questionId -> Question",
        "Attempt.userId -> user",
        "Chunk.documentId -> Document",
        "Concept.courseId -> Course",
        "ConceptChunk.chunkId -> Chunk",
        "ConceptChunk.conceptId -> Concept",
        "ConceptEdge.fromId -> Concept",
        "ConceptEdge.toId -> Concept",
        "Course.userId -> user",
        "Document.courseId -> Course",
        "Mastery.conceptId -> Concept",
        "Mastery.userId -> user",
        "Question.conceptId -> Concept",
        "account.userId -> user",
        "session.userId -> user",
      ].sort(),
    );
    expect(keys.filter((k) => k.on_delete !== "c")).toEqual([]);
  });

  it.each([
    ["user", ["email"]],
    ["session", ["token"]],
    ["rateLimit", ["key"]],
    ["Concept", ["courseId", "nameKey"]],
    ["Chunk", ["documentId", "order"]],
    ["ConceptEdge", ["fromId", "toId"]],
  ])("has a unique index on %s (%s)", async (table, columns) => {
    const indexes = await db.$queryRaw<{ columns: string[] }[]>`
      SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = ${table} AND i.indisunique AND NOT i.indisprimary
      GROUP BY i.indexrelid`;
    expect(indexes.map((i) => i.columns)).toContainEqual(columns);
  });
});

describe("the migrated database: behaviour", () => {
  it("gives every cuid-id model's new rows ids that match the API's id pattern", async () => {
    const user = await createUser();
    const tree = await buildTree(user.id);
    const ids = {
      Course: tree.course.id,
      Document: tree.document.id,
      Chunk: tree.chunk.id,
      Concept: tree.a.id,
      ConceptEdge: tree.edge.id,
      Question: tree.question.id,
      Attempt: tree.attempt.id,
    };
    for (const [model, id] of Object.entries(ids))
      expect(id, model).toMatch(ID_PATTERN);
    // Every model the schema gives a cuid id is in the list above.
    const schema = readFileSync(
      path.resolve(import.meta.dirname, "../../prisma/schema.prisma"),
      "utf8",
    );
    const cuidModels = [
      ...schema.matchAll(/^model (\w+) \{[^}]*@default\(cuid\(\)\)/gm),
    ].map((m) => m[1]);
    expect(cuidModels.sort()).toEqual(Object.keys(ids).sort());
  });

  it("counts the course name cap in characters, as the API does", async () => {
    const user = await createUser();
    const emoji = "😀".repeat(LIMITS.courseName);
    await expect(
      db.course.create({ data: { userId: user.id, name: emoji } }),
    ).resolves.toMatchObject({ name: emoji });
    await expect(
      db.course.create({
        data: { userId: user.id, name: "a".repeat(LIMITS.courseName + 1) },
      }),
    ).rejects.toThrow();
  });

  it("refuses a second concept with the same name key in a course", async () => {
    const course = await newCourse();
    const concept = {
      courseId: course.id,
      name: "Osmosis",
      nameKey: "osmosis",
      summary: "s",
    };
    await db.concept.create({ data: concept });
    const duplicate = db.concept.create({
      data: { ...concept, name: "OSMOSIS" },
    });
    await expect(duplicate).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    await expect(duplicate).rejects.toMatchObject({ code: "P2002" });
  });

  it("signs up with a hashed password and signs in with a stored session", async () => {
    const email = "hash-check@example.test";
    const password = "correct-horse-battery";
    await auth.api.signUpEmail({ body: { name: "Hash", email, password } });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const account = await db.account.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(account.providerId).toBe("credential");
    expect(account.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(account.password).not.toContain(password);
    await auth.api.signInEmail({ body: { email, password } });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  // TESTING §6, no partial writes: if the account insert fails, the user insert is rolled back,
  // so the address isn't left stuck without a password.
  it("rolls back the user when its account can't be written", async () => {
    const email = "atomic@example.test";
    // Sign-up writes the user, then links the account, in one transaction. The user insert is
    // real; the account write fails. No DDL, so nothing outlives the test if a run is killed.
    const { internalAdapter } = await auth.$context;
    const createUser = vi.spyOn(internalAdapter, "createUser");
    vi.spyOn(internalAdapter, "linkAccount").mockRejectedValueOnce(
      new Error("t07: the account write failed"),
    );
    let failure: unknown;
    try {
      await auth.api.signUpEmail({
        body: { name: "Atomic", email, password: "correct-horse" },
      });
    } catch (error) {
      failure = error;
    } finally {
      vi.restoreAllMocks();
    }
    // The user row was written, then the account write failed and took it back with it.
    const written = await createUser.mock.results[0]?.value;
    expect(written).toMatchObject({ email });
    expect(String(failure)).toMatch(/the account write failed/);
    expect(await db.user.count({ where: { id: written.id } })).toBe(0);
    expect(await db.user.count({ where: { email } })).toBe(0);
    // And the address still works once the account can be written.
    await auth.api.signUpEmail({
      body: { name: "Atomic", email, password: "correct-horse" },
    });
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("deletes everything under a user with the user, and leaves another user's rows and rate-limit rows", async () => {
    const owner = await createUser();
    const other = await createUser();
    const tree = await buildTree(owner.id);
    const otherTree = await buildTree(other.id);
    await db.apiRateLimit.create({
      data: { key: `user:${owner.id}`, windowStart: new Date() },
    });
    const before = await countTree(owner.id, tree);
    // One session (createUser signs in), one account, two concepts, one of everything else.
    expect(before).toEqual({
      session: 1,
      account: 1,
      course: 1,
      document: 1,
      chunk: 1,
      concept: 2,
      conceptChunk: 1,
      conceptEdge: 1,
      question: 1,
      attempt: 1,
      mastery: 1,
    });

    await db.user.delete({ where: { id: owner.id } });

    const left = await countTree(owner.id, tree);
    expect(Object.entries(left).filter(([, n]) => n !== 0)).toEqual([]);
    // The other user's tree is untouched, and rate-limit rows have no foreign key (T14 prunes them).
    expect(await countTree(other.id, otherTree)).toEqual(before);
    expect(
      await db.apiRateLimit.count({ where: { key: `user:${owner.id}` } }),
    ).toBe(1);
  });
});
