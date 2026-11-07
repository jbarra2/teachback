// Demo data for development (`npm run db:seed`, T08): two demo users from the README, each with a
// course of fictional notes. Demo user A gets a READY document chunked by the real chunker, five
// concepts linked to its chunks, prerequisite edges and two questions. Demo user B gets a small
// course of their own, for cross-user checks (docs/TESTING.md §7).
//
// Safe to re-run, and to retry after a failure:
//   - Accounts are created through Better Auth's server API, so passwords are hashed as in sign-up.
//     An existing account is used only if the demo password verifies against its stored hash. The
//     seed never changes a password and never writes into an account it can't sign in to.
//   - A user's course is written in one transaction, so a failed run leaves nothing half-made.
//     A user who already has the demo course is skipped: attempts and mastery are never reset.
//   - Nothing is deleted. Every id comes from the schema's cuid() default (the API's Id pattern).
//
// Refuses to run when NODE_ENV=production, before the database or auth modules are loaded.
import { readFileSync } from "node:fs";
import path from "node:path";

import type { QuestionKind, SourceType } from "@/generated/prisma/client";
import { conceptNameKey } from "@/lib/ai/extract-concepts";
import { chunk } from "@/lib/ingest/chunk";

/** The demo accounts, as listed in the README. Fictional, and only for local databases. */
export const DEMO_USERS = {
  a: {
    name: "Demo Student A",
    email: "demo-a@teachback.test",
    password: "demo-password-a",
  },
  b: {
    name: "Demo Student B",
    email: "demo-b@teachback.test",
    password: "demo-password-b",
  },
} as const;
export type DemoUserKey = keyof typeof DEMO_USERS;

export interface DemoCourse {
  name: string;
  document: {
    title: string;
    sourceType: SourceType;
    /** A file in fixtures/seed/. */
    file: string;
  };
  /** `sections` are the headings whose chunks the concept is linked to. */
  concepts: { name: string; summary: string; sections: string[] }[];
  /** Edges by concept name: understanding `from` helps with `to`, as extractConcepts (T12) means them. */
  edges: { from: string; to: string }[];
  /** Each question's sources are the chunks of its concept. */
  questions: { concept: string; kind: QuestionKind; text: string }[];
}

export const DEMO_COURSES: Record<DemoUserKey, DemoCourse> = {
  a: {
    name: "Algorithms and Data Structures (demo)",
    document: {
      title: "Sorting algorithms",
      sourceType: "MARKDOWN",
      file: "sorting-notes.md",
    },
    concepts: [
      {
        name: "Big-O notation",
        summary:
          "Describes how an algorithm's work grows with the input size, ignoring constant factors.",
        sections: [
          "Measuring cost with Big-O notation",
          "Comparing the four sorts",
        ],
      },
      {
        name: "Insertion sort",
        summary:
          "Builds a sorted prefix by sliding each new item left into place: O(n²) worst case, O(n) on sorted input.",
        sections: ["Insertion sort", "Comparing the four sorts"],
      },
      {
        name: "Divide and conquer",
        summary:
          "Splits a problem into smaller subproblems, solves them recursively and combines the results.",
        sections: ["Divide and conquer", "Merge sort"],
      },
      {
        name: "Merge sort",
        summary:
          "Sorts each half recursively and merges them: O(n log n) on every input, stable, O(n) extra memory.",
        sections: ["Merge sort", "Comparing the four sorts"],
      },
      {
        name: "Quicksort",
        summary:
          "Partitions around a pivot, then sorts each side: O(n log n) on average, O(n²) with poor pivots.",
        sections: ["Quicksort", "Choosing a pivot well"],
      },
    ],
    edges: [
      { from: "Big-O notation", to: "Insertion sort" },
      { from: "Big-O notation", to: "Merge sort" },
      { from: "Divide and conquer", to: "Merge sort" },
      { from: "Divide and conquer", to: "Quicksort" },
    ],
    questions: [
      {
        concept: "Merge sort",
        kind: "EXPLAIN",
        text: "Explain how merge sort sorts an array, and why its running time doesn't depend on the order of the input.",
      },
      {
        concept: "Quicksort",
        kind: "WHY",
        text: "Why can quicksort take quadratic time with a poor pivot, and how does choosing a random pivot help?",
      },
    ],
  },
  b: {
    name: "Data Structures Basics (demo)",
    document: {
      title: "Hash tables",
      sourceType: "MARKDOWN",
      file: "hash-tables-notes.md",
    },
    concepts: [
      {
        name: "Hash table",
        summary:
          "Stores key-value pairs in buckets chosen by a hash function, for constant-time lookups on average.",
        sections: ["Week 2: Hash Tables"],
      },
    ],
    edges: [],
    questions: [
      {
        concept: "Hash table",
        kind: "EXPLAIN",
        text: "Explain what a collision is in a hash table and one way to handle it.",
      },
    ],
  },
};

