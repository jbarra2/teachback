// Health (T14, PLAN §7): is the database reachable? Public, so it reports only up or down: no
// versions, settings or timings (TESTING §8, information leakage).
import { db } from "@/lib/db";
import { log } from "@/lib/log";

export interface Health {
  status: "ok" | "error";
  db: "up" | "down";
}

/** A hung database must not hang the health check: past this, it counts as down. */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

export async function checkHealth(): Promise<Health> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), HEALTH_DB_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
    if (result === "timeout") {
      log.error("Health check: database timed out", {
        timeoutMs: HEALTH_DB_TIMEOUT_MS,
      });
      return { status: "error", db: "down" };
    }
    return { status: "ok", db: "up" };
  } catch (error) {
    // The name only: a driver error can carry the connection string.
    log.error("Health check: database unreachable", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return { status: "error", db: "down" };
  } finally {
    clearTimeout(timer);
  }
}
