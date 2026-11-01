// The typed API client (PLAN §4): openapi-fetch over the types generated from openapi.yaml.
// Browser use: requests go to this origin, with the session cookie. Wrap calls in unwrap() to get
// the data or an ApiError.
import createClient, { type Middleware } from "openapi-fetch";
import { enabledMockEndpoints, type MockKey } from "@/lib/mocks/config";
import { createMockFetch } from "@/lib/mocks/fetch";
import { networkError, toApiError } from "./errors";
import type { paths } from "./schema";

/** Pages that must not bounce to /login on a 401, or signing in would loop. */
const AUTH_PAGES = ["/login", "/signup"];

/** Sends the browser to /login, coming back to the current page after sign-in. */
export function redirectToLogin(): void {
  const { pathname, search } = window.location;
  const onAuthPage = AUTH_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );
  if (onAuthPage) return;
  // A full page load on purpose: this runs outside React, and the session is gone.
  const login = new URL("/login", window.location.origin);
  login.searchParams.set("next", pathname + search);
  window.location.assign(login);
}

export interface ApiClientOptions {
  /** Defaults to this page's origin. */
  baseUrl?: string;
  /** The network. Defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>;
  /** Endpoints answered by src/lib/mocks. Defaults to NEXT_PUBLIC_MOCK_ENDPOINTS. */
  mocks?: ReadonlySet<MockKey>;
  /** Called on any 401. Defaults to redirectToLogin. */
  onUnauthenticated?: () => void;
  /** Mock latency in ms (tests use 0). */
  mockDelayMs?: number;
}

export function createApiClient({
  baseUrl = globalThis.location?.origin ?? "",
  fetch,
  mocks = enabledMockEndpoints(),
  onUnauthenticated = redirectToLogin,
  mockDelayMs,
}: ApiClientOptions = {}) {
  const client = createClient<paths>({
    baseUrl,
    fetch: createMockFetch({ enabled: mocks, fetch, delayMs: mockDelayMs }),
  });
  const authRedirect: Middleware = {
    onResponse({ response }) {
      if (response.status === 401) onUnauthenticated();
    },
  };
  client.use(authRedirect);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The app's client. */
export const api = createApiClient();

type Result = { data?: unknown; error?: unknown; response: Response };

/** The success body. `null` stays (next-concept can return it); the error branch's undefined goes. */
type Data<R extends Result> = Exclude<R["data"], undefined>;

/**
 * The data of a successful call, or an ApiError: the contract's code and message for an error
 * response, NETWORK_ERROR when the request never got an answer.
 *
 *   const courses = await unwrap(api.GET("/api/courses"));
 */
export async function unwrap<R extends Result>(
  call: Promise<R>,
): Promise<Data<R>> {
  let result: R;
  try {
    result = await call;
  } catch {
    throw networkError();
  }
  if (result.error !== undefined || !result.response.ok)
    throw toApiError(result.response.status, result.error);
  return result.data as Data<R>;
}
