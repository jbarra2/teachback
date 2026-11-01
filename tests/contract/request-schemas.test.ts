import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { components } from "@/lib/api-client/schema";
import {
  AnswerBody,
  CreateCourseBody,
  ID_PATTERN,
  IdParams,
  requestSchemas,
  UploadDocumentForm,
} from "@/lib/schemas";
import {
  deref,
  examplesOf,
  loadSpec,
  operations,
  type Schema,
} from "../helpers/openapi-spec";

// The zod request schemas (src/lib/schemas) mirror openapi.yaml. Every case below is derived
// from the spec, so a new field or a changed limit is tested without editing this file.
const spec = loadSpec();
const ops = operations(spec);

/** Limits the spec documents that zod deliberately doesn't enforce, and where they are enforced. */
const ENFORCED_ELSEWHERE: Record<string, string> = {
  // TESTING §3: text over MAX_NOTE_CHARS is 413 PAYLOAD_TOO_LARGE (T10's extractText), not 400.
  "uploadDocument.text.maxLength": "413 from extractText",
};

const accepts = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).success;

interface Field {
  op: string;
  kind: "params" | "body";
  name: string;
  schema: Schema;
  required: boolean;
  /** A valid request to vary one field of. */
  base: Record<string, unknown>;
  zod: z.ZodType;
}

/** Every body field and path parameter of every operation, with its zod schema. */
const fields: Field[] = ops.flatMap(({ operation, parameters }) => {
  const op = operation.operationId ?? "";
  const entry = requestSchemas[op as keyof typeof requestSchemas] as {
    body?: z.ZodType;
    params?: z.ZodType;
  };
  const out: Field[] = [];
  const pathParams = parameters.filter((p) => p.in === "path");
  if (entry.params) {
    const base = Object.fromEntries(pathParams.map((p) => [p.name, p.example]));
    for (const p of pathParams)
      out.push({
        op,
        kind: "params",
        name: p.name ?? "",
        schema: deref(spec, p.schema ?? {}),
        required: true,
        base,
        zod: entry.params,
      });
  }
  const media = Object.values(operation.requestBody?.content ?? {})[0];
  if (entry.body && media?.schema) {
    const body = deref(spec, media.schema);
    const base = examplesOf(media)[0] as Record<string, unknown>;
    for (const [name, prop] of Object.entries(body.properties ?? {}))
      out.push({
        op,
        kind: "body",
        name,
        schema: deref(spec, prop),
        required: body.required?.includes(name) ?? false,
        base,
        zod: entry.body,
      });
  }
  return out;
});
const textFields = fields.filter(
  (f) => f.schema.type === "string" && f.schema.contentMediaType === undefined,
);
const capped = textFields.filter(
  (f) =>
    f.schema.maxLength !== undefined &&
    !ENFORCED_ELSEWHERE[`${f.op}.${f.name}.maxLength`],
);
const freeText = textFields.filter((f) => f.schema.pattern === "\\S");
const ids = textFields.filter(
  (f) => f.schema.pattern === spec.components.schemas.Id.pattern,
);
/** One field per (operation, params or body), to test the schema as a whole. */
const groups = [
  ...new Map(fields.map((f) => [`${f.op} ${f.kind}`, f])).values(),
];
const label = (f: Field) => `${f.op} ${f.name}`;
const withField = (f: Field, value: unknown) => ({
  ...f.base,
  [f.name]: value,
});

