import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deref,
  examplesOf,
  loadSpec,
  operations,
  type Schema,
} from "../helpers/openapi-spec";
import { repoRoot } from "../helpers/temp-dirs";
import { LIMITS } from "@/lib/schemas";

// What Redocly's lint can't check: that openapi.yaml says what docs/PLAN.md and the security
// matrix (docs/TESTING.md §3) say, and that every schema is closed and capped. The docs are read
// here rather than copied, so changing one without the other fails.
const spec = loadSpec();
const ops = operations(spec);
const read = (file: string) =>
  readFileSync(path.join(repoRoot, file), "utf8").replace(/\r\n/g, "\n");
const PLAN = read("docs/PLAN.md");
const TESTING = read("docs/TESTING.md");
const section = (doc: string, from: string, to: string) => {
  const start = doc.indexOf(from);
  expect(start, `"${from}" in the docs`).toBeGreaterThan(-1);
  return doc.slice(start, doc.indexOf(to, start));
};
const PLAN_6 = section(PLAN, "## §6 ", "## §7 ");
const PLAN_7 = section(PLAN, "## §7 ", "## §8 ");
const PLAN_8 = section(PLAN, "## §8 ", "## §9 ");
const tableRows = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
const ticked = (cell: string) =>
  [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const key = (method: string, p: string) => `${method.toUpperCase()} ${p}`;
const schemas = spec.components.schemas;

// PLAN §7's endpoint table: | Method | Path | Request | Success | Notes |
const planEndpoints = tableRows(PLAN_7)
  .filter(([method]) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(method))
  .flatMap(([method, paths, , success, notes]) =>
    ticked(paths).map((p) => ({
      key: key(method, p),
      rateLimit: /rate limit `(\w+)`/.exec(notes)?.[1],
      // "201 `Course`", "202 `{ id, status }`"; no status means 200.
      success: /^(\d{3}) /.exec(success)?.[1] ?? "200",
      docsOnly: /API_DOCS_ENABLED=true/.test(notes),
    })),
  );
const planEndpoint = (method: string, p: string) =>
  planEndpoints.find((e) => e.key === key(method, p));

// PLAN §7's error table: | Code | Status |
const planErrorStatus = Object.fromEntries(
  tableRows(PLAN_7)
    .filter(([code, status]) => /^[A-Z_]+$/.test(code) && /^\d{3}/.test(status))
    .map(([code, status]) => [code, status.slice(0, 3)]),
);

/** Every schema reachable from `root`, with $refs followed once each. */
function reachable(root: Schema): Schema[] {
  const found: Schema[] = [];
  const seenRefs = new Set<string>();
  const visit = (node: Schema | boolean | undefined) => {
    if (node === undefined || typeof node === "boolean") return;
    if (node.$ref !== undefined) {
      if (seenRefs.has(node.$ref)) return;
      seenRefs.add(node.$ref);
      return visit(deref(spec, node));
    }
    found.push(node);
    for (const child of Object.values(node.properties ?? {})) visit(child);
    visit(node.items);
    visit(node.additionalProperties);
    for (const list of [node.oneOf, node.anyOf, node.allOf])
      for (const child of list ?? []) visit(child);
  };
  visit(root);
  return found;
}

/** Every schema in the document: components and everything inline under paths. */
function allSchemas(): Schema[] {
  const roots: Schema[] = [...Object.values(schemas)];
  for (const { operation, parameters } of ops) {
    for (const p of parameters) if (p.schema) roots.push(p.schema);
    for (const media of Object.values(operation.requestBody?.content ?? {}))
      if (media.schema) roots.push(media.schema);
    for (const response of Object.values(operation.responses))
      for (const media of Object.values(deref(spec, response).content ?? {}))
        if (media.schema) roots.push(media.schema);
  }
  return roots.flatMap(reachable);
}

describe("openapi.yaml documents exactly PLAN §7", () => {
  it("is OpenAPI 3.1 and needs the session cookie unless an operation says otherwise", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.security).toEqual([{ sessionCookie: [] }]);
  });

  it("has an operation for every endpoint in the table, and nothing else", () => {
    expect(planEndpoints.length).toBeGreaterThan(10);
    // The notes column was read: the docs rows say they exist only when API_DOCS_ENABLED=true.
    expect(
      planEndpoints
        .filter((e) => e.docsOnly)
        .map((e) => e.key)
        .sort(),
    ).toEqual(["GET /api/docs", "GET /api/openapi"]);
    expect(ops.map((o) => key(o.method, o.path)).sort()).toEqual(
      planEndpoints.map((e) => e.key).sort(),
    );
  });

  it("answers each endpoint's success with the table's status (201, 202, else 200)", () => {
    const fromSpec = Object.fromEntries(
      ops.map((o) => [
        key(o.method, o.path),
        Object.keys(o.operation.responses).find((s) => s.startsWith("2")),
      ]),
    );
    expect(fromSpec).toEqual(
      Object.fromEntries(planEndpoints.map((e) => [e.key, e.success])),
    );
    expect(Object.values(fromSpec)).toContain("201");
    expect(Object.values(fromSpec)).toContain("202");
  });

  it("uses PLAN §7's error shape: { error: { code, message, details? } }", () => {
    const shape = /\*\*Errors:\*\* `\{ "error": \{ ([^}]*) \} \}`/.exec(
      PLAN_7,
    )?.[1];
    const fields = [...(shape ?? "").matchAll(/"(\w+)"(\?)?/g)];
    expect(fields.length).toBe(3);
    const body = schemas.ErrorResponse;
    expect(body.required).toEqual(["error"]);
    const error = body.properties?.error ?? {};
    expect(Object.keys(error.properties ?? {})).toEqual(
      fields.map((m) => m[1]),
    );
    expect(error.required).toEqual(
      fields.filter((m) => !m[2]).map((m) => m[1]),
    );
    expect(error.properties?.code.$ref).toBe("#/components/schemas/ErrorCode");
    expect(error.properties?.details.$ref).toBe(
      "#/components/schemas/ValidationDetails",
    );
    expect(schemas.ValidationDetails.required).toEqual([
      "formErrors",
      "fieldErrors",
    ]);
  });

  it("uses the Better Auth session cookie as its security scheme", () => {
    const scheme = spec.components.securitySchemes.sessionCookie;
    expect(Object.keys(spec.components.securitySchemes)).toEqual([
      "sessionCookie",
    ]);
    expect([scheme.type, scheme.in, scheme.name]).toEqual([
      "apiKey",
      "cookie",
      "better-auth.session_token",
    ]);
  });

  it("rate-limits the operations the table rate-limits, with the same bucket", () => {
    const fromSpec = Object.fromEntries(
      ops.map((o) => [key(o.method, o.path), o.operation["x-rate-limit"]]),
    );
    expect(fromSpec).toEqual(
      Object.fromEntries(planEndpoints.map((e) => [e.key, e.rateLimit])),
    );
  });

  it("has the error codes of the error table", () => {
    expect(Object.keys(planErrorStatus).length).toBe(10);
    expect(schemas.ErrorCode.enum?.slice().sort()).toEqual(
      Object.keys(planErrorStatus).sort(),
    );
  });

  const limits = Object.fromEntries(
    tableRows(section(PLAN_7, "**Limits:**", "**Errors:**")).map(
      ([field, limit]) => [field, limit],
    ),
  );
  const numbers = (cell: string) =>
    (cell.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

  it("has the limits of the limits table", () => {
    const range = (cell: string) =>
      /^(\d+)–(\d+) chars$/.exec(cell)?.slice(1).map(Number);
    const text = (name: string) => [
      schemas[name].minLength,
      schemas[name].maxLength,
    ];
    expect(text("CourseName")).toEqual(range(limits["Course `name`"]));
    expect(text("DocumentTitle")).toEqual(range(limits["Document `title`"]));
    expect(text("AnswerText")).toEqual(range(limits["`answer`"]));
    const noteChars = Number(
      /\(([\d,]+)\)/.exec(limits["Extracted text"])?.[1].replace(/,/g, ""),
    );
    expect(schemas.NoteText.maxLength).toBe(noteChars);
    // The default the server reads (src/lib/ingest, T10) is the documented one.
    expect(read(".env.example")).toMatch(
      new RegExp(`^MAX_NOTE_CHARS=${noteChars}$`, "m"),
    );
    expect(limits["Ids"]).toBe("cuid format");
    expect(schemas.Id.pattern).toBe("^c[a-z0-9]{24}$");
  });

  it("repeats the limits table in its own description, with the same numbers", () => {
    const described = Object.fromEntries(
      tableRows(
        section(spec.info.description, "**Limits**", "Text fields"),
      ).map(([field, limit]) => [field, limit]),
    );
    const SAME_ROW: Record<string, string> = {
      "Course `name`": "Course `name`",
      "Document `title`": "Document `title`",
      "`answer`": "`answer`",
      Upload: "Upload",
      "Extracted text": "Note text (pasted or extracted)",
      "JSON body": "JSON body",
      "Unknown fields": "Unknown fields",
    };
    for (const [planRow, specRow] of Object.entries(SAME_ROW)) {
      expect(limits[planRow], planRow).toBeDefined();
      expect(numbers(described[specRow] ?? ""), specRow).toEqual(
        numbers(limits[planRow]),
      );
    }
    expect(described["Unknown fields"]).toBe("rejected");
    expect(described["Ids"]).toContain(`\`${schemas.Id.pattern}\``);
    expect(Object.keys(described).sort()).toEqual(
      [...Object.values(SAME_ROW), "Field", "Ids"].sort(),
    );
  });

  it("matches the server's limits: LIMITS in src/lib/schemas and the .env.example defaults", () => {
    expect(LIMITS.courseName).toBe(schemas.CourseName.maxLength);
    expect(LIMITS.documentTitle).toBe(schemas.DocumentTitle.maxLength);
    expect(LIMITS.answer).toBe(schemas.AnswerText.maxLength);
    expect(numbers(limits["JSON body"])).toEqual([64]);
    expect(limits["JSON body"]).toMatch(/ KB$/);
    expect(LIMITS.jsonBodyBytes).toBe(64 * 1024);
    expect(LIMITS.uploadBytes).toBe(numbers(limits["Upload"])[0] * 1024 * 1024);
    expect(LIMITS.noteChars).toBe(schemas.NoteText.maxLength);
    expect(read(".env.example")).toMatch(
      new RegExp(`^MAX_UPLOAD_MB=${numbers(limits["Upload"])[0]}$`, "m"),
    );
  });

  it("uses PLAN §6's enums and §7's mastery states", () => {
    const prismaEnum = (name: string) =>
      new RegExp(`enum ${name}\\s*\\{([^}]*)\\}`)
        .exec(PLAN_6)?.[1]
        .trim()
        .split(/\s+/);
    for (const name of [
      "DocumentStatus",
      "QuestionKind",
      "Verdict",
      "Confidence",
    ])
      expect(schemas[name].enum, name).toEqual(prismaEnum(name));
    const states = /`state` is one of ([^.]*)\./.exec(PLAN_7)?.[1] ?? "";
    expect(schemas.MasteryState.enum).toEqual(ticked(states));
  });

  it("returns PLAN §8's Feedback: the model's fields plus unsupported", () => {
    const modelFields = [
      ...(
        /const ModelFeedback = z\.object\(\{([\s\S]*?)\}\);/.exec(
          PLAN_8,
        )?.[1] ?? ""
      ).matchAll(/^\s+(\w+):/gm),
    ].map((m) => m[1]);
    expect(modelFields.length).toBe(6);
    const feedback = schemas.Feedback;
    expect(Object.keys(feedback.properties ?? {})).toEqual([
      ...modelFields,
      "unsupported",
    ]);
    expect(feedback.required).toEqual([...modelFields, "unsupported"]);
    expect(feedback.properties?.evidence.maxItems).toBe(3);
  });
});

