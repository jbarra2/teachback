// T13 · Courses API against the real stack (db-test, Better Auth sessions, withApi): the security
// matrix (TESTING §3) for GET/POST /api/courses, GET /api/courses/{id} and
// GET /api/courses/{id}/concepts, plus their behaviour. Every response is checked against openapi.yaml (S7).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as conceptsRoute from "@/app/api/courses/[id]/concepts/route";
import * as courseRoute from "@/app/api/courses/[id]/route";
import * as coursesRoute from "@/app/api/courses/route";
import { db } from "@/lib/db";
import {
  STUCK_AFTER_MS,
  TIMED_OUT_MESSAGE,
} from "@/lib/services/document-status";
import {
  appOrigin,
  as,
  asAnonymous,
  createUser,
  crossSite,
  fromOrigin,
  type TestUser,
} from "../helpers/api";
import { expectMatchesOpenApi } from "../helpers/openapi-assert";

const LIST = "GET /api/courses";
const CREATE = "POST /api/courses";
const DETAIL = "GET /api/courses/{id}";
const CONCEPTS = "GET /api/courses/{id}/concepts";

/** A well-formed id that no row has. */
const MISSING_ID = "cmissing00000000000000000";
/** A well-formed id ending in n, for checking tie-break order. */
const tieId = (kind: "course" | "doc", n: number) =>
  `c${kind}${"0".repeat(23 - kind.length)}${n}`;

/** Stored note text; must never appear in a response (S8). */
const RAW_TEXT = "RAW-NOTE-TEXT-must-never-be-returned";

let ada: TestUser;
let grace: TestUser;