const FIXTURES = path.join(process.cwd(), "fixtures/seed");

/**
 * Per demo user: seeded now, already seeded, an existing account the seed won't touch
 * (`conflict`), or an error that rolled back (`failed`, safe to retry).
 */
export type SeedOutcome =
  | { user: DemoUserKey; email: string; status: "created" | "already-seeded" }
  | {
      user: DemoUserKey;
      email: string;
      status: "conflict" | "failed";
      reason: string;
    };

export interface SeedOptions {
  env?: Record<string, string | undefined>;
  /** Replaces a user's course, for tests. */
  courses?: Partial<Record<DemoUserKey, DemoCourse>>;
}

/** Seeds both demo users and reports each. Throws only when it refuses to run at all. */
export async function seedDemoData(
  options: SeedOptions = {},
): Promise<SeedOutcome[]> {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "production")
    throw new Error(
      "Refusing to seed: NODE_ENV is production. Demo accounts have public passwords.",
    );
  // Loaded only after the check, so a refused run never opens a connection.
  const { auth } = await import("@/lib/auth");
  const { db } = await import("@/lib/db");

  /** The demo user's id if the account exists (or was just created) and the demo password works. */
  async function demoAccount(
    key: DemoUserKey,
  ): Promise<
    { id: string } | { status: "conflict" | "failed"; reason: string }
  > {
    const { name, email, password } = DEMO_USERS[key];
    const find = () =>
      db.user.findUnique({ where: { email }, select: { id: true } });
    let user = await find();
    if (!user) {
      // With autoSignIn off, Better Auth answers a taken email with a stand-in user instead of an
      // error, so what it returns isn't trusted: the account is read back and checked below.
      await auth.api.signUpEmail({ body: { name, email, password } });
      user = await find();
      if (!user)
        return {
          status: "failed",
          reason: "sign-up didn't create the account",
        };
    }
    const credential = await db.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    });
    if (!credential?.password)
      return {
        status: "conflict",
        reason: "the account already exists without a password",
      };
    const { password: hasher } = await auth.$context;
    if (!(await hasher.verify({ hash: credential.password, password })))
      return {
        status: "conflict",
        reason: "the account already exists with a different password",
      };
    return user;
  }

  async function seedCourse(
    userId: string,
    course: DemoCourse,
  ): Promise<"created" | "already-seeded"> {
    const text = readFileSync(
      path.join(FIXTURES, course.document.file),
      "utf8",
    );
    const chunks = chunk(text, course.document.title);
    return db.$transaction(async (tx) => {
      // Two seeds at once would both see no course; the second waits here, then finds it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seed:${userId}`}))`;
      const existing = await tx.course.findFirst({
        where: { userId, name: course.name },
        select: { id: true },
      });
      if (existing) return "already-seeded";

      const { id: courseId } = await tx.course.create({
        data: { userId, name: course.name },
        select: { id: true },
      });
      const { id: documentId } = await tx.document.create({
        data: {
          courseId,
          title: course.document.title,
          sourceType: course.document.sourceType,
          rawText: text,
          status: "READY",
        },
        select: { id: true },
      });
      const savedChunks = await tx.chunk.createManyAndReturn({
        data: chunks.map((c) => ({ documentId, ...c })),
        select: { id: true, refLabel: true },
      });

      const conceptIds = new Map<string, string>();
      const chunkIdsOf = new Map<string, string[]>();
      for (const concept of course.concepts) {
        const chunkIds = savedChunks
          .filter((c) =>
            concept.sections.some((heading) =>
              c.refLabel.includes(`› ${heading} ¶`),
            ),
          )
          .map((c) => c.id);
        if (chunkIds.length === 0)
          throw new Error(
            `No chunk matches the sections of "${concept.name}".`,
          );
        const { id } = await tx.concept.create({
          data: {
            courseId,
            name: concept.name,
            nameKey: conceptNameKey(concept.name),
            summary: concept.summary,
            chunks: { create: chunkIds.map((chunkId) => ({ chunkId })) },
          },
          select: { id: true },
        });
        conceptIds.set(concept.name, id);
        chunkIdsOf.set(concept.name, chunkIds);
      }

      const idOf = (name: string) => {
        const id = conceptIds.get(name);
        if (!id) throw new Error(`Unknown demo concept "${name}".`);
        return id;
      };
      await tx.conceptEdge.createMany({
        data: course.edges.map((e) => ({
          fromId: idOf(e.from),
          toId: idOf(e.to),
        })),
      });
      await tx.question.createMany({
        data: course.questions.map((q) => ({
          conceptId: idOf(q.concept),
          kind: q.kind,
          text: q.text,
          sourceChunkIds: chunkIdsOf.get(q.concept) ?? [],
        })),
      });
      return "created";
    });
  }

  const outcomes: SeedOutcome[] = [];
  for (const key of Object.keys(DEMO_USERS) as DemoUserKey[]) {
    const { email } = DEMO_USERS[key];
    try {
      const account = await demoAccount(key);
      if ("reason" in account) {
        outcomes.push({ user: key, email, ...account });
        continue;
      }
      const course = options.courses?.[key] ?? DEMO_COURSES[key];
      outcomes.push({
        user: key,
        email,
        status: await seedCourse(account.id, course),
      });
    } catch (error) {
      // Our own messages only: a Prisma or Better Auth error can quote the query or its values.
      const reason =
        error instanceof Error && error.message.startsWith("No chunk matches")
          ? error.message
          : "the database or Better Auth returned an error";
      outcomes.push({ user: key, email, status: "failed", reason });
    }
  }
  return outcomes;
}

