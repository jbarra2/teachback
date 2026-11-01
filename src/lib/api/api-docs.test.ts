import { afterEach, describe, expect, it, vi } from "vitest";
import { deref, loadSpec } from "../../../tests/helpers/openapi-spec";
import {
  apiDocsEnabled,
  internalError,
  notFound,
  SCALAR_BUNDLE_INTEGRITY,
  SCALAR_BUNDLE_URL,
  withIntegrity,
} from "./api-docs";

afterEach(() => {
  vi.unstubAllEnvs();
});

const spec = loadSpec();
const exampleOf = (response: string) =>
  deref(spec, spec.components.responses[response]).content?.["application/json"]
    ?.example;

describe("apiDocsEnabled", () => {
  it("is on only for exactly API_DOCS_ENABLED=true", () => {
    vi.stubEnv("API_DOCS_ENABLED", "true");
    expect(apiDocsEnabled()).toBe(true);
  });

  // A production default must fail closed (DEPLOY.md: false unless demoing).
  it.each([
    undefined,
    "",
    "false",
    "TRUE",
    "True",
    "1",
    "yes",
    "on",
    " true",
    "true ",
  ])("is off for %j", (value) => {
    vi.stubEnv("API_DOCS_ENABLED", value);
    expect(apiDocsEnabled()).toBe(false);
  });
});

describe("error responses (the contract's shared shape, S7)", () => {
  it("notFound is the spec's NotFound response", async () => {
    const res = notFound();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual(exampleOf("NotFound"));
  });

  it("internalError is the spec's Internal response, with a fresh request id and no cause", async () => {
    const first = internalError();
    const second = internalError();
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual(exampleOf("Internal"));
    const id = first.headers.get("x-request-id") ?? "";
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.headers.get("x-request-id")).not.toBe(id);
  });
});

describe("withIntegrity (the hash check on Scalar's script tag)", () => {
  const tag = `<script src="${SCALAR_BUNDLE_URL}">`;
  const checked = `<script src="${SCALAR_BUNDLE_URL}" integrity="${SCALAR_BUNDLE_INTEGRITY}" crossorigin="anonymous">`;

  it("adds integrity and crossorigin to the one pinned script tag", () => {
    expect(withIntegrity(`<body>${tag}</script></body>`)).toBe(
      `<body>${checked}</script></body>`,
    );
  });

  it.each([
    ["no tag", "<body></body>"],
    ["the tag twice", `${tag}</script>${tag}</script>`],
    ["another release", tag.replace("@1.76.0", "@1.76.4")],
    [
      "another script as well",
      `${tag}</script><script src="https://cdn.example/x.js"></script>`,
    ],
    [
      "a protocol-relative script",
      `${tag}</script><script src='//cdn.example/x.js'></script>`,
    ],
    [
      "a stylesheet",
      `<link rel="stylesheet" href="https://fonts.example/a.css">${tag}</script>`,
    ],
    [
      "a dynamic import",
      `${tag}</script><script type="module">import("https://esm.example/x.js")</script>`,
    ],
    [
      "a side-effect import",
      `${tag}</script><script type="module">import "https://esm.example/x.js"</script>`,
    ],
    [
      "a CSS url()",
      `<style>body{background:url(https://img.example/a.png)}</style>${tag}</script>`,
    ],
  ])("returns null for %s, so nothing loads unchecked", (_, html) => {
    expect(withIntegrity(html)).toBeNull();
  });

  it("keeps attributes after src, such as a CSP nonce (T14)", () => {
    expect(
      withIntegrity(`<script src="${SCALAR_BUNDLE_URL}" nonce="abc"></script>`),
    ).toBe(
      `<script src="${SCALAR_BUNDLE_URL}" integrity="${SCALAR_BUNDLE_INTEGRITY}" crossorigin="anonymous" nonce="abc"></script>`,
    );
  });
});
