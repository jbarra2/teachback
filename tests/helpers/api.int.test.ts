import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { as, createUser } from "./api";
import { withApi } from "@/lib/api/with-api";

// createUser against the real database (T07). Tables are emptied per file, not per test, and with
// autoSignIn off Better Auth answers a taken address with a stand-in user instead of an error, so
// the helper has to notice that itself.
describe("createUser", () => {
  it("creates the account it returns, with a session that works", async () => {
    const ada = await createUser({
      name: "Ada",
      email: "ada-helper@example.test",
    });
    const stored = await db.user.findUniqueOrThrow({ where: { id: ada.id } });
    expect(stored).toMatchObject({
      name: "Ada",
      email: "ada-helper@example.test",
    });
    const whoAmI = withApi(({ user }) => Response.json({ id: user?.id }));
    const res = await as(ada).call(whoAmI, { url: "/api/courses" });
    expect(await res.json()).toEqual({ id: ada.id });
  });

  it("refuses an address that already has an account, instead of signing into it", async () => {
    await createUser({ name: "First", email: "taken@example.test" });
    await expect(
      createUser({ name: "Second", email: "taken@example.test" }),
    ).rejects.toThrow(/taken@example\.test already has an account/);
    expect(
      await db.user.count({ where: { email: "taken@example.test" } }),
    ).toBe(1);
  });
});
