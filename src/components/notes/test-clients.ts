// API clients for the notes component tests. Not imported by app code.
import { vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { MOCK_KEYS } from "@/lib/mocks/config";

/** Every endpoint answered by src/lib/mocks, with fresh state and no delay. */
export function mockClient() {
  return createApiClient({
    baseUrl: "http://test.local",
    mocks: new Set(MOCK_KEYS),
    mockDelayMs: 0,
    onUnauthenticated: () => {},
  });
}

/** A client whose every request goes to `respond`, with no mocks. */
export function networkClient(
  respond: (request: Request) => Promise<Response>,
) {
  const network = vi.fn(respond);
  const client = createApiClient({
    baseUrl: "http://test.local",
    fetch: network,
    mocks: new Set(),
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
