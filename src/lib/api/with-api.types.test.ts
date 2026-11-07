// Type-level checks: `npm run typecheck` fails if a handler's `user` has the wrong type. The
// runtime side (no session means 401 before the handler runs) is in with-api.test.ts.
import { describe, expectTypeOf, it } from "vitest";
import type { SessionUser } from "./session";
import { withApi, type ApiContext } from "./with-api";

const ok = () => new Response(null, { status: 204 });

describe("withApi handler types", () => {
  it("gives a non-null user by default", () => {
    withApi(({ user }) => {
      expectTypeOf(user).toEqualTypeOf<SessionUser>();
      return ok();
    });
  });

  it("gives a non-null user with auth: true or other options", () => {
    withApi(
      ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<SessionUser>();
        return ok();
      },
      { auth: true },
    );
    withApi(
      ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<SessionUser>();
        return ok();
      },
      { rateLimit: "ai", maxBodyBytes: 1024 },
    );
  });

  it("keeps route params typed alongside the non-null user", () => {
    withApi<{ id: string }>(({ user, params }) => {
      expectTypeOf(user).toEqualTypeOf<SessionUser>();
      expectTypeOf(params).toEqualTypeOf<{ id: string }>();
      return ok();
    });
  });

  it("gives a nullable user with auth: false", () => {
    withApi(
      ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<SessionUser | null>();
        return ok();
      },
      { auth: false },
    );
  });

  it("gives a nullable user when auth is only known as a boolean", () => {
    const options: { auth: boolean } = { auth: false };
    withApi(({ user }) => {
      expectTypeOf(user).toEqualTypeOf<SessionUser | null>();
      return ok();
    }, options);
  });

  it("refuses a handler that needs a user on a route that may have none", () => {
    type NeedsUser = (context: ApiContext<unknown>) => Response;
    type Accepts<O> = typeof withApi extends (
      handler: NeedsUser,
      options: O,
    ) => unknown
      ? true
      : false;
    expectTypeOf<Accepts<{ auth: false }>>().toEqualTypeOf<false>();
    expectTypeOf<Accepts<{ auth: boolean }>>().toEqualTypeOf<false>();
    // The same check accepts it where a session is required, so the refusals above aren't vacuous.
    expectTypeOf<Accepts<{ auth: true }>>().toEqualTypeOf<true>();
    expectTypeOf<Accepts<{ rateLimit: "ai" }>>().toEqualTypeOf<true>();
  });

  it("defaults ApiContext's user to SessionUser", () => {
    expectTypeOf<ApiContext<unknown>["user"]>().toEqualTypeOf<SessionUser>();
    expectTypeOf<
      ApiContext<unknown, SessionUser | null>["user"]
    >().toEqualTypeOf<SessionUser | null>();
  });
});