describe("openapi.yaml keeps the shapes later tasks build on", () => {
  it("every question cites at least one note section (T17, T23)", () => {
    expect(schemas.Question.properties?.sources.minItems).toBe(1);
  });

  it("each evidence quote carries its section's label, added by the server (T22, T23)", () => {
    expect(Object.keys(schemas.Evidence.properties ?? {})).toEqual([
      "chunkId",
      "refLabel",
      "quote",
    ]);
    expect(schemas.Evidence.required).toEqual(["chunkId", "quote", "refLabel"]);
  });

  it("a failed document's message is in both the course view and the status poll (T15)", () => {
    for (const name of ["DocumentSummary", "DocumentState"]) {
      expect(schemas[name].properties?.error, name).toEqual(
        expect.objectContaining({ type: "string", minLength: 1 }),
      );
      expect(schemas[name].required, name).not.toContain("error");
    }
  });

  it("an upload requires the course and title; file and text are the either-or pair (T12, T15)", () => {
    expect(schemas.UploadDocumentRequest.required).toEqual([
      "courseId",
      "title",
    ]);
    expect(Object.keys(schemas.UploadDocumentRequest.properties ?? {})).toEqual(
      ["courseId", "title", "file", "text"],
    );
  });

  it("takes no query, header or cookie parameters (S4 and requestSchemas mirror path and body only)", () => {
    // Adding one (pagination, say) must come with a query schema in src/lib/schemas and its tests.
    for (const { operation, parameters } of ops)
      expect(
        parameters.filter((p) => p.in !== "path").map((p) => p.name),
        operation.operationId,
      ).toEqual([]);
  });
});

