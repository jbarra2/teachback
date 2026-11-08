// Security headers on real responses (T29, TESTING §7). This runs under `next dev`, which adds
// 'unsafe-eval' to script-src and leaves out the production-only HSTS and upgrade-insecure-requests;
// the unit tests of src/lib/api/security-headers.ts cover those production values.
import { expect, test } from "playwright/test";
import { IP_HEADER, freshIp } from "./env";
import { apiAs } from "./helpers";

test.use({ extraHTTPHeaders: { [IP_HEADER]: freshIp() } });

const COMMON = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values.join(" ")] as const;
      }),
  );
}

test("pages send a nonce-based CSP and the security headers", async ({
  page,
}) => {
  const res = await page.goto("/login");
  expect(res).not.toBeNull();
  const headers = res!.headers();
  expect(headers).toMatchObject(COMMON);
  expect(headers["permissions-policy"]).toContain("camera=()");

  const csp = directives(headers["content-security-policy"] ?? "");
  const scripts = csp.get("script-src") ?? "";
  expect(scripts).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scripts).toContain("'strict-dynamic'");
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(csp.get("default-src")).toBe("'self'");
  expect(csp.get("object-src")).toBe("'none'");
  expect(csp.get("frame-ancestors")).toBe("'none'");
  expect(csp.get("base-uri")).toBe("'self'");

  // A fresh nonce on every response.
  const again = (await page.goto("/login"))!.headers()[
    "content-security-policy"
  ];
  expect(again).not.toBe(headers["content-security-policy"]);
});

test("API responses send the security headers and are never cached", async () => {
  const api = await apiAs("a");
  try {
    const res = await api.get("/api/courses");
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers).toMatchObject(COMMON);
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["cache-control"]).toContain("private");
  } finally {
    await api.dispose();
  }
});
