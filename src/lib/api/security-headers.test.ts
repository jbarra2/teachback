import { describe, expect, it } from "vitest";
import {
  API_CSP,
  applySecurityHeaders,
  createNonce,
  docsCsp,
  pageCsp,
  securityHeaders,
} from "./security-headers";

/** A CSP's directives as a map, e.g. "script-src" → ["'self'", "'nonce-…'"]. */
function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

describe("securityHeaders", () => {
  it("sets nosniff, the referrer policy, a permissions policy and frame denial", () => {
    const headers = new Map(securityHeaders({ NODE_ENV: "development" }));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("adds HSTS only in production", () => {
    expect(
      new Map(securityHeaders({ NODE_ENV: "production" })).get(
        "Strict-Transport-Security",
      ),
    ).toBe("max-age=63072000; includeSubDomains");
    for (const NODE_ENV of ["development", "test", undefined])
      expect(
        new Map(securityHeaders({ NODE_ENV })).has("Strict-Transport-Security"),
      ).toBe(false);
  });

  it("applySecurityHeaders sets each one on a Headers object", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { NODE_ENV: "production" });
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("strict-transport-security")).toMatch(/max-age=/);
  });
});

describe("createNonce", () => {
  it("is base64 of 16 random bytes, new every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });
});

describe("pageCsp", () => {
  const nonce = "bm9uY2Vub25jZW5vbmNlMQ==";

  it("allows scripts only with the request's nonce (and what they load), never inline or eval in production", () => {
    const csp = directives(pageCsp(nonce, { NODE_ENV: "production" }));
    expect(csp.get("script-src")).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
    ]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
    expect(pageCsp(nonce, { NODE_ENV: "production" })).not.toMatch(
      /unsafe-eval|\*|https?:/,
    );
    // Style attributes need 'unsafe-inline'; scripts never get it.
    expect(csp.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("adds 'unsafe-eval' only in development, where React needs it for error stacks", () => {
    expect(
      directives(pageCsp(nonce, { NODE_ENV: "development" })).get("script-src"),
    ).toContain("'unsafe-eval'");
    expect(pageCsp(nonce, { NODE_ENV: "test" })).not.toMatch(/unsafe-eval/);
  });

  it("doesn't upgrade requests outside production, where the app runs on http://localhost", () => {
    expect(
      directives(pageCsp(nonce, { NODE_ENV: "development" })).has(
        "upgrade-insecure-requests",
      ),
    ).toBe(false);
  });

  it("never allows the docs page's CDN", () => {
    expect(pageCsp(nonce, { NODE_ENV: "production" })).not.toMatch(/jsdelivr/);
  });
});

describe("API_CSP", () => {
  it("lets an API response load and frame nothing", () => {
    const csp = directives(API_CSP);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("docsCsp", () => {
  const nonce = "ZG9jc25vbmNlZG9jc25vbmNl";
  const bundle =
    "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.2.3/dist/browser/standalone.js";

  it("allows the one pinned bundle URL and the nonce, nothing else from the CDN", () => {
    const csp = directives(docsCsp(nonce, bundle));
    expect(csp.get("script-src")).toEqual([`'nonce-${nonce}'`, bundle]);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'none'"]);
    expect(docsCsp(nonce, bundle)).not.toMatch(/cdn\.jsdelivr\.net[;\s]|\*/);
  });

  it("refuses a bundle URL that isn't one exact https file", () => {
    for (const bad of [
      "https://cdn.jsdelivr.net/",
      "https://cdn.jsdelivr.net",
      "http://cdn.jsdelivr.net/npm/x.js",
      "https://cdn.jsdelivr.net/npm/x.js; script-src *",
      "https://cdn.jsdelivr.net/npm/x.js 'unsafe-inline'",
    ])
      expect(() => docsCsp(nonce, bad)).toThrow();
  });
});
