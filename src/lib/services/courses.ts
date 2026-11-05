// Courses (T13, PLAN §7): the signed-in student's courses, a course's documents, and its concepts
// with that student's mastery. Every query is scoped to `userId` from the session, so another
// user's course is indistinguishable from one that doesn't exist (null → 404). Each query names
// the fields it returns, so no owner id or note text can reach a response.
import { db } from "@/lib/db";
import { masteryState, UNSEEN, type MasteryState } from "@/lib/mastery";
import { visibleStatus, type VisibleStatus } from "./document-status";

export interface CourseSummary {
  id: string;
  name: string;
  createdAt: Date;
}

export interface CourseDocument extends VisibleStatus {
  id: string;
  title: string;
  createdAt: Date;
}

export interface CourseDetail extends CourseSummary {
  documents: CourseDocument[];
}

export interface CourseConcept {
  id: string;
  name: string;
  summary: string;
  state: MasteryState;
  score: number;
  attempts: number;
}

const SUMMARY = { id: true, name: true, createdAt: true } as const;

/** Newest first; the id breaks ties so the order never changes between requests. Read-only here,
 * so each query spreads it into the mutable array Prisma's type asks for. */
const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }] as const;

export async function listCourses(userId: string): Promise<CourseSummary[]> {
  return db.course.findMany({
    where: { userId },
    select: SUMMARY,
    orderBy: [...NEWEST_FIRST],
  });
}

/** `name` is already trimmed and checked by CreateCourseBody. */
export async function createCourse(
  userId: string,
  name: string,
): Promise<CourseSummary> {
  return db.course.create({ data: { userId, name }, select: SUMMARY });
}

export async function getCourse(
  userId: string,
  courseId: string,
): Promise<CourseDetail | null> {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      ...SUMMARY,
      documents: {
        select: {
          id: true,
          title: true,
          status: true,
          error: true,
          createdAt: true,
        },
        orderBy: [...NEWEST_FIRST],
      },
    },
  });
  if (!course) return null;
  return {
    ...course,
    documents: course.documents.map((document) => ({
      id: document.id,
      title: document.title,
      ...visibleStatus(document),
      createdAt: document.createdAt,
    })),
  };
}

export async function listCourseConcepts(
  userId: string,
  courseId: string,
): Promise<CourseConcept[] | null> {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      concepts: {
        select: {
          id: true,
          name: true,
          summary: true,
          // Only this student's row: the key is (userId, conceptId), so at most one.
          mastery: {
            where: { userId },
            select: { score: true, attempts: true },
          },
        },
        // nameKey is the lowercased name (unique per course), so case never decides the order.
        orderBy: { nameKey: "asc" },
      },
    },
  });
  if (!course) return null;
  return course.concepts.map(({ mastery, ...concept }) => {
    const { score, attempts } = mastery[0] ?? UNSEEN;
    return {
      ...concept,
      state: masteryState({ score, attempts }),
      score,
      attempts,
    };
  });
}
