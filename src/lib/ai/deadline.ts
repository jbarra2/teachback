// One deadline for a whole AI step (PLAN §8: 60 s per attempt, one retry), so a slow failure plus
// its retry can't keep a request or a document waiting much longer than planned.
import { AiError } from "./errors";

/** Rejects with AiError TIMEOUT once `ms` pass, and clears its timer either way. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError("TIMEOUT")), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
