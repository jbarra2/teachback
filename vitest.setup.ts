// Setup for the `unit-dom` project (jsdom): jest-dom matchers, and a clean DOM after each test.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
