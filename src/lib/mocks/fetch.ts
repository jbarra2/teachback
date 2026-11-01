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
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return match.route.handle(request, match.params);
  };
}