/** The line printed for one demo user. Never includes a password. */
export function formatOutcome(outcome: SeedOutcome): string {
  switch (outcome.status) {
    case "created":
      return `✔ ${outcome.email}: seeded (sign-in verified)`;
    case "already-seeded":
      return `✔ ${outcome.email}: already seeded, left as is (sign-in verified)`;
    case "conflict":
      return (
        `✖ ${outcome.email}: not seeded, ${outcome.reason}. Its password and data were left ` +
        "as they are. Delete that account yourself to let the seed recreate it."
      );
    case "failed":
      return (
        `✖ ${outcome.email}: not seeded, ${outcome.reason}. Nothing was half-written, so it's ` +
        "safe to run the seed again (check the database is up: npm run db:up)."
      );
  }
}

/** Prints one line per demo user. Exit code 1 if any user wasn't seeded. */
async function main(): Promise<number> {
  let outcomes: SeedOutcome[];
  try {
    outcomes = await seedDemoData();
  } catch (error) {
    process.stderr.write(`✖ ${(error as Error).message}\n`);
    return 1;
  }
  for (const o of outcomes) {
    const ok = o.status === "created" || o.status === "already-seeded";
    (ok ? process.stdout : process.stderr).write(`${formatOutcome(o)}\n`);
  }
  const { db } = await import("@/lib/db");
  await db.$disconnect();
  return outcomes.every(
    (o) => o.status === "created" || o.status === "already-seeded",
  )
    ? 0
    : 1;
}

// Run by `prisma db seed` (tsx prisma/seed.ts); imported by tests, which call seedDemoData.
if (path.resolve(process.argv[1] ?? "") === path.resolve("prisma/seed.ts"))
  void main().then((code) => process.exit(code));
