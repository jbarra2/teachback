// A fake API for tests only (the app always uses the real one, T28). Pass it as the client's
// `fetch`: the endpoints it fakes are answered in memory, in the contract's shapes, and every
// other request goes to the given `fetch`, or is rejected, so a test never reaches the network.
import { createFakeRoutes, matchRoute } from "./handlers";

/** The endpoints the fake can answer (PLAN §7). */
export const FAKE_ENDPOINTS = [
  "courses",
  "documents",
  "concepts",
  "question",
  "answer",
  "map",
  "next",
] as const;

export type FakeEndpoint = (typeof FAKE_ENDPOINTS)[number];

type Fetch = (request: Request) => Promise<Response>;

export interface FakeFetchOptions {
  /** The endpoints to fake. Defaults to all of them. */
  endpoints?: readonly FakeEndpoint[];
  /** Gets every request the fake doesn't answer. Defaults to rejecting it. */
  fetch?: Fetch;
  /** Latency before each fake answer, in ms. Defaults to 0: the next macrotask, like a network. */
  delayMs?: number;
}

const unexpected: Fetch = async (request) => {
  const { pathname } = new URL(request.url);
  throw new Error(
    `The fake API has no answer for ${request.method} ${pathname}`,
  );
};

/** A fetch backed by a fresh in-memory API, so tests don't leak state into each other. */
export function createFakeFetch({
  endpoints = FAKE_ENDPOINTS,
  fetch = unexpected,
  delayMs = 0,
}: FakeFetchOptions = {}): Fetch {
  if (endpoints.length === 0) return fetch;
  const enabled = new Set(endpoints);
  const routes = createFakeRoutes();
  return async (request) => {
    const match = matchRoute(routes, request);
    if (!match || !enabled.has(match.route.endpoint)) return fetch(request);
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
