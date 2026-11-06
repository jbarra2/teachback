// /api/auth/* (T06). Better Auth mounts about thirty endpoints, each a way to change an account; the
// app uses four. Everything else is a 404 before Better Auth or the database sees it (Better Auth
// writes a rate-limit row even for unknown paths). The four get the app's own checks first:
// withApi's Origin and size rules, strict bodies (Better Auth accepts any extra field and stores some,
// such as an `image` of any size), and only the values that were checked go on to Better Auth.
// Tokens are stripped from response bodies: the httpOnly cookie is the only place a session lives.
import { isIP } from "node:net";
import { z } from "zod";
import { CLIENT_IP_HEADER, readAuthEnv } from "@/lib/auth-env";
import { SignInBody, SignUpBody } from "@/lib/schemas";
import { ApiError } from "./errors";
import type { SessionUser } from "./session";
import { withApi, type ApiContext } from "./with-api";

const BASE_PATH = "/api/auth";
/** Auth bodies are a few hundred bytes. */
const AUTH_MAX_BODY_BYTES = 8 * 1024;

const SignOutBody = z.object({}).strict();

/** The endpoints the app uses (T15's client): "METHOD /path" → its body schema, or null for none. */
const ENDPOINTS: Record<string, z.ZodType | null> = {
  "POST /sign-up/email": SignUpBody,
  "POST /sign-in/email": SignInBody,
  "POST /sign-out": SignOutBody,
  "GET /get-session": null,
};

/** The trusted header gave no IP in production: a proxy misconfiguration (logged by name, a 500). */
class ClientIpMissing extends Error {
  override name = "ClientIpMissing";
}

interface AuthHandler {
  handler: (request: Request) => Promise<Response>;
}

/**
 * The client's IP from the one header the host's proxy sets or overwrites (TRUSTED_IP_HEADER), or
 * null. In a list, the last entry is the one the proxy appended; earlier ones came from the client.
 */
function clientIp(
  headers: Headers,
  trustedHeader: string | undefined,
): string | null {
  if (!trustedHeader) return null;
  const last = headers.get(trustedHeader)?.split(",").at(-1)?.trim();
  return last && isIP(last) ? last : null;
}

/** Drops every key ending in "token" (token, accessToken, ...), at any depth. */
function stripTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTokens);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token$/i.test(key))
        .map(([key, item]) => [key, stripTokens(item)]),
    );
  return value;
}

async function cleanResponse(
  key: string,
  response: Response,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const retryAfter = headers.get("x-retry-after");
  if (response.status === 429 && retryAfter)
    headers.set("retry-after", retryAfter);
  // With autoSignIn off, Better Auth answers an existing email with a stand-in user, but its fields
  // differ from a real new user's (an extra `image: null`, another order), which gives the account
  // away. Every successful sign-up gets the same fixed body; the form signs in next (T15).
  if (key === "POST /sign-up/email" && response.status === 200) {
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers,
    });
  }
  if (!headers.get("content-type")?.toLowerCase().includes("application/json"))
    return new Response(response.body, { status: response.status, headers });
  const body = JSON.stringify(stripTokens(await response.json()));
  headers.delete("content-length");
  return new Response(body, { status: response.status, headers });
}

async function checkedBody(
  { json }: ApiContext<unknown, SessionUser | null>,
  schema: z.ZodType,
): Promise<unknown> {
  // Sign-out may come with no body at all; the others need one.
  const body = await json({ optional: schema === SignOutBody });
  return body === undefined ? undefined : schema.parse(body);
}

export function createAuthRoute(auth: AuthHandler) {
  async function handle(
    context: ApiContext<unknown, SessionUser | null>,
  ): Promise<Response> {
    const { request } = context;
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${BASE_PATH}/`))
      throw new ApiError("NOT_FOUND");
    const key = `${request.method} ${url.pathname.slice(BASE_PATH.length)}`;
    if (!Object.hasOwn(ENDPOINTS, key)) throw new ApiError("NOT_FOUND");
    const schema = ENDPOINTS[key];
    const body = schema ? await checkedBody(context, schema) : undefined;

    // Query options (callbackURL, disableRefresh, ...) aren't part of what the app uses.
    url.search = "";
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete(CLIENT_IP_HEADER);
    const ip = clientIp(request.headers, readAuthEnv().trustedIpHeader);
    // Without an IP, Better Auth counts every client in one shared bucket, so one client could keep
    // everyone out of sign-in. Behind the host's proxy every request has one; refuse any that doesn't.
    if (!ip && process.env.NODE_ENV === "production")
      throw new ClientIpMissing();
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    if (body !== undefined) headers.set("content-type", "application/json");

    const forwarded = new Request(url, {
      method: request.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return cleanResponse(key, await auth.handler(forwarded));
  }

  const route = withApi(handle, {
    auth: false,
    maxBodyBytes: AUTH_MAX_BODY_BYTES,
  });
  return { GET: route, POST: route };
}
