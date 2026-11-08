import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type ApiClientOptions,
  createApiClient,
  redirectToLogin,
  unwrap,
} from "./client";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "./errors";
import { rejection } from "./test-helpers";

const BASE = "http://test.local";

/** A browser `window.location` at this page, whose `assign` records navigations. */
function stubLocation(pathname: string, search = "") {
  const assign = vi.fn();
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:3000", pathname, search, assign },
  });
  return assign;
}

function clientWith(respond: (request: Request) => Promise<Response>) {
  const onUnauthenticated = vi.fn();
  const network = vi.fn(respond);
  const api = createApiClient({
    baseUrl: BASE,
    fetch: network,
    onUnauthenticated,
  });
  return { api, network, onUnauthenticated };
}

const course = {
  id: "ccourse000000000000000001",
  name: "BIOL 180",
  createdAt: "2026-11-01T09:15:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("unwrap", () => {
  it("returns the data of a successful call", async () => {
    const { api, network } = clientWith(async () => Response.json([course]));
    expect(await unwrap(api.GET("/api/courses"))).toEqual([course]);
    const request = network.mock.calls[0]![0];
    expect(request.url).toBe(`${BASE}/api/courses`);
  });

  it("returns null data as null", async () => {
    const { api } = clientWith(async () => Response.json(null));
    const params = { params: { path: { id: course.id } } };
    expect(
      await unwrap(api.GET("/api/courses/{id}/next-concept", params)),
    ).toBeNull();
  });

  it("throws the contract's error", async () => {
    const { api } = clientWith(async () =>
      Response.json(
        { error: { code: "RATE_LIMITED", message: "Slow down a little." } },
        { status: 429, headers: { "retry-after": "30" } },
      ),
    );
    const error = await rejection(
      unwrap(api.POST("/api/courses", { body: { name: "x" } })),
    );
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      message: "Slow down a little.",
    });
  });

  it("throws a generic INTERNAL for a non-JSON error page", async () => {
    const { api } = clientWith(
      async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    const error = await rejection(unwrap(api.GET("/api/courses")));
    expect(error).toMatchObject({
      code: "INTERNAL",
      status: 502,
      message: GENERIC_MESSAGE,
    });
  });

  it("throws a generic INTERNAL for an empty error response", async () => {
    const { api } = clientWith(async () => new Response(null, { status: 500 }));
    expect(await rejection(unwrap(api.GET("/api/courses")))).toMatchObject({
      code: "INTERNAL",
      status: 500,
    });
  });

  it("throws NETWORK_ERROR when the request fails, keeping the cause", async () => {
    const failure = new TypeError("Failed to fetch");
    const { api } = clientWith(async () => {
      throw failure;
    });
    const error = await rejection(unwrap(api.GET("/api/courses")));
    expect(error).toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
      message: NETWORK_MESSAGE,
    });
    expect(error.cause).toBe(failure);
  });

  it("keeps the parse error as the cause of a malformed success body", async () => {
    const { api } = clientWith(
      async () =>
        new Response("{not json", {
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await rejection(unwrap(api.GET("/api/courses")));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toBe(NETWORK_MESSAGE);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it("rethrows an aborted request unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const { api } = clientWith(async () => {
      throw abort;
    });
    await expect(unwrap(api.GET("/api/courses"))).rejects.toBe(abort);
  });
});

describe("createApiClient defaults", () => {
  const unauthenticated = async () =>
    Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Please sign in." } },
      { status: 401 },
    );

  it("redirects to /login on a 401 without being told how", async () => {
    const assign = stubLocation("/courses/abc");
    const api = createApiClient({ baseUrl: BASE, fetch: unauthenticated });
    await rejection(unwrap(api.GET("/api/courses")));
    expect(assign).toHaveBeenCalledOnce();
    const url = assign.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/courses/abc");
  });

  it("uses the global fetch when none is given", async () => {
    const globalFetch = vi.fn<(request: Request) => Promise<Response>>(
      async () => Response.json([course]),
    );
    vi.stubGlobal("fetch", globalFetch);
    const api = createApiClient({ baseUrl: BASE });
    expect(await unwrap(api.GET("/api/courses"))).toEqual([course]);
    expect(globalFetch).toHaveBeenCalledOnce();
  });
});

// T28: the old per-endpoint mock switch is gone, so nothing can stand in for the real API.
describe("no mock layer", () => {
  it("sends every request to the network, even with the old mock variable set", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENDPOINTS", "courses,answer");
    const network = vi.fn<(request: Request) => Promise<Response>>(async () =>
      Response.json([course]),
    );
    const api = createApiClient({ baseUrl: BASE, fetch: network });
    await unwrap(api.GET("/api/courses"));
    await api.POST("/api/questions/{id}/answer", {
      params: { path: { id: "cquestion0000000000000001" } },
      body: { answer: "Water follows the solute." },
    });
    expect(network).toHaveBeenCalledTimes(2);
    const [first, second] = network.mock.calls.map(([request]) => request);
    expect(new URL(first!.url).pathname).toBe("/api/courses");
    expect(second!.method).toBe("POST");
  });

  it("surfaces a network failure instead of falling back to fake data", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENDPOINTS", "courses");
    const api = createApiClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const error = await rejection(unwrap(api.GET("/api/courses")));
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("has no option to turn mocks on (checked by tsc)", () => {
    expectTypeOf<ApiClientOptions>().not.toHaveProperty("mocks");
    expectTypeOf<ApiClientOptions>().not.toHaveProperty("mockDelayMs");
  });
});

describe("401 handling", () => {
  it("calls onUnauthenticated and still throws UNAUTHENTICATED", async () => {
    const { api, onUnauthenticated } = clientWith(async () =>
      Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Please sign in." } },
        { status: 401 },
      ),
    );
    const error = await rejection(unwrap(api.GET("/api/courses")));
    expect(error).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it.each([400, 403, 404, 429, 500])(
    "doesn't redirect on %i",
    async (status) => {
      const { api, onUnauthenticated } = clientWith(async () =>
        Response.json(
          { error: { code: "NOT_FOUND", message: "Not found." } },
          { status },
        ),
      );
      await rejection(unwrap(api.GET("/api/courses")));
      expect(onUnauthenticated).not.toHaveBeenCalled();
    },
  );
});

describe("redirectToLogin", () => {
  it("goes to /login, coming back to the current page", () => {
    const assign = stubLocation("/courses/abc", "?tab=map");
    redirectToLogin();
    const url = assign.mock.calls[0]![0] as URL;
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/courses/abc?tab=map");
  });

  it.each(["/login", "/signup", "/login/reset"])("stays put on %s", (page) => {
    const assign = stubLocation(page);
    redirectToLogin();
    expect(assign).not.toHaveBeenCalled();
  });

  it("still redirects from a page that only starts with the same letters", () => {
    const assign = stubLocation("/loginhelp");
    redirectToLogin();
    expect(assign).toHaveBeenCalledOnce();
  });
});