beforeAll(async () => {
  ada = await createUser({ name: "Ada" });
  grace = await createUser({ name: "Grace" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Rows the API can't create yet (documents come from T12, concepts and mastery from T12/T22).
async function addCourse(
  owner: TestUser,
  name: string,
  createdAt?: Date,
  id?: string,
) {
  return db.course.create({ data: { id, userId: owner.id, name, createdAt } });
}

async function addDocument(
  courseId: string,
  title: string,
  fields: {
    status?: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
    error?: string | null;
    createdAt?: Date;
    id?: string;
  } = {},
) {
  return db.document.create({
    data: { courseId, title, sourceType: "TEXT", rawText: RAW_TEXT, ...fields },
  });
}

async function addConcept(
  courseId: string,
  name: string,
  nameKey = name.toLowerCase(),
) {
  return db.concept.create({
    data: {
      courseId,
      name,
      nameKey,
      summary: `About ${name}.`,
    },
  });
}

async function setMastery(
  user: TestUser,
  conceptId: string,
  score: number,
  attempts: number,
) {
  await db.mastery.create({
    data: {
      userId: user.id,
      conceptId,
      score,
      attempts,
      lastSeenAt: new Date(),
    },
  });
}

const list = (user: TestUser) =>
  as(user).call(coursesRoute.GET, { url: "/api/courses" });
const create = (user: TestUser, body: unknown) =>
  as(user).call(coursesRoute.POST, {
    method: "POST",
    url: "/api/courses",
    body,
  });
const detail = (user: TestUser, id: string) =>
  as(user).call(courseRoute.GET, {
    url: `/api/courses/${id}`,
    params: { id },
  });
const concepts = (user: TestUser, id: string) =>
  as(user).call(conceptsRoute.GET, {
    url: `/api/courses/${id}/concepts`,
    params: { id },
  });

/** A POST with a body the JSON helper can't build (malformed JSON, another content type). */
function rawPost(user: TestUser, body: string, contentType: string) {
  return coursesRoute.POST(
    new Request(new URL("/api/courses", appOrigin()), {
      method: "POST",
      headers: {
        cookie: user.cookie,
        origin: appOrigin(),
        "content-type": contentType,
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    }),
  );
}

/** S8: nothing private in a body: no user ids, no note text, no tokens or session data. */
function expectNothingPrivate(body: unknown, ...userIds: string[]) {
  const text = JSON.stringify(body);
  const secrets = [ada.id, grace.id, ...userIds, RAW_TEXT, "rawText", "userId"];
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/token|session|password/i);
}

async function courseCount(user: TestUser) {
  return db.course.count({ where: { userId: user.id } });
}

describe("S1: every route needs a session", () => {
  const cases = [
    [LIST, () => asAnonymous().call(coursesRoute.GET, { url: "/api/courses" })],
    [
      CREATE,
      () =>
        asAnonymous().call(coursesRoute.POST, {
          method: "POST",
          url: "/api/courses",
          body: { name: "Biology" },
        }),
    ],
    [
      DETAIL,
      () =>
        asAnonymous().call(courseRoute.GET, {
          url: `/api/courses/${MISSING_ID}`,
          params: { id: MISSING_ID },
        }),
    ],
    [
      CONCEPTS,
      () =>
        asAnonymous().call(conceptsRoute.GET, {
          url: `/api/courses/${MISSING_ID}/concepts`,
          params: { id: MISSING_ID },
        }),
    ],
  ] as const;

  it.each(cases)("S1: %s with no session → 401", async (key, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await expectMatchesOpenApi(res, key)).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("S1: a tampered session cookie → 401, and creates nothing", async () => {
    const tampered = { ...ada, cookie: `${ada.cookie.slice(0, -4)}AAA=` };
    const before = await courseCount(ada);
    for (const [key, res] of [
      [LIST, await list(tampered)],
      [CREATE, await create(tampered, { name: "Sneaky" })],
    ] as const) {
      expect(res.status).toBe(401);
      expect(await expectMatchesOpenApi(res, key)).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    expect(await courseCount(ada)).toBe(before);
  });
});

describe("GET /api/courses", () => {
  it("S2: lists only my own courses, newest first", async () => {
    const owner = await createUser();
    const other = await createUser();
    const old = await addCourse(owner, "Old", new Date("2026-10-01T00:00:00Z"));
    const recent = await addCourse(
      owner,
      "Recent",
      new Date("2026-11-01T00:00:00Z"),
    );
    await addCourse(other, "Not mine", new Date("2026-11-02T00:00:00Z"));

    const res = await list(owner);
    expect(res.status).toBe(200);
    const body = await expectMatchesOpenApi(res, LIST);
    expect(body).toEqual([
      {
        id: recent.id,
        name: "Recent",
        createdAt: "2026-11-01T00:00:00.000Z",
      },
      { id: old.id, name: "Old", createdAt: "2026-10-01T00:00:00.000Z" },
    ]);
    expectNothingPrivate(body, owner.id, other.id);
  });

  it("returns an empty list for a new account", async () => {
    const fresh = await createUser();
    const res = await list(fresh);
    expect(await expectMatchesOpenApi(res, LIST)).toEqual([]);
  });

  it("keeps a stable order for courses created at the same moment: highest id first", async () => {
    const owner = await createUser();
    const at = new Date("2026-11-01T12:00:00Z");
    // Inserted in an order that is neither ascending nor descending by id, so storage order can't
    // pass for the tie-break.
    for (const n of [2, 3, 1])
      await addCourse(owner, `Course ${n}`, at, tieId("course", n));
    const listed = (await expectMatchesOpenApi(await list(owner), LIST)) as {
      id: string;
    }[];
    expect(listed.map(({ id }) => id)).toEqual(
      [3, 2, 1].map((n) => tieId("course", n)),
    );
  });
});

describe("POST /api/courses", () => {
  it("creates a course for me: 201, with the trimmed name", async () => {
    const owner = await createUser();
    const res = await create(owner, { name: "  Organic Chemistry \n" });
    expect(res.status).toBe(201);
    const body = (await expectMatchesOpenApi(res, CREATE)) as {
      id: string;
      name: string;
      createdAt: string;
    };
    expect(body.name).toBe("Organic Chemistry");
    expect(Object.keys(body).sort()).toEqual(["createdAt", "id", "name"]);
    expectNothingPrivate(body, owner.id);
    const stored = await db.course.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(stored).toMatchObject({
      userId: owner.id,
      name: "Organic Chemistry",
    });
    expect(stored.createdAt.toISOString()).toBe(body.createdAt);
    // It shows up in my list.
    expect(await expectMatchesOpenApi(await list(owner), LIST)).toEqual([body]);
  });

  it("stores markup as plain text", async () => {
    const owner = await createUser();
    const name = "<script>alert(1)</script>";
    const res = await create(owner, { name });
    expect(res.status).toBe(201);
    expect(await expectMatchesOpenApi(res, CREATE)).toMatchObject({ name });
  });

  it("accepts exactly 120 characters, counting an emoji as one", async () => {
    const owner = await createUser();
    const name = `${"a".repeat(119)}🧬`;
    const res = await create(owner, { name });
    expect(res.status).toBe(201);
    await expectMatchesOpenApi(res, CREATE);
  });

  it.each([
    ["S3: a foreign Origin", () => as(ada).fromOrigin("https://evil.example")],
    ["S3: Sec-Fetch-Site: cross-site", () => as(ada).crossSite()],
    [
      "S3: a foreign Origin without a session",
      () => fromOrigin("https://evil.example"),
    ],
    ["S3: cross-site without a session", () => crossSite()],
  ])("%s → 403, and creates nothing", async (_name, caller) => {
    const before = await courseCount(ada);
    const res = await caller().call(coursesRoute.POST, {
      method: "POST",
      url: "/api/courses",
      body: { name: "Planted" },
    });
    expect(res.status).toBe(403);
    expect(await expectMatchesOpenApi(res, CREATE)).toMatchObject({
      error: { code: "FORBIDDEN_ORIGIN" },
    });
    expect(await courseCount(ada)).toBe(before);
  });

  it.each([
    ["a missing name", {}, "name"],
    ["a name that isn't a string", { name: 42 }, "name"],
    ["an empty name", { name: "" }, "name"],
    ["a name of only spaces", { name: " \t\n " }, "name"],
    ["a name over 120 characters", { name: "a".repeat(121) }, "name"],
    [
      "121 characters, the last an emoji",
      { name: `${"a".repeat(120)}🧬` },
      "name",
    ],
    ["a NUL character", { name: "Bio\u0000logy" }, "name"],
    ["an unpaired surrogate", { name: "Bio\uD800logy" }, "name"],
    ["an unknown field", { name: "Biology", color: "red" }, null],
    // Mass assignment: the owner comes from the session, never the body.
    ["a userId for another account", { name: "Biology", userId: "x" }, null],
    ["an array instead of an object", [{ name: "Biology" }], null],
  ])(
    "S4: %s → 400 VALIDATION_ERROR, and creates nothing",
    async (_name, body, field) => {
      const before = await courseCount(ada);
      const res = await create(ada, body);
      expect(res.status).toBe(400);
      const error = (await expectMatchesOpenApi(res, CREATE)) as {
        error: {
          code: string;
          details: { fieldErrors: Record<string, string[]> };
        };
      };
      expect(error.error.code).toBe("VALIDATION_ERROR");
      if (field) expect(error.error.details.fieldErrors[field]).toBeDefined();
      else
        expect(
          JSON.stringify(error.error.details).length,
          "a 400 must say what's wrong",
        ).toBeGreaterThan(
          JSON.stringify({ formErrors: [], fieldErrors: {} }).length,
        );
      expect(JSON.stringify(error)).not.toMatch(/at \w+ \(|\.ts:\d+/);
      expect(await courseCount(ada)).toBe(before);
    },
  );

  it("S4: the userId in the body is refused even when it's my own", async () => {
    const before = await courseCount(ada);
    const res = await create(ada, { name: "Biology", userId: ada.id });
    expect(res.status).toBe(400);
    expect(await expectMatchesOpenApi(res, CREATE)).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(await courseCount(ada)).toBe(before);
  });

  it.each([
    ["malformed JSON", "{ name: ", "application/json"],
    ["an empty body", "", "application/json"],
    [
      "a form instead of JSON",
      "name=Biology",
      "application/x-www-form-urlencoded",
    ],
  ])(
    "S4: %s → 400 VALIDATION_ERROR, and creates nothing",
    async (_name, body, type) => {
      const before = await courseCount(ada);
      const res = await rawPost(ada, body, type);
      expect(res.status).toBe(400);
      expect(await expectMatchesOpenApi(res, CREATE)).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
      expect(await courseCount(ada)).toBe(before);
    },
  );

  it("S5: a body over 64 KB → 413, and creates nothing", async () => {
    const before = await courseCount(ada);
    const res = await create(ada, { name: "a".repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect(await expectMatchesOpenApi(res, CREATE)).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(await courseCount(ada)).toBe(before);
  });
});

describe("GET /api/courses/{id}", () => {
  it("returns my course with its documents, newest first, and no note text", async () => {
    const course = await addCourse(
      ada,
      "Biology",
      new Date("2026-11-01T09:15:00Z"),
    );
    const now = Date.now();
    const ready = await addDocument(course.id, "Week 1", {
      status: "READY",
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
    });
    const failed = await addDocument(course.id, "Week 2", {
      status: "FAILED",
      error: "We couldn't read any text in that file.",
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    });
    const processing = await addDocument(course.id, "Week 3", {
      status: "PROCESSING",
      createdAt: new Date(now - 60 * 1000),
    });

    const res = await detail(ada, course.id);
    expect(res.status).toBe(200);
    const body = await expectMatchesOpenApi(res, DETAIL);
    expect(body).toEqual({
      id: course.id,
      name: "Biology",
      createdAt: "2026-11-01T09:15:00.000Z",
      documents: [
        {
          id: processing.id,
          title: "Week 3",
          status: "PROCESSING",
          createdAt: processing.createdAt.toISOString(),
        },
        {
          id: failed.id,
          title: "Week 2",
          status: "FAILED",
          error: "We couldn't read any text in that file.",
          createdAt: failed.createdAt.toISOString(),
        },
        {
          id: ready.id,
          title: "Week 1",
          status: "READY",
          createdAt: ready.createdAt.toISOString(),
        },
      ],
    });
    expectNothingPrivate(body);
  });

  it("reports a document stuck for 10 minutes as FAILED, so nothing spins forever", async () => {
    const course = await addCourse(ada, "Chemistry");
    const stuck = await addDocument(course.id, "Stuck", {
      status: "QUEUED",
      createdAt: new Date(Date.now() - STUCK_AFTER_MS - 1000),
    });
    const res = await detail(ada, course.id);
    const body = (await expectMatchesOpenApi(res, DETAIL)) as {
      documents: unknown[];
    };
    expect(body.documents).toEqual([
      {
        id: stuck.id,
        title: "Stuck",
        status: "FAILED",
        error: TIMED_OUT_MESSAGE,
        createdAt: stuck.createdAt.toISOString(),
      },
    ]);
  });

  it("keeps a stable order for documents uploaded at the same moment: highest id first", async () => {
    const course = await addCourse(ada, "Ties");
    const at = new Date();
    for (const n of [2, 3, 1])
      await addDocument(course.id, `Doc ${n}`, {
        status: "READY",
        createdAt: at,
        id: tieId("doc", n),
      });
    const body = (await expectMatchesOpenApi(
      await detail(ada, course.id),
      DETAIL,
    )) as { documents: { id: string }[] };
    expect(body.documents.map(({ id }) => id)).toEqual(
      [3, 2, 1].map((n) => tieId("doc", n)),
    );
  });

  it("returns a course with no documents, even when my other courses have some", async () => {
    const sibling = await addCourse(ada, "Sibling");
    await addDocument(sibling.id, "Sibling's notes");
    const course = await addCourse(ada, "Empty");
    const res = await detail(ada, course.id);
    expect(await expectMatchesOpenApi(res, DETAIL)).toMatchObject({
      documents: [],
    });
  });

  it("S2: another user's course → 404, the same answer as a course that doesn't exist", async () => {
    const theirs = await addCourse(grace, "Grace's notes");
    await addDocument(theirs.id, "Private week");
    const res = await detail(ada, theirs.id);
    expect(res.status).toBe(404);
    const body = await expectMatchesOpenApi(res, DETAIL);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(body)).not.toMatch(/Grace|Private week/);

    const missing = await detail(ada, MISSING_ID);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    expect(await expectMatchesOpenApi(missing, DETAIL)).toEqual(body);
  });

  it.each(["not-an-id", "c123", "CCOURSE000000000000000001", `${MISSING_ID}x`])(
    "S4: a malformed id (%s) → 400 VALIDATION_ERROR",
    async (id) => {
      const res = await detail(ada, id);
      expect(res.status).toBe(400);
      expect(await expectMatchesOpenApi(res, DETAIL)).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { fieldErrors: { id: [expect.any(String)] } },
        },
      });
    },
  );
});

describe("GET /api/courses/{id}/concepts", () => {
  it("lists the course's concepts by name, ignoring case, with my mastery", async () => {
    const course = await addCourse(ada, "Biology");
    const osmosis = await addConcept(course.id, "Osmosis");
    const cell = await addConcept(course.id, "Cell membrane");
    const mito = await addConcept(course.id, "Mitochondria");
    // Lowercase first letter: a byte-order ("C") collation would put it last.
    const mrna = await addConcept(course.id, "mRNA");
    await setMastery(ada, cell.id, 0.5, 1);
    await setMastery(ada, mito.id, 0.75, 2);

    const res = await concepts(ada, course.id);
    expect(res.status).toBe(200);
    const body = await expectMatchesOpenApi(res, CONCEPTS);
    expect(body).toEqual([
      {
        id: cell.id,
        name: "Cell membrane",
        summary: "About Cell membrane.",
        state: "REVIEW",
        score: 0.5,
        attempts: 1,
      },
      {
        id: mito.id,
        name: "Mitochondria",
        summary: "About Mitochondria.",
        state: "MASTERED",
        score: 0.75,
        attempts: 2,
      },
      {
        id: mrna.id,
        name: "mRNA",
        summary: "About mRNA.",
        state: "PRACTICE",
        score: 0,
        attempts: 0,
      },
      {
        id: osmosis.id,
        name: "Osmosis",
        summary: "About Osmosis.",
        state: "PRACTICE",
        score: 0,
        attempts: 0,
      },
    ]);
    expectNothingPrivate(body);
  });

  it("orders by the normalized name key, not by the stored name's collation", async () => {
    const course = await addCourse(ada, "Keys");
    // nameKey decides: a database whose collation orders name differently can't change the list.
    const zeta = await addConcept(course.id, "Zeta", "aaa zeta");
    const alpha = await addConcept(course.id, "Alpha", "bbb alpha");
    const body = (await expectMatchesOpenApi(
      await concepts(ada, course.id),
      CONCEPTS,
    )) as { id: string }[];
    expect(body.map(({ id }) => id)).toEqual([zeta.id, alpha.id]);
  });

  it("S2: never shows another user's mastery of my concepts", async () => {
    const course = await addCourse(ada, "Physics");
    const force = await addConcept(course.id, "Force");
    await setMastery(grace, force.id, 1, 5);
    const res = await concepts(ada, course.id);
    expect(await expectMatchesOpenApi(res, CONCEPTS)).toEqual([
      expect.objectContaining({
        id: force.id,
        state: "PRACTICE",
        score: 0,
        attempts: 0,
      }),
    ]);
  });

  it("returns an empty list for a course with no concepts yet, even when my other courses have some", async () => {
    const sibling = await addCourse(ada, "Sibling");
    await addConcept(sibling.id, "Sibling concept");
    const course = await addCourse(ada, "New");
    const res = await concepts(ada, course.id);
    expect(await expectMatchesOpenApi(res, CONCEPTS)).toEqual([]);
  });

  it("S2: another user's course → 404, and none of its concepts", async () => {
    const theirs = await addCourse(grace, "Grace's course");
    await addConcept(theirs.id, "Secret concept");
    const res = await concepts(ada, theirs.id);
    expect(res.status).toBe(404);
    const body = await expectMatchesOpenApi(res, CONCEPTS);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(body)).not.toContain("Secret concept");

    const missing = await concepts(ada, MISSING_ID);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    expect(await expectMatchesOpenApi(missing, CONCEPTS)).toEqual(body);
  });

  it.each([
    "../courses",
    "not-an-id",
    "c123",
    "CCOURSE000000000000000001",
    `${MISSING_ID}x`,
  ])("S4: a malformed id (%s) → 400 VALIDATION_ERROR", async (id) => {
    const res = await concepts(ada, id);
    expect(res.status).toBe(400);
    expect(await expectMatchesOpenApi(res, CONCEPTS)).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { fieldErrors: { id: [expect.any(String)] } },
      },
    });
  });
});

describe("every route", () => {
  it("marks responses private, not to be cached", async () => {
    const course = await addCourse(ada, "Cached?");
    for (const [key, res] of [
      [LIST, await list(ada)],
      [DETAIL, await detail(ada, course.id)],
      [CONCEPTS, await concepts(ada, course.id)],
      [CREATE, await create(ada, { name: "Also private" })],
    ] as const) {
      await expectMatchesOpenApi(res, key);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it.each([
    [LIST, "findMany", () => list(ada)],
    [CREATE, "create", () => create(ada, { name: "Biology" })],
    [DETAIL, "findFirst", () => detail(ada, MISSING_ID)],
    [CONCEPTS, "findFirst", () => concepts(ada, MISSING_ID)],
  ] as const)(
    "%s: a database error → 500 INTERNAL, generic, with a request id",
    async (key, method, call) => {
      vi.spyOn(db.course, method).mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5434 password=hunter2"),
      );
      const res = await call();
      expect(res.status).toBe(500);
      const body = await expectMatchesOpenApi(res, key);
      expect(body).toMatchObject({ error: { code: "INTERNAL" } });
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|hunter2|5434/);
      expect(res.headers.get("x-request-id")).toBeTruthy();
    },
  );
});
