// Call route handlers the way a browser would, for integration tests (T07). Handlers are the
// exported GET/POST functions themselves, called with a constructed Request (PLAN §4):
//
//   const ada = await createUser();
//   const res = await as(ada).call(POST, { method: "POST", url: "/api/courses", body: { name } });
//   await asAnonymous().call(GET, { url: "/api/courses" });              // no session
//   await as(ada).fromOrigin("https://evil.example").call(POST, {...});  // foreign Origin
//   await as(ada).crossSite().call(POST, {...});                         // Sec-Fetch-Site: cross-site
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";

/** The app's own origin: requests are same-origin unless a test says otherwise. */
export const appOrigin = () =>
  new URL(process.env.BETTER_AUTH_URL ?? "").origin;

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  /** `better-auth.session_token=...`, ready for a Cookie header. */
  cookie: string;
}

/**
 * A new account with a real Better Auth session in the test database. Uses Better Auth's server
 * API, which skips the sign-in rate limit, so a test can create as many users as it needs.
 */
export async function createUser(
  overrides: Partial<Pick<TestUser, "name" | "email" | "password">> = {},
): Promise<TestUser> {
  const name = overrides.name ?? "Test User";
  const email =
    overrides.email ?? `user-${randomUUID().slice(0, 8)}@example.test`;
  const password = overrides.password ?? "correct-horse-battery";
  await auth.api.signUpEmail({ body: { name, email, password } });
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .find((c) => c.includes("session_token="))
    ?.split(";")[0];
  if (!cookie)
    throw new Error("Better Auth set no session cookie for the test user.");
  return { id: response.user.id, name, email, password, cookie };
}

// Any route's exported handler, whatever its params (never is assignable to each one's type).
type RouteHandler = (
  request: Request,
  segment: { params: Promise<never> },
) => Promise<Response>;

export interface CallOptions {
  method?: string;
  /** A path such as "/api/courses/c123", resolved against the app's origin. */
  url: string;
  /** Next's dynamic segments, e.g. { id: "c123" } for [id]. */
  params?: Record<string, string>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as multipart/form-data. */
  form?: FormData | Record<string, string | Blob>;
  headers?: Record<string, string>;
}

function toFormData(form: FormData | Record<string, string | Blob>): FormData {
  if (form instanceof FormData) return form;
  const data = new FormData();
  for (const [name, value] of Object.entries(form)) data.append(name, value);
  return data;
}

export class Caller {
  constructor(private readonly headers: Record<string, string>) {}

  /** The same caller, with this Origin header (e.g. another site's). */
  fromOrigin(origin: string): Caller {
    return new Caller({ ...this.headers, origin });
  }

  /** The same caller, marked by the browser as a cross-site request. */
  crossSite(): Caller {
    return new Caller({ ...this.headers, "sec-fetch-site": "cross-site" });
  }

  call(
    handler: RouteHandler,
    { method = "GET", url, params = {}, body, form, headers = {} }: CallOptions,
  ): Promise<Response> {
    // Header names are case-insensitive, so a test's "Content-Type" replaces the default.
    const merged = new Headers(this.headers);
    for (const [name, value] of Object.entries(headers))
      merged.set(name, value);
    const init: RequestInit = { method, headers: merged };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      if (!merged.has("content-type"))
        merged.set("content-type", "application/json");
    } else if (form !== undefined) init.body = toFormData(form);
    return handler(new Request(new URL(url, appOrigin()), init), {
      params: Promise.resolve(params) as Promise<never>,
    });
  }
}

/** Requests from this user's browser: their session cookie, same-origin. */
export const as = (user: TestUser) =>
  new Caller({ cookie: user.cookie, origin: appOrigin() });

/** Requests with no session, same-origin. */
export const asAnonymous = () => new Caller({ origin: appOrigin() });

/** Requests with no session from another site's page. */
export const fromOrigin = (origin: string) => asAnonymous().fromOrigin(origin);

/** Requests with no session that the browser marks cross-site. */
export const crossSite = () => asAnonymous().crossSite();
