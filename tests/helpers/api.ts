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
import { db } from "@/lib/db";

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
 * API, which skips the sign-in rate limit, so a test can create as many users as it needs. Throws
 * if the email already has an account (the default email is unique).
 */
export async function createUser(
  overrides: Partial<Pick<TestUser, "name" | "email" | "password">> = {},
): Promise<TestUser> {
  const name = overrides.name ?? "Test User";
  const email =
    overrides.email ?? `user-${randomUUID().slice(0, 8)}@example.test`;
  const password = overrides.password ?? "correct-horse-battery";
  const signUp = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  // With autoSignIn off, a taken address gets a stand-in user rather than an error, and signing in
  // would then return the old account. Tables are emptied per file, not per test.
  const stored = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  if (stored?.id !== signUp.user.id)
    throw new Error(
      `createUser: ${email} already has an account in this test file. Use a different email.`,
    );
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

  async call(
    handler: RouteHandler,
    { method = "GET", url, params = {}, body, form, headers = {} }: CallOptions,
  ): Promise<Response> {
    // Header names are case-insensitive, so a test's "Content-Type" replaces the default.
    const merged = new Headers(this.headers);
    for (const [name, value] of Object.entries(headers))
      merged.set(name, value);
    const target = new URL(url, appOrigin());
    const init: RequestInit = { method, headers: merged };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      if (!merged.has("content-type"))
        merged.set("content-type", "application/json");
    } else if (form !== undefined) init.body = toFormData(form);
    let request = new Request(target, init);
    // A browser sends Content-Length with every body (withApi refuses an oversized one from the
    // header, before the session check). Request doesn't add it, so count the encoded bytes,
    // multipart boundary included. A length the test set itself is kept.
    if (init.body !== undefined && !merged.has("content-length")) {
      const bytes = await request.arrayBuffer();
      const sent = new Headers(request.headers);
      sent.set("content-length", String(bytes.byteLength));
      request = new Request(target, { method, headers: sent, body: bytes });
    }
    return handler(request, {
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
