// The client's fetch: enabled endpoints are answered by the mocks after a short delay, the rest
// go to the real API untouched.
import type { MockKey } from "./config";
import { createMockRoutes, matchRoute } from "./handlers";

/** Roughly what a real round trip feels like, so loading states get exercised. */
export const MOCK_DELAY_MS = 300;

export interface MockFetchOptions {
  enabled: ReadonlySet<MockKey>;
  fetch?: (request: Request) => Promise<Response>;
  delayMs?: number;
}

export function createMockFetch({
  enabled,
  fetch: realFetch = (request) => globalThis.fetch(request),
  delayMs = MOCK_DELAY_MS,
}: MockFetchOptions): (request: Request) => Promise<Response> {
  if (enabled.size === 0) return realFetch;
  const routes = createMockRoutes();
  return async (request) => {
    const match = matchRoute(routes, request);
    if (!match || !enabled.has(match.route.key)) return realFetch(request);
    // openapi-fetch leaves the signal to fetch, so an aborted request must never reach a handler.
    await delay(delayMs, request.signal);
    return match.route.handle(request, match.params);
  };
}

/** Waits `ms`, or rejects with the signal's reason (an AbortError) as soon as it aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
