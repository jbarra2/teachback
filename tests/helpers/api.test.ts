import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, asAnonymous, crossSite, fromOrigin, type TestUser } from "./api";

// The callers build the Request a browser would send. An echo handler reports what arrived, so a
// test that uses `fromOrigin` or `params` gets what it asked for. No database: createUser is
// covered by the integration tests.
vi.mock("@/lib/auth", () => ({ auth: {} }));

const ORIGIN = "https://teachback.example.test";
const ADA: TestUser = {
  id: "u1",
  name: "Ada",
  email: "ada@example.test",
  password: "pw",
  cookie: "better-auth.session_token=abc.def",
};

async function echo(request: Request, { params }: { params: Promise<never> }) {
  const type = request.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (type.startsWith("application/json")) body = await request.json();
  else if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    body = Object.fromEntries(
      await Promise.all(
        [...form].map(async ([name, value]) => [
          name,
          typeof value === "string"
            ? value
            : `file:${value.name}:${await value.text()}`,
        ]),
      ),
    );
  }
  return Response.json({
    method: request.method,
    url: request.url,
    origin: request.headers.get("origin"),
    cookie: request.headers.get("cookie"),
    site: request.headers.get("sec-fetch-site"),
    type,
    extra: request.headers.get("x-extra"),
    params: await (params as Promise<Record<string, string>>),
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", `${ORIGIN}/`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const seen = async (res: Response) =>
  (await res.json()) as Record<string, unknown>;

describe("test callers", () => {
  it("as(user) sends their session cookie from the app's own origin", async () => {
    const got = await seen(await as(ADA).call(echo, { url: "/api/courses" }));
    expect(got).toMatchObject({
      method: "GET",
      url: `${ORIGIN}/api/courses`,
      origin: ORIGIN,
      cookie: ADA.cookie,
      site: null,
      params: {},
      body: null,
    });
  });

  it("asAnonymous sends no cookie, same-origin", async () => {
    const got = await seen(
      await asAnonymous().call(echo, { url: "/api/courses" }),
    );
    expect(got).toMatchObject({ origin: ORIGIN, cookie: null, site: null });
  });

  it("fromOrigin replaces the Origin and keeps the session", async () => {
    const signedIn = await seen(
      await as(ADA)
        .fromOrigin("https://evil.example")
        .call(echo, { url: "/api/courses" }),
    );
    expect(signedIn).toMatchObject({
      origin: "https://evil.example",
      cookie: ADA.cookie,
    });
    const anonymous = await seen(
      await fromOrigin("https://evil.example").call(echo, {
        url: "/api/courses",
      }),
    );
    expect(anonymous).toMatchObject({
      origin: "https://evil.example",
      cookie: null,
    });
  });

  it("crossSite marks the request cross-site and keeps the rest", async () => {
    const signedIn = await seen(
      await as(ADA).crossSite().call(echo, { url: "/api/courses" }),
    );
    expect(signedIn).toMatchObject({
      site: "cross-site",
      origin: ORIGIN,
      cookie: ADA.cookie,
    });
    const anonymous = await seen(
      await crossSite().call(echo, { url: "/api/courses" }),
    );
    expect(anonymous).toMatchObject({ site: "cross-site", cookie: null });
  });

  it("sends the method asked for, and Next's dynamic segments as a Promise", async () => {
    const got = await seen(
      await as(ADA).call(echo, {
        method: "DELETE",
        url: "/api/courses/c1",
        params: { id: "c1" },
      }),
    );
    expect(got).toMatchObject({ method: "DELETE", body: null });
    expect(got.params).toEqual({ id: "c1" });
  });

  it("sends `body` as JSON with its content type", async () => {
    const got = await seen(
      await as(ADA).call(echo, {
        method: "POST",
        url: "/api/courses",
        body: { name: "Bio" },
      }),
    );
    expect(got).toMatchObject({
      method: "POST",
      type: "application/json",
      body: { name: "Bio" },
    });
  });

  it("sends `form` as multipart, from a plain object or a FormData", async () => {
    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    const fromObject = await seen(
      await as(ADA).call(echo, {
        method: "POST",
        url: "/api/x",
        form: { title: "Week 1", file },
      }),
    );
    expect(fromObject.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(fromObject.body).toEqual({
      title: "Week 1",
      file: "file:notes.md:# Notes",
    });

    const data = new FormData();
    data.append("title", "Week 2");
    const fromFormData = await seen(
      await as(ADA).call(echo, { method: "POST", url: "/api/x", form: data }),
    );
    expect(fromFormData.body).toEqual({ title: "Week 2" });
  });

  it("lets a test add headers or override the defaults", async () => {
    const got = await seen(
      await as(ADA).call(echo, {
        method: "POST",
        url: "/api/x",
        body: "not json",
        headers: {
          "x-extra": "1",
          "content-type": "text/plain",
          origin: "null",
        },
      }),
    );
    expect(got).toMatchObject({
      extra: "1",
      type: "text/plain",
      origin: "null",
      body: null,
    });
  });

  // Header names are case-insensitive: an override in any case replaces the default, never joins it.
  it("overrides a default whatever the case of the header name", async () => {
    const got = await seen(
      await as(ADA).call(echo, {
        method: "POST",
        url: "/api/x",
        body: "not json",
        headers: { "Content-Type": "text/plain", Origin: "null" },
      }),
    );
    expect(got).toMatchObject({ type: "text/plain", origin: "null" });
  });
});
