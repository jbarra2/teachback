import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, redirectToLogin, unwrap } from "./client";
import { ApiError, GENERIC_MESSAGE, NETWORK_MESSAGE } from "./errors";

const BASE = "http://test.local";

function clientWith(respond: (request: Request) => Promise<Response>) {
  const onUnauthenticated = vi.fn();
  const network = vi.fn(respond);
  const api = createApiClient({
    baseUrl: BASE,
    fetch: network,
    mocks: new Set(),
    onUnauthenticated,
  });
  return { api, network, onUnauthenticated };
}

async function rejection(call: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error;
}

const course = {
  id: "ccourse000000000000000001",
  name: "BIOL 180",
  createdAt: "2026-11-01T09:15:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("throws NETWORK_ERROR when the request fails", async () => {
    const { api } = clientWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await rejection(unwrap(api.GET("/api/courses")))).toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
      message: NETWORK_MESSAGE,
    });
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
  function stubLocation(pathname: string, search = "") {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000", pathname, search, assign },
    });
    return assign;
  }

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
