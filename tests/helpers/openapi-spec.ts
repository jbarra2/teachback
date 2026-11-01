// Reads openapi/openapi.yaml for contract tests (T03) and the response checks T07 adds.
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { repoRoot } from "./temp-dirs";

export const SPEC_PATH = path.join(repoRoot, "openapi", "openapi.yaml");

/** The parts of a JSON Schema the contract tests read. */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  contentMediaType?: string;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
}

export interface Example {
  value: unknown;
}
export interface MediaType {
  schema?: Schema;
  example?: unknown;
  examples?: Record<string, Example>;
}
export interface Header {
  $ref?: string;
  required?: boolean;
  schema?: Schema;
}
export interface ResponseObject {
  $ref?: string;
  description?: string;
  headers?: Record<string, Header>;
  content?: Record<string, MediaType>;
}
export interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Schema;
  example?: unknown;
}
export interface Operation {
  operationId?: string;
  security?: unknown[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, ResponseObject>;
  "x-rate-limit"?: string;
}
export type PathItem = { parameters?: Parameter[] } & Partial<
  Record<HttpMethod, Operation>
>;
export interface SecurityScheme {
  type?: string;
  in?: string;
  name?: string;
}
export interface Spec {
  openapi: string;
  info: { title: string; version: string; description: string };
  security?: unknown[];
  paths: Record<string, PathItem>;
  components: {
    securitySchemes: Record<string, SecurityScheme>;
    schemas: Record<string, Schema>;
    parameters: Record<string, Parameter>;
    responses: Record<string, ResponseObject>;
    headers: Record<string, Header>;
  };
}

/** Every method OpenAPI allows in a path item, so no operation is invisible to the tests. */
export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function loadSpec(): Spec {
  return load(readFileSync(SPEC_PATH, "utf8")) as Spec;
}

/** Follows a local `$ref` ("#/components/schemas/Id") until it reaches the object itself. */
export function deref<T extends { $ref?: string }>(spec: Spec, value: T): T {
  let current: T = value;
  for (let hops = 0; current.$ref !== undefined; hops++) {
    if (hops > 20) throw new Error(`$ref loop at ${current.$ref}`);
    if (!current.$ref.startsWith("#/"))
      throw new Error(`Only local $refs are allowed: ${current.$ref}`);
    let target: unknown = spec;
    for (const key of current.$ref.slice(2).split("/"))
      target = (target as Record<string, unknown> | undefined)?.[key];
    if (target === undefined)
      throw new Error(`$ref points nowhere: ${current.$ref}`);
    current = target as T;
  }
  return current;
}

export interface OperationEntry {
  method: HttpMethod;
  path: string;
  operation: Operation;
  /** Path-level and operation-level parameters, resolved. */
  parameters: Parameter[];
}

/** Every operation in the spec, with its method, path and resolved parameters. */
export function operations(spec: Spec): OperationEntry[] {
  return Object.entries(spec.paths).flatMap(([p, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      if (!operation) return [];
      const parameters = [
        ...(item.parameters ?? []),
        ...(operation.parameters ?? []),
      ].map((param) => deref(spec, param));
      return [{ method, path: p, operation, parameters }];
    }),
  );
}

/** Every example of a media type: `example`, then each of `examples`. */
export function examplesOf(media: MediaType): unknown[] {
  return [
    ...(media.example === undefined ? [] : [media.example]),
    ...Object.values(media.examples ?? {}).map((e) => e.value),
  ];
}
