// The signed-in user for an API request, read from the Request's own headers (never next/headers),
// so handler tests can build a Request and call the handler directly (PLAN §4).

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface ApiSession {
  user: SessionUser;
  /** Set-Cookie values when Better Auth extended the session; withApi passes them on. */
  setCookies: string[];
}

export async function readSession(
  request: Request,
): Promise<ApiSession | null> {
  // Loaded on first use: the instance builds the database client, which routes with `auth: false`
  // (and their tests) never need.
  const { auth } = await import("@/lib/auth");
  const { headers, response } = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  if (!response) return null;
  const { id, email, name } = response.user;
  return { user: { id, email, name }, setCookies: headers.getSetCookie() };
}
