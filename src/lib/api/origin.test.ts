import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "./origin";

const APP = "https://teachback.example.test";

function request(method: string, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/courses`, { method, headers });
}

describe("isCrossSiteRequest (PLAN §4 CSRF rule)", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])(
    "refuses %s from a foreign Origin",
    (method) => {
      expect(
        isCrossSiteRequest(
          request(method, { origin: "https://evil.example" }),
          APP,
        ),
      ).toBe(true);
    },
  );

  it("refuses Sec-Fetch-Site: cross-site even with no Origin", () => {
    expect(
      isCrossSiteRequest(
        request("POST", { "sec-fetch-site": "cross-site" }),
        APP,
      ),
    ).toBe(true);
  });

  it("refuses Sec-Fetch-Site: cross-site even when the Origin matches", () => {
    expect(
      isCrossSiteRequest(
        request("POST", { origin: APP, "sec-fetch-site": "cross-site" }),
        APP,
      ),
    ).toBe(true);
  });

  it.each([
    ["the app's own Origin", { origin: APP }],
    [
      "same-origin fetch metadata",
      { origin: APP, "sec-fetch-site": "same-origin" },
    ],
    ["neither header (curl, Postman, tests)", {}],
    [
      "a user-typed request (Sec-Fetch-Site: none)",
      { "sec-fetch-site": "none" },
    ],
  ])("allows a POST with %s", (_name, headers) => {
    expect(isCrossSiteRequest(request("POST", headers), APP)).toBe(false);
  });

  it.each([
    ["Origin: null (sandboxed frame, file:)", "null"],
    ["the same host on another scheme", "http://teachback.example.test"],
    ["the same host on another port", "https://teachback.example.test:8443"],
    ["a subdomain", "https://evil.teachback.example.test"],
    ["a lookalike suffix", "https://teachback.example.test.evil.example"],
  ])("refuses %s", (_name, origin) => {
    expect(isCrossSiteRequest(request("POST", { origin }), APP)).toBe(true);
  });

  it("matches the app origin even if it's configured with a path or trailing slash", () => {
    expect(
      isCrossSiteRequest(request("POST", { origin: APP }), `${APP}/`),
    ).toBe(false);
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "doesn't check safe method %s",
    (method) => {
      expect(
        isCrossSiteRequest(
          request(method, {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          }),
          APP,
        ),
      ).toBe(false);
    },
  );
});