describe("openapi.yaml follows the security matrix (TESTING §3)", () => {
  // S1's exemptions, minus Better Auth's own routes, which the contract doesn't document.
  const s1Row = tableRows(TESTING).find(([id]) => id === "**S1**");
  const s1Exempt = ticked(s1Row?.[3] ?? "").filter(
    (p) => !p.startsWith("/api/auth"),
  );

  it("is public only where S1 says so", () => {
    expect(s1Exempt.sort()).toEqual([
      "/api/docs",
      "/api/health",
      "/api/openapi",
    ]);
    // Either the global session requirement or none at all: an operation-level list could make
    // the session optional (`[{ sessionCookie: [] }, {}]`) and still look secured.
    for (const { path: p, operation } of ops) {
      if (s1Exempt.includes(p)) expect(operation.security, p).toEqual([]);
      else expect(operation.security, p).toBeUndefined();
    }
  });

  it.each(ops.map((o) => [o.operation.operationId, o] as const))(
    "%s lists the responses its matrix rows produce",
    (_, { method, path: p, operation, parameters }) => {
      const statuses = Object.keys(operation.responses);
      const has = (status: string) => statuses.includes(status);
      const isPublic = operation.security?.length === 0;
      const rateLimit = operation["x-rate-limit"];
      expect(statuses.filter((s) => s.startsWith("2"))).toHaveLength(1);
      expect(has("500"), "500 INTERNAL").toBe(true);
      expect(has("401"), "S1: 401").toBe(!isPublic);
      if (parameters.some((param) => param.in === "path")) {
        expect(has("400"), "S4: 400").toBe(true);
        expect(has("404"), "S2: 404").toBe(true);
      }
      // S2 also covers an id in the body ("every route with an id or courseId").
      const media = Object.values(operation.requestBody?.content ?? {})[0];
      const bodyFields = media?.schema
        ? Object.keys(deref(spec, media.schema).properties ?? {})
        : [];
      if (bodyFields.some((name) => /Id$/.test(name)))
        expect(has("404"), "S2: 404 for an id in the body").toBe(true);
      // The docs routes answer 404 while API_DOCS_ENABLED is off.
      if (planEndpoint(method, p)?.docsOnly)
        expect(has("404"), "404 while the docs are off").toBe(true);
      if (operation.requestBody) {
        expect(operation.requestBody.required).toBe(true);
        expect(has("400"), "S4: 400").toBe(true);
      }
      const mutating = method !== "get";
      expect(has("403"), "S3: 403").toBe(mutating);
      expect(has("413"), "S5: 413").toBe(mutating);
      expect(has("429"), "S6: 429").toBe(rateLimit !== undefined);
      expect(has("502"), "S9: 502").toBe(rateLimit === "ai");
      if (rateLimit !== undefined)
        expect(["ai", "upload"]).toContain(rateLimit);
    },
  );

  it("sends the headers PLAN §7 promises: Retry-After on 429, x-request-id on 500", () => {
    const header = (status: string, name: string) =>
      ops
        .filter((o) => o.operation.responses[status])
        .map((o) => {
          const h = deref(spec, o.operation.responses[status]).headers?.[name];
          return h ? deref(spec, h).required : undefined;
        });
    const retryAfter = header("429", "Retry-After");
    expect(retryAfter.length).toBeGreaterThan(0);
    expect(retryAfter.every((required) => required === true)).toBe(true);
    const requestId = header("500", "x-request-id");
    expect(requestId.length).toBe(ops.length);
    expect(requestId.every((required) => required === true)).toBe(true);
  });

  it("answers every error with the shared shape, and each example's code has PLAN §7's status", () => {
    for (const { operation } of ops)
      for (const [status, ref] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;
        if (operation.operationId === "getHealth" && status === "503") continue;
        const json = deref(spec, ref).content?.["application/json"];
        expect(json?.schema?.$ref, `${operation.operationId} ${status}`).toBe(
          "#/components/schemas/ErrorResponse",
        );
        const examples = examplesOf(json ?? {});
        expect(examples.length).toBeGreaterThan(0);
        for (const example of examples) {
          const { code } = (example as { error: { code: string } }).error;
          expect(planErrorStatus[code], `${code} under ${status}`).toBe(status);
        }
      }
  });
});