describe("every operation has its request schemas (src/lib/schemas)", () => {
  it.each(ops.map((o) => [o.operation.operationId ?? "", o] as const))(
    "%s: a body schema iff it has a body, a params schema iff it has path parameters",
    (op, { operation, parameters }) => {
      const entry = requestSchemas[op as keyof typeof requestSchemas] as {
        body?: z.ZodType;
        params?: z.ZodType;
      };
      expect(entry).toBeDefined();
      expect(entry.body !== undefined).toBe(
        operation.requestBody !== undefined,
      );
      expect(entry.params !== undefined).toBe(
        parameters.some((p) => p.in === "path"),
      );
    },
  );

  it("has no entry for an operation the spec doesn't have", () => {
    expect(Object.keys(requestSchemas).sort()).toEqual(
      ops.map((o) => o.operation.operationId).sort(),
    );
  });

  it("covers enough of the spec for the cases below to mean something", () => {
    expect(capped.length).toBeGreaterThanOrEqual(3);
    expect(freeText.length).toBeGreaterThanOrEqual(4);
    expect(ids.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the zod schemas accept what the spec allows", () => {
  it("every request example in the spec parses", () => {
    let checked = 0;
    for (const { operation, parameters } of ops) {
      const entry = requestSchemas[
        operation.operationId as keyof typeof requestSchemas
      ] as { body?: z.ZodType; params?: z.ZodType };
      const pathParams = parameters.filter((p) => p.in === "path");
      if (pathParams.length > 0) {
        const params = Object.fromEntries(
          pathParams.map((p) => [p.name, p.example]),
        );
        expect(entry.params).toBeDefined();
        expect(entry.params?.safeParse(params).error).toBeUndefined();
        checked++;
      }
      for (const media of Object.values(operation.requestBody?.content ?? {}))
        for (const example of examplesOf(media)) {
          expect(entry.body).toBeDefined();
          expect(entry.body?.safeParse(example).error).toBeUndefined();
          checked++;
        }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it.each(capped.map((f) => [label(f), f] as const))(
    "%s: exactly the maximum length is accepted, counted in characters",
    (_, f) => {
      const max = f.schema.maxLength ?? 0;
      expect(accepts(f.zod, withField(f, "a".repeat(max)))).toBe(true);
      // An emoji is one character but two UTF-16 units; PostgreSQL counts characters too.
      expect(accepts(f.zod, withField(f, "😀".repeat(max)))).toBe(true);
      // "e" plus a combining accent is two characters that display as one.
      expect(accepts(f.zod, withField(f, "e\u0301".repeat(max / 2)))).toBe(
        true,
      );
    },
  );

  it.each(freeText.map((f) => [label(f), f] as const))(
    "%s: surrounding whitespace is trimmed, and the trimmed value is what's used",
    (_, f) => {
      // The minimum, exactly: one character, also once padded.
      const min = f.schema.minLength ?? 0;
      expect(min).toBe(1);
      expect(accepts(f.zod, withField(f, "a".repeat(min)))).toBe(true);
      const padded = f.zod.safeParse(withField(f, " a "));
      expect(
        (padded.data as Record<string, unknown> | undefined)?.[f.name],
      ).toBe("a");
      const result = f.zod.safeParse(withField(f, "  \n Cell biology\t "));
      expect(result.error).toBeUndefined();
      expect((result.data as Record<string, unknown>)[f.name]).toBe(
        "Cell biology",
      );
    },
  );

  it("an upload may send a file instead of text", () => {
    const upload = fields.find((f) => f.op === "uploadDocument");
    const { text: _text, ...base } = upload?.base ?? {};
    expect(_text).toBeDefined();
    const file = new File(["Cells are the unit of life."], "week1.txt", {
      type: "text/plain",
    });
    expect(
      UploadDocumentForm.safeParse({ ...base, file }).error,
    ).toBeUndefined();
  });
});

describe("the zod schemas reject what the spec doesn't allow (S4)", () => {
  it.each(capped.map((f) => [label(f), f] as const))(
    "%s: one character over the maximum is rejected",
    (_, f) => {
      const max = f.schema.maxLength ?? 0;
      expect(accepts(f.zod, withField(f, "a".repeat(max + 1)))).toBe(false);
      expect(accepts(f.zod, withField(f, "😀".repeat(max + 1)))).toBe(false);
      // Characters, not what displays: max + 2 code points shown as max / 2 + 1 letters.
      expect(accepts(f.zod, withField(f, "e\u0301".repeat(max / 2 + 1)))).toBe(
        false,
      );
      // Spaces don't count once trimmed, so the limit can't be dodged with padding either way.
      expect(accepts(f.zod, withField(f, ` ${"a".repeat(max)} `))).toBe(true);
    },
  );

  it.each(freeText.map((f) => [label(f), f] as const))(
    "%s: empty, whitespace-only, NUL and broken Unicode are rejected",
    (_, f) => {
      for (const bad of ["", " ", " \n\t ", "  "])
        expect(accepts(f.zod, withField(f, bad)), JSON.stringify(bad)).toBe(
          false,
        );
      // PostgreSQL can't store NUL, and an unpaired surrogate isn't valid UTF-8: both would be 500s.
      expect(accepts(f.zod, withField(f, "Cell\u0000biology"))).toBe(false);
      expect(accepts(f.zod, withField(f, "Cell \ud800 biology"))).toBe(false);
      expect(accepts(f.zod, withField(f, "Cell \udc00 biology"))).toBe(false);
    },
  );

  it.each(ids.map((f) => [label(f), f] as const))(
    "%s: anything but a cuid is rejected",
    (_, f) => {
      const good = String(f.base[f.name]);
      expect(good).toMatch(/^c[a-z0-9]{24}$/);
      for (const bad of [
        "",
        good.slice(0, -1),
        `${good}0`,
        `C${good.slice(1)}`,
        `a${good.slice(1)}`,
        good.replace(/0/, "A"),
        good.replace(/0/, "-"),
        good.replace(/0/, " "),
        good.replace(/0/, "/"),
        good.replace(/0/, "."),
        good.replace(/0/, "_"),
        good.replace(/0/, "é"),
        `${good}\n`,
        "../../etc/passwd",
        "1 OR 1=1",
      ])
        expect(accepts(f.zod, withField(f, bad)), JSON.stringify(bad)).toBe(
          false,
        );
    },
  );

  it.each(textFields.map((f) => [label(f), f] as const))(
    "%s: a value of the wrong type is rejected",
    (_, f) => {
      for (const bad of [42, true, null, ["x"], { value: "x" }])
        expect(accepts(f.zod, withField(f, bad)), JSON.stringify(bad)).toBe(
          false,
        );
    },
  );

  it.each(fields.filter((f) => f.required).map((f) => [label(f), f] as const))(
    "%s: leaving out a required field is rejected",
    (_, f) => {
      const { [f.name]: _dropped, ...rest } = f.base;
      expect(_dropped).toBeDefined();
      expect(accepts(f.zod, rest)).toBe(false);
    },
  );

  it.each(groups.map((f) => [`${f.op} ${f.kind}`, f] as const))(
    "%s: unknown fields are rejected, including __proto__",
    (_, f) => {
      expect(accepts(f.zod, f.base)).toBe(true);
      expect(
        accepts(f.zod, { ...f.base, userId: "cuser00000000000000000001" }),
      ).toBe(false);
      // JSON.parse makes "__proto__" an own key, which a spread would then copy anywhere.
      const polluted = JSON.parse(
        JSON.stringify({ ...f.base }).replace(
          /^\{/,
          '{"__proto__":{"admin":true},',
        ),
      ) as unknown;
      expect(accepts(f.zod, polluted)).toBe(false);
      expect(accepts(f.zod, null)).toBe(false);
      expect(accepts(f.zod, [f.base])).toBe(false);
    },
  );

  it("an upload needs exactly one of file and text, and says which is wrong", () => {
    const file = new File(["notes"], "week1.txt", { type: "text/plain" });
    const base = { courseId: "ccourse000000000000000001", title: "Week 1" };
    const formErrors = (value: unknown) => {
      const result = UploadDocumentForm.safeParse(value);
      return result.error ? z.flattenError(result.error).formErrors : [];
    };
    expect(formErrors(base)).toEqual([
      "Send a file or paste your notes as text.",
    ]);
    expect(formErrors({ ...base, file, text: "notes" })).toEqual([
      "Send either a file or text, not both.",
    ]);
    expect(accepts(UploadDocumentForm, { ...base, file: "week1.txt" })).toBe(
      false,
    );
    expect(accepts(UploadDocumentForm, { ...base, text: "notes" })).toBe(true);
  });

  it("note text over MAX_NOTE_CHARS is left to extractText, which answers 413 (TESTING §3)", () => {
    const max = spec.components.schemas.NoteText.maxLength ?? 0;
    expect(max).toBe(200_000);
    const base = { courseId: "ccourse000000000000000001", title: "Week 1" };
    expect(
      accepts(UploadDocumentForm, { ...base, text: "a".repeat(max + 1) }),
    ).toBe(true);
  });
});

describe("an upload posted by a browser form (multipart, as T12 receives it)", () => {
  // A file input with nothing chosen still sends a part: filename="" and no content.
  async function postForm(
    parts: Record<string, string | { filename: string; content: string }>,
  ) {
    const boundary = "----teachback-test";
    const body = Object.entries(parts)
      .map(([name, value]) =>
        typeof value === "string"
          ? `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
          : `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${value.content}\r\n`,
      )
      .join("")
      .concat(`--${boundary}--\r\n`);
    const form = await new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    }).formData();
    return UploadDocumentForm.safeParse(Object.fromEntries(form));
  }
  const formFields = { courseId: "ccourse000000000000000001", title: "Week 1" };
  const noFileChosen = { filename: "", content: "" };

  it("pasted text with no file chosen is a text upload", async () => {
    const result = await postForm({
      ...formFields,
      file: noFileChosen,
      text: "Cells are alive.",
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.file).toBeUndefined();
    expect(result.data?.text).toBe("Cells are alive.");
  });

  it("a chosen file with an empty text box is a file upload", async () => {
    const result = await postForm({
      ...formFields,
      file: { filename: "week1.txt", content: "Cells are alive." },
      text: "",
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.text).toBeUndefined();
    expect(result.data?.file).toBeInstanceOf(File);
  });

  it("a chosen file with a text box holding only whitespace is a file upload", async () => {
    const result = await postForm({
      ...formFields,
      file: { filename: "week1.txt", content: "Cells are alive." },
      text: "  \n ",
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.text).toBeUndefined();
  });

  it("nothing chosen and nothing typed is rejected", async () => {
    const result = await postForm({
      ...formFields,
      file: noFileChosen,
      text: "",
    });
    expect(z.flattenError(result.error as z.ZodError).formErrors).toEqual([
      "Send a file or paste your notes as text.",
    ]);
  });

  it("a file with content but no name is still a file", async () => {
    const result = await postForm({
      ...formFields,
      file: { filename: "", content: "Cells are alive." },
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.file?.size).toBeGreaterThan(0);
  });

  it("an empty file that has a name is still a file (extractText answers 422)", async () => {
    const result = await postForm({
      ...formFields,
      file: { filename: "empty.txt", content: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.file?.name).toBe("empty.txt");
  });
});

describe("the zod schemas have exactly the spec's fields", () => {
  it("the Id pattern is the spec's", () => {
    expect(ID_PATTERN.source).toBe(spec.components.schemas.Id.pattern);
    expect(ID_PATTERN.flags).toBe("");
  });

  const shapeKeys = (schema: z.ZodType) =>
    Object.keys((schema as z.ZodObject).shape).sort();

  it.each(groups.map((f) => [`${f.op} ${f.kind}`, f] as const))(
    "%s",
    (_, f) => {
      expect(shapeKeys(f.zod)).toEqual(
        fields
          .filter((g) => g.op === f.op && g.kind === f.kind)
          .map((g) => g.name)
          .sort(),
      );
    },
  );
});

describe("a rejection becomes ValidationDetails (T06 sends z.flattenError)", () => {
  it("the spec's error examples show messages zod really sends", () => {
    const example = (response: string, name?: string) => {
      const media = deref(spec, spec.components.responses[response]).content?.[
        "application/json"
      ];
      const value = name ? media?.examples?.[name]?.value : media?.example;
      return (value as { error: { details: z.ZodFlattenedError<unknown> } })
        .error.details;
    };
    const tooLong = CreateCourseBody.safeParse({ name: "a".repeat(121) });
    expect(example("ValidationError")).toEqual(
      z.flattenError(tooLong.error as z.ZodError),
    );
    const both = UploadDocumentForm.safeParse({
      courseId: "ccourse000000000000000001",
      title: "Week 1",
      file: new File(["notes"], "week1.txt"),
      text: "notes",
    });
    expect(example("UploadRejected", "invalid")).toEqual(
      z.flattenError(both.error as z.ZodError),
    );
  });

  it("puts field problems under fieldErrors and unknown fields under formErrors", () => {
    const result = CreateCourseBody.safeParse({
      name: "a".repeat(121),
      owner: "x",
    });
    expect(result.success).toBe(false);
    const details = z.flattenError(result.error as z.ZodError);
    expect(Object.keys(details).sort()).toEqual(["fieldErrors", "formErrors"]);
    expect(details.fieldErrors).toEqual({
      name: ["Must be at most 120 characters."],
    });
    // zod's own wording, kept on purpose: it names the field to remove, and only echoes the
    // client's own key, which the UI renders as text.
    expect(details.formErrors).toEqual(['Unrecognized key: "owner"']);
  });

  it("names the limit in the message, so the UI can show it as is", () => {
    const tooLong = AnswerBody.safeParse({ answer: "a".repeat(4001) });
    expect(z.flattenError(tooLong.error as z.ZodError).fieldErrors).toEqual({
      answer: ["Must be at most 4000 characters."],
    });
    const blank = AnswerBody.safeParse({ answer: "   " });
    expect(z.flattenError(blank.error as z.ZodError).fieldErrors).toEqual({
      answer: ["Can't be empty."],
    });
    const badId = IdParams.safeParse({ id: "nope" });
    expect(z.flattenError(badId.error as z.ZodError).fieldErrors).toEqual({
      id: ["Must be a valid id."],
    });
  });
});

describe("the zod types match the generated client types", () => {
  it("JSON bodies and path parameters", () => {
    type Schemas = components["schemas"];
    expectTypeOf<z.input<typeof CreateCourseBody>>().toEqualTypeOf<
      Schemas["CreateCourseRequest"]
    >();
    expectTypeOf<z.input<typeof AnswerBody>>().toEqualTypeOf<
      Schemas["AnswerRequest"]
    >();
    expectTypeOf<z.input<typeof IdParams>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<keyof z.input<typeof UploadDocumentForm>>().toEqualTypeOf<
      keyof Schemas["UploadDocumentRequest"]
    >();
  });
});
