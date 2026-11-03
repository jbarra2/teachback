// In-memory stand-ins for each endpoint (PLAN §7), keyed by the NEXT_PUBLIC_MOCK_ENDPOINTS name.
// They answer in the contract's shapes and statuses, so screens can't tell them from the real API.
// Requests are checked with the server's own zod schemas, in the server's order: path id, then
// body (400), then lookup (404).
import { z } from "zod";
import type { components } from "@/lib/api-client/schema";
import {
  AnswerBody,
  CreateCourseBody,
  IdParams,
  UploadDocumentForm,
} from "@/lib/schemas";
import type { MockKey } from "./config";
import {
  COURSE_ID,
  DOCUMENT_ID,
  answerResults,
  concepts,
  courseMap,
  courses,
  documentsByCourse,
  nextConcept,
  question,
} from "./fixtures";

type Schemas = components["schemas"];

/** A request this handler answers, and the path parameters it captured. */
type Handler = (request: Request, params: string[]) => Promise<Response>;

interface Route {
  key: MockKey;
  method: string;
  pattern: RegExp;
  handle: Handler;
}

const ID = "([^/]+)";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const notFound = () =>
  json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);

/** 400 VALIDATION_ERROR with zod's field and form errors, as the server sends it. */
function invalid(error: z.ZodError): Response {
  return json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Some fields are invalid.",
        details: z.flattenError(error),
      },
    },
    400,
  );
}

type Parsed<T> = { data: T; response?: never } | { response: Response };

function parse<T>(schema: z.ZodType<T>, value: unknown): Parsed<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { data: result.data }
    : { response: invalid(result.error) };
}

/** The JSON body, or undefined when it isn't JSON (the schema then reports it). */
async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** The form fields as an object, as the upload route builds them. */
async function readForm(request: Request): Promise<unknown> {
  try {
    return Object.fromEntries(await request.formData());
  } catch {
    return undefined;
  }
}

/** A cuid-looking id for things the mocks create. */
function mockId(prefix: string, n: number): string {
  return `c${prefix}${String(n).padStart(24 - prefix.length, "0")}`;
}

/** Mock state, fresh per client so tests don't leak into each other. */
export function createMockRoutes(): Route[] {
  const courseList: Schemas["Course"][] = [...courses];
  const documents = new Map(
    Object.entries(documentsByCourse).map(([id, docs]) => [id, [...docs]]),
  );
  // Uploaded documents step QUEUED → PROCESSING → READY, one step per poll.
  const polls = new Map<string, number>();
  let created = 0;
  let answered = 0;

  const findCourse = (id: string) =>
    courseList.find((course) => course.id === id);
  const findDocument = (id: string) =>
    [...documents.values()].flat().find((doc) => doc.id === id);

  /** A route with an `{id}`: the id is checked like the server's IdParams before the handler runs. */
  const withId =
    (handle: (request: Request, id: string) => Promise<Response>): Handler =>
    async (request, [id]) => {
      const params = parse(IdParams, { id });
      return params.response ?? handle(request, params.data.id);
    };

  return [
    {
      key: "courses",
      method: "GET",
      pattern: /^\/api\/courses$/,
      handle: async () => json(courseList),
    },
    {
      key: "courses",
      method: "POST",
      pattern: /^\/api\/courses$/,
      handle: async (request) => {
        const body = parse(CreateCourseBody, await readJson(request));
        if (body.response) return body.response;
        const course = {
          id: mockId("mockcourse", ++created),
          name: body.data.name,
          createdAt: new Date().toISOString(),
        };
        courseList.push(course);
        documents.set(course.id, []);
        return json(course, 201);
      },
    },
    {
      key: "courses",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}$`),
      handle: withId(async (_request, id) => {
        const course = findCourse(id);
        if (!course) return notFound();
        return json({ ...course, documents: documents.get(course.id) ?? [] });
      }),
    },
    {
      key: "concepts",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/concepts$`),
      handle: withId(async (_request, id) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? concepts : []);
      }),
    },
    {
      key: "map",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/map$`),
      handle: withId(async (_request, id) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? courseMap : { nodes: [], edges: [] });
      }),
    },
    {
      key: "next",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/next-concept$`),
      handle: withId(async (_request, id) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? nextConcept : null);
      }),
    },
    {
      key: "documents",
      method: "POST",
      pattern: /^\/api\/documents$/,
      handle: async (request) => {
        const form = parse(UploadDocumentForm, await readForm(request));
        if (form.response) return form.response;
        const { courseId, title } = form.data;
        if (!findCourse(courseId)) return notFound();
        const id = mockId("mockdoc", ++created);
        documents.get(courseId)?.push({
          id,
          title,
          status: "QUEUED",
          createdAt: new Date().toISOString(),
        });
        polls.set(id, 0);
        return json({ id, status: "QUEUED" }, 202);
      },
    },
    {
      key: "documents",
      method: "GET",
      pattern: new RegExp(`^/api/documents/${ID}$`),
      handle: withId(async (_request, id) => {
        const doc = findDocument(id);
        if (!doc) return notFound();
        const poll = polls.get(doc.id);
        if (poll !== undefined) {
          doc.status = poll === 0 ? "PROCESSING" : "READY";
          polls.set(doc.id, poll + 1);
        }
        const conceptCount =
          doc.status !== "READY"
            ? 0
            : doc.id === DOCUMENT_ID
              ? concepts.length
              : 3;
        return json({
          id: doc.id,
          status: doc.status,
          error: doc.error,
          conceptCount,
        });
      }),
    },
    {
      key: "question",
      method: "POST",
      pattern: new RegExp(`^/api/concepts/${ID}/question$`),
      handle: withId(async (_request, id) => {
        if (!concepts.some((concept) => concept.id === id)) return notFound();
        return json(question);
      }),
    },
    {
      key: "answer",
      method: "POST",
      pattern: new RegExp(`^/api/questions/${ID}/answer$`),
      handle: withId(async (request, id) => {
        const body = parse(AnswerBody, await readJson(request));
        if (body.response) return body.response;
        if (id !== question.questionId) return notFound();
        return json(answerResults[answered++ % answerResults.length]);
      }),
    },
  ];
}

/** Decodes a path segment; a malformed escape stays as it is (and then fails the id check). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The mock route for this request, if any, with its captured path parameters. */
export function matchRoute(
  routes: Route[],
  request: Request,
): { route: Route; params: string[] } | null {
  const { pathname } = new URL(request.url);
  for (const route of routes) {
    if (route.method !== request.method) continue;
    const match = route.pattern.exec(pathname);
    if (match) return { route, params: match.slice(1).map(decodeSegment) };
  }
  return null;
}
