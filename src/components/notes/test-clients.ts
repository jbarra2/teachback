// API clients for the notes component tests. Not imported by app code.
import { vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { createFakeFetch } from "@/lib/api-client/fake-api/fake-fetch";

/** Every endpoint answered by the fake API, with fresh state and no delay. */
export function mockClient() {
  return createApiClient({
    baseUrl: "http://test.local",
    fetch: createFakeFetch(),
    onUnauthenticated: () => {},
  });
}

/** A client whose every request goes to `respond`, with no fake. */
export function networkClient(
  respond: (request: Request) => Promise<Response>,
) {
  const network = vi.fn(respond);
  const client = createApiClient({
    baseUrl: "http://test.local",
    fetch: network,
    onUnauthenticated: () => {},
  });
  return { client, network };
}

/** A contract-shaped error response. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}
