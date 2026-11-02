import { getSchema } from "better-auth/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  requiredColumns,
  schemaSql,
  tableBody,
} from "../../tests/helpers/schema-sql";

// auth.ts builds Better Auth (and the db client) when it's first imported, so each test stubs the
// environment and imports it afresh. Nothing here may connect, so the database URL points at a
// closed port: an accidental query fails loudly instead of reaching a developer's database. A cold
// import of Better Auth and the Prisma client can pass Vitest's 5 s default on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const GOOD_SECRET = "a-random-test-secret-that-is-long-enough-0123";
const NO_DATABASE = "postgresql://nobody:none@127.0.0.1:9/none";
// A value no env file uses, so a hard-coded URL can't pass.
const BASE_URL = "https://teachback.example.test";

async function loadAuth(env: Record<string, string> = {}) {
  vi.stubEnv("DATABASE_URL", NO_DATABASE);
  vi.stubEnv("BETTER_AUTH_SECRET", GOOD_SECRET);
  vi.stubEnv("BETTER_AUTH_URL", BASE_URL);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return (await import("./auth")).auth;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).teachbackDb;
});

describe("auth", () => {
  it("refuses to start without a usable secret", async () => {
    await expect(
      loadAuth({ BETTER_AUTH_SECRET: "replace-me" }),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  // Better Auth reads BETTER_AUTH_SECRETS itself and prefers it to `secret`, so auth.ts must check
  // the real environment, not a copy of one variable.
  it("refuses to start when BETTER_AUTH_SECRETS is set, even with a good secret", async () => {
    await expect(
      loadAuth({
        BETTER_AUTH_SECRETS: "1:better-auth-secret-12345678901234567890",
      }),
    ).rejects.toThrow(/BETTER_AUTH_SECRETS/);
  });

  // The padded value proves auth.ts hands Better Auth the checked (trimmed) secret: left alone,
  // Better Auth would read the raw variable itself.
  it("signs with the checked secret and uses the configured base URL", async () => {
    const auth = await loadAuth({ BETTER_AUTH_SECRET: `  ${GOOD_SECRET}\n` });
    const context = await auth.$context;
    expect(context.secret).toBe(GOOD_SECRET);
    expect(context.baseURL).toBe(`${BASE_URL}/api/auth`);
    expect(auth.options.baseURL).toBe(BASE_URL);
  });

  // PLAN §1: email + password accounts. The limits match the T05 forms (8–128).
  it("enables email and password sign-in with 8–128 character passwords", async () => {
    const auth = await loadAuth();
    expect(auth.options.emailAndPassword).toEqual({
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    });
  });

  // TESTING §6, no partial writes: sign-up's user and account inserts run in one Prisma
  // transaction. db.$transaction is stubbed, so nothing connects.
  it("runs Better Auth's writes in a real database transaction", async () => {
    const auth = await loadAuth();
    const { db } = await import("./db");
    const transaction = vi
      .spyOn(db, "$transaction")
      .mockImplementation((async (fn: (tx: unknown) => unknown) =>
        fn(db)) as never);
    const context = await auth.$context;
    await expect(context.adapter.transaction(async () => "done")).resolves.toBe(
      "done",
    );
    expect(transaction).toHaveBeenCalledOnce();
  });

  // The adapter's provider decides PostgreSQL features: arrays, UUIDs, case-insensitive matching.
  it("uses the Prisma adapter for PostgreSQL", async () => {
    const auth = await loadAuth();
    const { adapter } = await auth.$context;
    expect(adapter.id).toBe("prisma");
    expect(adapter.options?.adapterConfig).toMatchObject({
      supportsArrays: true,
      supportsUUIDs: true,
    });
  });

  it("sends no telemetry", async () => {
    const auth = await loadAuth();
    expect(auth.options.telemetry).toEqual({ enabled: false });
  });

  // If a plugin or option adds a table or a field (T06 turns on database rate limiting), these fail
  // until the models are regenerated with Better Auth's CLI and a migration is added.
  it("has a Prisma model, with every field, for each table Better Auth uses", async () => {
    const auth = await loadAuth();
    const models = Object.keys(Prisma.ModelName);
    const tables = Object.entries(getSchema(auth.options));
    expect(tables.map(([table]) => table).sort()).toEqual(
      expect.arrayContaining(["account", "session", "user", "verification"]),
    );
    for (const [table, { fields }] of tables) {
      const model = table[0]!.toUpperCase() + table.slice(1);
      expect(models).toContain(model);
      const columns = Object.keys(
        (Prisma as unknown as Record<string, Record<string, string>>)[
          `${model}ScalarFieldEnum`
        ] ?? {},
      );
      for (const [name, field] of Object.entries(fields))
        expect(columns).toContain(field.fieldName ?? name);
    }
  });

  // A NOT NULL column with no default that Better Auth doesn't fill in breaks every sign-up insert.
  // Better Auth's own check can't see this: Prisma 7's generated data model doesn't say which
  // fields are required. The schema's SQL does.
  // Better Auth leaves out an optional field it has no value for (sign-up has no `image`), so only
  // required fields and fields with a default are always written.
  it("has no required column in its tables that Better Auth doesn't always write", async () => {
    const auth = await loadAuth();
    const sql = schemaSql();
    for (const [table, { fields }] of Object.entries(getSchema(auth.options))) {
      const alwaysWritten = [
        "id",
        ...Object.entries(fields)
          .filter(
            ([, f]) => f.required !== false || f.defaultValue !== undefined,
          )
          .map(([name, f]) => f.fieldName ?? name),
      ];
      const required = requiredColumns(sql, table);
      expect(required, table).toContain("id");
      for (const column of required)
        expect(alwaysWritten, `${table}.${column}`).toContain(column);
    }
  });

  // Each auth column has the type Better Auth stores in it, and is NOT NULL exactly when Better
  // Auth declares the field required.
  it("gives every auth column Better Auth's type and NULL rule", async () => {
    const auth = await loadAuth();
    const sql = schemaSql();
    const SQL_TYPE: Record<string, string> = {
      string: "TEXT",
      boolean: "BOOLEAN",
      date: "TIMESTAMP(3)",
      number: "INTEGER",
    };
    let checked = 0;
    for (const [table, { fields }] of Object.entries(getSchema(auth.options))) {
      const body = tableBody(sql, table);
      for (const [name, field] of Object.entries(fields)) {
        const column = field.fieldName ?? name;
        const line = new RegExp(`^\\s*"${column}" ([^\\n]*?),?$`, "m").exec(
          body,
        )?.[1];
        const where = `${table}.${column}`;
        expect(line, where).toBeDefined();
        expect(
          line!.startsWith(`${SQL_TYPE[String(field.type)]} `) ||
            line === SQL_TYPE[String(field.type)],
          where,
        ).toBe(true);
        expect(/ NOT NULL/.test(` ${line}`), where).toBe(
          field.required !== false,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  // Sign-up's user and account inserts happen inside the adapter's transaction: a failing
  // transaction fails the sign-up. Nothing connects; $transaction is stubbed.
  it("signs up inside the database transaction", async () => {
    const auth = await loadAuth();
    const { db } = await import("./db");
    const sentinel = new Error("transaction opened");
    vi.spyOn(db, "$transaction").mockRejectedValue(sentinel as never);
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "Ada",
          email: "ada@example.test",
          password: "correct horse",
        },
      }),
    ).rejects.toBe(sentinel);
  });

  // The 8–128 limits are enforced before any query (the user lookup comes after them).
  it.each([
    ["7 characters", "x".repeat(7), "PASSWORD_TOO_SHORT"],
    ["129 characters", "x".repeat(129), "PASSWORD_TOO_LONG"],
  ])("refuses a %s password at sign-up", async (_label, password, code) => {
    const auth = await loadAuth();
    const { db } = await import("./db");
    vi.spyOn(db, "$transaction").mockImplementation((async (
      fn: (tx: unknown) => unknown,
    ) => fn(db)) as never);
    await expect(
      auth.api.signUpEmail({
        body: { name: "Ada", email: "ada@example.test", password },
      }),
    ).rejects.toMatchObject({ body: { code } });
  });

  // Better Auth's own check against the generated client: missing tables and columns.
  it("passes Better Auth's schema check against the generated client", async () => {
    const auth = await loadAuth();
    const context = await auth.$context;
    expect(context.explicitSchemaCheck).toBeTypeOf("function");
    await expect(context.explicitSchemaCheck!()).resolves.toBeUndefined();
  });
});
