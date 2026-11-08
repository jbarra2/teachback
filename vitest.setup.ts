// Setup for the `unit-dom` project (jsdom): jest-dom matchers, a clean DOM after each test, and no
// real network. A component rendered without a test client falls back to the app's `api`; its
// requests fail loudly instead of reaching whatever server is running. Tests that need fetch pass a
// client built with createFakeFetch() or stub it themselves.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    throw new Error(
      `Unexpected network call in a test: ${request.method} ${pathname}`,
    );
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
