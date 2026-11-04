// Progress views of a course (T21, PLAN §7 and §9): the concept map, and the concept to practise
// next. Every query is scoped to `userId` from the session: the course must be mine (null → 404),
// mastery and answers are only mine, and an edge counts only when both its ends are in the course.
// Each query names the fields it returns, so no owner id or note text can reach a response.
import { db } from "@/lib/db";
import {
  masteryState,
  selectNextConcept,
  UNSEEN,
  type MasteryState,
} from "@/lib/mastery";

export interface MapNode {
  id: string;
  name: string;
  state: MasteryState;
  score: number;
}

export interface MapEdge {
  from: string;
  to: string;
}

export interface CourseMap {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface NextConcept {
  conceptId: string;
  name: string;
  state: MasteryState;
}

/** Plain string order (not the database collation), so the output is the same everywhere. */
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function getCourseMap(
  userId: string,
  courseId: string,
): Promise<CourseMap | null> {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      concepts: {
        select: {
          id: true,
          name: true,
          // Only this student's row: the key is (userId, conceptId), so at most one.
          mastery: {
            where: { userId },
            select: { score: true, attempts: true },
          },
          // Every edge starts at one of this course's concepts; keep those that also end in it.
          outEdges: {
            where: { to: { courseId } },
            select: { toId: true },
          },
        },
        // nameKey is the lowercased name (unique per course), so case never decides the order.
        orderBy: { nameKey: "asc" },
      },
    },
  });
  if (!course) return null;

  const nodes = course.concepts.map(({ id, name, mastery }) => {
    const { score, attempts } = mastery[0] ?? UNSEEN;
    return { id, name, state: masteryState({ score, attempts }), score };
  });
  return { nodes, edges: mapEdges(course.concepts) };
}

/**
 * The map's edges from each concept's outgoing edges, sorted by `from`, then `to`. Sorted here, not
 * left to the database: its order depends on the query plan (an index happens to sort them today).
 */
export function mapEdges(
  concepts: readonly { id: string; outEdges: readonly { toId: string }[] }[],
): MapEdge[] {
  return concepts
    .flatMap(({ id, outEdges }) =>
      outEdges
        // A concept can't lead to itself; such a row would only draw a loop on the map.
        .filter(({ toId }) => toId !== id)
        .map(({ toId }) => ({ from: id, to: toId })),
    )
    .sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to));
}

/**
 * The concept to practise next in one of my courses (PLAN §9), or `concept: null` when the course
 * has none yet. Null when the course isn't mine.
 */
export async function getNextConcept(
  userId: string,
  courseId: string,
): Promise<{ concept: NextConcept | null } | null> {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      concepts: {
        select: {
          id: true,
          name: true,
          mastery: {
            where: { userId },
            select: { score: true, attempts: true, lastSeenAt: true },
          },
        },
      },
    },
  });
  if (!course) return null;

  const progress = course.concepts.map(({ id, mastery }) => ({
    id,
    ...(mastery[0] ?? UNSEEN),
  }));
  // The previous concept only matters when there's another to offer instead.
  const previousId =
    progress.length > 1 ? await latestAnsweredConcept(userId, courseId) : null;
  const nextId = selectNextConcept(progress, previousId);
  const index = progress.findIndex(({ id }) => id === nextId);
  if (index === -1) return { concept: null };
  return {
    concept: {
      conceptId: progress[index].id,
      name: course.concepts[index].name,
      state: masteryState(progress[index]),
    },
  };
}

/** The concept of my most recent answer in the course, whatever its grade (LOW included). */
async function latestAnsweredConcept(
  userId: string,
  courseId: string,
): Promise<string | null> {
  const attempt = await db.attempt.findFirst({
    where: { userId, question: { concept: { courseId } } },
    // The id breaks a tie between answers saved at the same moment, so the pick never flips.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { question: { select: { conceptId: true } } },
  });
  return attempt?.question.conceptId ?? null;
}
