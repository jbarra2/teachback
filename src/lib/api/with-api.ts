// Every API route is wrapped in withApi() (PLAN §4): auth (401) · Origin check (403) · body limit
// (413) · rate limit (429) · zod (400) · safe errors (500 + request id) · Cache-Control: private,
// no-store · security headers and a locked-down CSP. Handlers only parse, call one service and return contract-shaped JSON.
// Everything is read from the Request itself, so tests call a route's exported GET/POST with a
// constructed Request.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authEnvProblems, readAuthEnv } from "@/lib/auth-env";
import { LIMITS } from "@/lib/schemas";
import { log } from "@/lib/log";
import { checkRateLimit, type RateLimitBucket } from "@/lib/rate-limit";
import { checkContentLength, readJsonBody } from "./body";
import { ApiError, errorResponse, validationError } from "./errors";
import { isCrossSiteRequest } from "./origin";
import { API_CSP, applySecurityHeaders } from "./security-headers";
import { readSession, type SessionUser } from "./session";

/**
 * What a handler gets. `U` is the user's type: withApi picks `SessionUser` for routes that need a
 * session (the default) and `SessionUser | null` for `auth: false`, or when `auth` is only known
 * as a boolean.
 */
export interface ApiContext<P, U extends SessionUser | null = SessionUser> {
  request: Request;
  params: P;
  requestId: string;
  /** The signed-in user. Null only on routes with `auth: false`. */
  user: U;
  /**
   * The body as JSON, within the route's size limit (Content-Type must be application/json).
   * With `optional`, an empty body (Next gives every POST a stream) is `undefined` instead of a 400.
   */
  json: (options?: { optional?: boolean }) => Promise<unknown>;
}

export interface WithApiOptions {
  /** Require a session (default). Only /api/health, /api/auth/*, /api/openapi and /api/docs don't. */
  auth?: boolean;
  /** The limit this route counts against (429 past it). Needs auth: the limits are per user. */
  rateLimit?: RateLimitBucket;
  /** Default 64 KB (PLAN §7). */
  maxBodyBytes?: number;
}

type Handler<P, U extends SessionUser | null> = (
  context: ApiContext<P, U>,
) => Promise<Response> | Response;
type Segment<P> = { params?: Promise<P> };

/** A copy with headers we can set: Response.redirect() and fetched responses have immutable ones. */
function mutable(response: Response): Response {
  return new Response(response.body, response);
}

function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Response {
  const headers = { "x-request-id": requestId };
  if (error instanceof ApiError) return errorResponse(error, headers);
  if (error instanceof z.ZodError)
    return errorResponse(validationError(error), headers);
  log.error("Request failed", {
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return errorResponse(new ApiError("INTERNAL"), headers);
}

/**
 * Marks a withApi handler with its options, so the route coverage test can tell one from a raw
 * handler and check that `auth` and `rateLimit` match what openapi.yaml says about the operation.
 */
const WITH_API = Symbol.for("teachback.withApi");

/** The options a withApi handler is marked with. */
export interface WithApiMark {
  auth: boolean;
  rateLimit?: RateLimitBucket;
}

/** What a withApi handler was built with, or null for anything else. */
export function withApiOptions(value: unknown): WithApiMark | null {
  if (typeof value !== "function") return null;
  const mark = (value as unknown as Record<symbol, unknown>)[WITH_API];
  return typeof mark === "object" && mark !== null
    ? (mark as WithApiMark)
    : null;
}

export function isWithApiHandler(value: unknown): boolean {
  return withApiOptions(value) !== null;
}

type ApiRoute<P> = ((
  request: Request,
  segment?: Segment<P>,
) => Promise<Response>) & { [WITH_API]: WithApiMark };

/** Routes that need a session (the default): withApi answers 401 before the handler runs. */
export function withApi<P = Record<string, never>>(
  handler: Handler<P, SessionUser>,
  options?: WithApiOptions & { auth?: true },
): ApiRoute<P>;
/** `auth: false`, or `auth` only known as a boolean: the handler must handle a null user. */
export function withApi<P = Record<string, never>>(
  handler: Handler<P, SessionUser | null>,
  options: WithApiOptions,
): ApiRoute<P>;
export function withApi<P>(
  handler: Handler<P, SessionUser> | Handler<P, SessionUser | null>,
  options: WithApiOptions = {},
): ApiRoute<P> {
  const {
    auth = true,
    rateLimit,
    maxBodyBytes = LIMITS.jsonBodyBytes,
  } = options;
  if (rateLimit && !auth)
    throw new Error(
      "withApi: a rateLimit route needs auth, to count per user.",
    );
  // The overloads tie the handler's user type to `auth`, which TypeScript can't follow in here.
  // A handler typed for a non-null user only comes with auth on, and then a missing session has
  // already thrown 401 below, so it never gets null.
  const run = handler as Handler<P, SessionUser | null>;

  const respond = async (
    request: Request,
    segment: Segment<P>,
  ): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const problems = authEnvProblems();
      if (problems.length > 0) {
        // The messages name the settings, never their values.
        log.error(`Auth isn't configured safely: ${problems.join(" ")}`, {
          requestId,
        });
        throw new ApiError("INTERNAL");
      }
      // The app's origin comes from configuration, never from the request (Host is the client's).
      const appOrigin = readAuthEnv().appOrigin ?? new URL(request.url).origin;
      if (isCrossSiteRequest(request, appOrigin))
        throw new ApiError("FORBIDDEN_ORIGIN");
      checkContentLength(request, maxBodyBytes);

      const session = auth ? await readSession(request) : null;
      if (auth && !session) throw new ApiError("UNAUTHENTICATED");
      // Counted only once the request is known to be signed in and same-site, before the handler
      // reads the body or calls anything that costs money.
      if (rateLimit && session) {
        const limited = await checkRateLimit(session.user.id, rateLimit);
        if (!limited.allowed)
          throw new ApiError("RATE_LIMITED", undefined, undefined, {
            retryAfter: limited.retryAfter,
          });
      }

      const params = (await segment.params) ?? ({} as P);
      const response = mutable(
        await run({
          request,
          params,
          requestId,
          user: session?.user ?? null,
          json: (jsonOptions) =>
            readJsonBody(request, maxBodyBytes, jsonOptions),
        }),
      );
      for (const cookie of session?.setCookies ?? [])
        response.headers.append("set-cookie", cookie);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
  const route = async (
    request: Request,
    segment: Segment<P> = {},
  ): Promise<Response> => {
    const response = await respond(request, segment);
    // API answers can be per user, even on routes without a session check (Better Auth's
    // get-session), so no browser or shared cache may keep or reuse any of them, errors included,
    // whatever the handler set.
    response.headers.set("Cache-Control", "private, no-store");
    applySecurityHeaders(response.headers);
    // A route that serves its own page (the API docs) sets the CSP that page needs.
    if (!response.headers.has("Content-Security-Policy"))
      response.headers.set("Content-Security-Policy", API_CSP);
    return response;
  };

  return Object.assign(route, { [WITH_API]: { auth, rateLimit } });
}
