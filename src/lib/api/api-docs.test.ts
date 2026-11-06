import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiDocsEnabled,
  SCALAR_BUNDLE_INTEGRITY,
  SCALAR_BUNDLE_URL,
  withIntegrity,
} from "./api-docs";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiDocsEnabled", () => {
  it("is on only for exactly API_DOCS_ENABLED=true", () => {
    vi.stubEnv("API_DOCS_ENABLED", "true");
    expect(apiDocsEnabled()).toBe(true);
  });

  // The default must fail closed: the docs stay off unless API_DOCS_ENABLED is exactly "true".
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

describe("withIntegrity (the hash check on Scalar's script tag)", () => {
  it('ignores the response\'s own nonce, which can contain "//", when looking for other URLs', () => {
    const nonce = "ab//cd+ef/AAAAAAAAAAAA==";
    const html = `<meta content="${nonce}"><script src="${SCALAR_BUNDLE_URL}" nonce="${nonce}"></script><script nonce="${nonce}">x</script>`;
    expect(withIntegrity(html)).toBeNull();
    expect(withIntegrity(html, nonce)).toContain(
      `integrity="${SCALAR_BUNDLE_INTEGRITY}"`,
    );
  });

  it("still refuses another URL on a page that has a nonce", () => {
    const nonce = "bm9uY2U=";
    const html = `<script src="${SCALAR_BUNDLE_URL}" nonce="${nonce}"></script><script src="https://evil.example/x.js" nonce="${nonce}"></script>`;
    expect(withIntegrity(html, nonce)).toBeNull();
  });

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
