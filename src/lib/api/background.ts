// Work that runs after the response is sent, such as processing an upload (PLAN §4). In the app it
// goes to Next's after(); under test it runs inline, so a test can await it and check the result.
// Never call after() directly: a handler test couldn't wait for the work.
import { after } from "next/server";
import { log } from "@/lib/log";

export function runAfterResponse(
  work: () => Promise<void> | void,
): Promise<void> {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      log.error("Background task failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  };
  if (process.env.NODE_ENV === "test") return run();
  after(run);
  return Promise.resolve();
}