describe("every error code in PLAN §7 has a documented response", () => {
  it("each code appears in some operation's error examples", () => {
    const used = new Set(
      ops.flatMap(({ operation }) =>
        Object.values(operation.responses).flatMap((ref) =>
          examplesOf(
            deref(spec, ref).content?.["application/json"] ?? {},
          ).flatMap((example) => {
            const code = (example as { error?: { code?: string } } | null)
              ?.error?.code;
            return code ? [code] : [];
          }),
        ),
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(planErrorStatus).sort());
  });
});

describe("openapi.yaml schemas are closed and capped", () => {
  it("rejects unknown fields everywhere: every object is closed or a typed map", () => {
    const objects = allSchemas().filter(
      (s) => s.type === "object" || s.properties !== undefined,
    );
    expect(objects.length).toBeGreaterThan(20);
    for (const s of objects) {
      const extra = s.additionalProperties;
      if (extra === false) continue;
      // A map (ValidationDetails.fieldErrors): no named properties, values of a stated type.
      expect(s.properties, JSON.stringify(s)).toBeUndefined();
      expect(typeof extra, JSON.stringify(s)).toBe("object");
      expect((extra as Schema).type, JSON.stringify(s)).toBeDefined();
    }
  });

  it("caps every string a request can send", () => {
    const strings = ops.flatMap(({ operation, parameters }) => [
      ...parameters.flatMap((p) => (p.schema ? reachable(p.schema) : [])),
      ...Object.values(operation.requestBody?.content ?? {}).flatMap((m) =>
        m.schema ? reachable(m.schema) : [],
      ),
    ]);
    const requestStrings = strings.filter((s) => s.type === "string");
    expect(requestStrings.length).toBeGreaterThan(5);
    // Each is an id, a fixed value, a file, or free text that is capped and can't be blank.
    for (const s of requestStrings) {
      const kind =
        s.pattern === schemas.Id.pattern
          ? "id"
          : s.enum !== undefined || s.const !== undefined
            ? "fixed"
            : s.contentMediaType !== undefined
              ? "file"
              : s.pattern === "\\S" && s.maxLength !== undefined
                ? "text"
                : "uncapped";
      expect(kind, JSON.stringify(s)).not.toBe("uncapped");
    }
    // Files only in multipart bodies.
    for (const { operation } of ops)
      for (const [type, media] of Object.entries(
        operation.requestBody?.content ?? {},
      ))
        if (type !== "multipart/form-data")
          for (const s of media.schema ? reachable(media.schema) : [])
            expect(s.contentMediaType, operation.operationId).toBeUndefined();
  });

  it("uses the cuid Id schema for every id: path parameters and every *Id field", () => {
    const ID = "#/components/schemas/Id";
    for (const { parameters } of ops)
      for (const p of parameters.filter((x) => x.in === "path"))
        expect(p.schema?.$ref, p.name).toBe(ID);
    const idFields = allSchemas().flatMap((s) =>
      Object.entries(s.properties ?? {}).filter(([name]) =>
        /^(id|\w+Id|from|to)$/.test(name),
      ),
    );
    expect(idFields.length).toBeGreaterThan(15);
    for (const [name, field] of idFields) expect(field.$ref, name).toBe(ID);
  });

  it("gives every JSON success response an example", () => {
    let checked = 0;
    for (const { operation } of ops)
      for (const [status, ref] of Object.entries(operation.responses)) {
        const json = deref(spec, ref).content?.["application/json"];
        if (!status.startsWith("2") || !json) continue;
        expect(
          examplesOf(json).length,
          `${operation.operationId} ${status}`,
        ).toBeGreaterThan(0);
        checked++;
      }
    expect(checked).toBeGreaterThanOrEqual(11);
  });

  it("gives every request body and path parameter an example", () => {
    for (const { operation, parameters } of ops) {
      for (const p of parameters)
        expect(p.example, `${operation.operationId} ${p.name}`).toBeDefined();
      for (const media of Object.values(operation.requestBody?.content ?? {}))
        expect(examplesOf(media).length).toBeGreaterThan(0);
    }
  });
});
