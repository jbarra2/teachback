// In-memory stand-ins for each endpoint (PLAN §7), keyed by the NEXT_PUBLIC_MOCK_ENDPOINTS name.
// They answer in the contract's shapes and statuses, so screens can't tell them from the real API.
import type { components } from "@/lib/api-client/schema";
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

function error(
  code: Schemas["ErrorCode"],
  message: string,
  status: number,
  fieldErrors?: Record<string, string[]>,
): Response {
  const details = fieldErrors ? { formErrors: [], fieldErrors } : undefined;
  return json({ error: { code, message, details } }, status);
}

const notFound = () => error("NOT_FOUND", "Not found.", 404);
const invalid = (field: string, message: string) =>
  error("VALIDATION_ERROR", "Please check the highlighted fields.", 400, {
    [field]: [message],
  });

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Trimmed text within 1..max characters, or null. */
function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
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

  const findCourse = (id: string | undefined) =>
    courseList.find((course) => course.id === id);
  const findDocument = (id: string | undefined) =>
    [...documents.values()].flat().find((doc) => doc.id === id);

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
        const name = boundedText((await readJson(request)).name, 120);
        if (!name) return invalid("name", "Use 1–120 characters.");
        const course = {
          id: mockId("mockcourse", ++created),
          name,
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
      handle: async (_request, [id]) => {
        const course = findCourse(id);
        if (!course) return notFound();
        return json({ ...course, documents: documents.get(course.id) ?? [] });
      },
    },
    {
      key: "concepts",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/concepts$`),
      handle: async (_request, [id]) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? concepts : []);
      },
    },
    {
      key: "map",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/map$`),
      handle: async (_request, [id]) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? courseMap : { nodes: [], edges: [] });
      },
    },
    {
      key: "next",
      method: "GET",
      pattern: new RegExp(`^/api/courses/${ID}/next-concept$`),
      handle: async (_request, [id]) => {
        if (!findCourse(id)) return notFound();
        return json(id === COURSE_ID ? nextConcept : null);
      },
    },
    {
      key: "documents",
      method: "POST",
      pattern: /^\/api\/documents$/,
      handle: async (request) => {
        const form = await request.formData();
        const courseId = form.get("courseId");
        const title = boundedText(form.get("title"), 200);
        if (typeof courseId !== "string" || !findCourse(courseId))
          return notFound();
        if (!title) return invalid("title", "Use 1–200 characters.");
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
      handle: async (_request, [id]) => {
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
      },
    },
    {
      key: "question",
      method: "POST",
      pattern: new RegExp(`^/api/concepts/${ID}/question$`),
      handle: async (_request, [id]) => {
        if (!concepts.some((concept) => concept.id === id)) return notFound();
        return json(question);
      },
    },
    {
      key: "answer",
      method: "POST",
      pattern: new RegExp(`^/api/questions/${ID}/answer$`),
      handle: async (request, [id]) => {
        if (id !== question.questionId) return notFound();
        if (!boundedText((await readJson(request)).answer, 4000))
          return invalid("answer", "Use 1–4000 characters.");
        return json(answerResults[answered++ % answerResults.length]);
      },
    },
  ];
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
    if (match) return { route, params: match.slice(1).map(decodeURIComponent) };
  }
  return null;
}
