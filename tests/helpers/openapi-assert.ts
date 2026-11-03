// `expectMatchesOpenApi(response, "GET /api/courses/{id}")`: the response's status must be one the
// operation documents, its JSON body must match that response's schema (Ajv, JSON Schema 2020-12,
// formats checked), and every header the spec marks required must be there and valid. Returns the
// parsed body. Every integration test runs its responses through this (TESTING §3, S7).
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { deref, loadSpec, type Spec } from "./openapi-spec";

const spec: Spec = loadSpec();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
// OpenAPI's annotation inside schemas; not a JSON Schema keyword.
ajv.addKeyword("example");
// The OpenAPI document's own top-level keys, so the whole spec can be added for $refs to resolve
// into. Strict mode still applies to every schema that is compiled.
ajv.addVocabulary([
  "openapi",
  "info",
  "servers",
  "paths",
  "components",
  "security",
  "tags",
  "externalDocs",
  "webhooks",
  "jsonSchemaDialect",
]);
// The whole spec, so a schema's `#/components/...` references resolve inside it.
ajv.addSchema({ ...spec, $id: "openapi" } as object, "openapi");

const validators = new Map<string, ValidateFunction>();
/** A validator for the JSON Schema at this JSON Pointer in openapi.yaml. */
function validatorAt(pointer: string): ValidateFunction {
  let validate = validators.get(pointer);
  if (!validate) {
    validate = ajv.compile({ $ref: `openapi#${pointer}` });
    validators.set(pointer, validate);
  }
  return validate;
}

const escape = (segment: string) =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema?: unknown }>;
  headers?: Record<
    string,
    { $ref?: string; required?: boolean; schema?: unknown }
  >;
}

/** The documented response for a status, and the JSON Pointer of the object that holds it. */
function documentedResponse(
  key: string,
  status: number,
): { pointer: string; response: ResponseObject } {
  const [method, path] = key.split(" ");
  const operation = (
    spec.paths[path] as
      Record<string, { responses?: Record<string, ResponseObject> }> | undefined
  )?.[method.toLowerCase()];
  if (!operation) throw new Error(`openapi.yaml has no operation "${key}".`);
  const responses = operation.responses ?? {};
  const code = [String(status), `${String(status)[0]}XX`, "default"].find(
    (c) => c in responses,
  );
  if (!code)
    throw new Error(
      `Status ${status} isn't documented for ${key} (documented: ${Object.keys(responses).join(", ")}).`,
    );
  let pointer = `/paths/${escape(path)}/${method.toLowerCase()}/responses/${code}`;
  let response = responses[code];
  // Follow a reference to components.responses, keeping the pointer in step.
  while (response.$ref) {
    pointer = response.$ref.slice(1);
    response = deref(spec, response);
  }
  return { pointer, response };
}

export async function expectMatchesOpenApi(
  res: Response,
  key: string,
): Promise<unknown> {
  const { pointer, response } = documentedResponse(key, res.status);
  const problems: string[] = [];

  for (const [name, header] of Object.entries(response.headers ?? {})) {
    const resolved = deref(spec, header);
    const value = res.headers.get(name);
    if (value === null) {
      if (resolved.required)
        problems.push(`required header ${name} is missing`);
      continue;
    }
    const headerPointer = header.$ref
      ? `${header.$ref.slice(1)}/schema`
      : `${pointer}/headers/${escape(name)}/schema`;
    const schema = deref(spec, resolved).schema as
      { type?: string } | undefined;
    const parsed =
      schema?.type === "integer" || schema?.type === "number"
        ? Number(value)
        : value;
    const validate = validatorAt(headerPointer);
    if (!validate(parsed))
      problems.push(
        `header ${name}=${JSON.stringify(value)}: ${ajv.errorsText(validate.errors)}`,
      );
  }

  let body: unknown = undefined;
  // Every documented media type counts, not only JSON: a YAML or HTML response must carry its own.
  const documented = Object.keys(response.content ?? {});
  const type = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (documented.length === 0) {
    // Documented without a body (a 204, say): any body at all is a mismatch.
    const text = await res.clone().text();
    if (text.length > 0)
      problems.push(`expected no body, got ${text.length} characters`);
  } else if (!documented.includes(type))
    problems.push(
      `expected content-type ${documented.join(" or ")}, got "${type}"`,
    );
  else if (type === "application/json") {
    body = await res.clone().json();
    const validate = validatorAt(`${pointer}/content/application~1json/schema`);
    if (!validate(body))
      problems.push(`body: ${ajv.errorsText(validate.errors)}`);
  }

  if (problems.length)
    throw new Error(
      `${res.status} response doesn't match ${key}:\n- ${problems.join("\n- ")}`,
    );
  return body;
}
