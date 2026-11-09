// One name for the app under `next dev` (T32, #90): the dev server prints one address, the
// configured BETTER_AUTH_URL may name the other, and cookies and the Origin check only work on the
// configured one. A page opened under the other name opens the same path on the configured one.
// This runs the real dev server, so it also covers what Next does to the proxy's response.
import { expect, test } from "playwright/test";
import { BASE_URL, IP_HEADER, PORT, freshIp } from "./env";

test.use({ extraHTTPHeaders: { [IP_HEADER]: freshIp() } });

const OTHER = `http://localhost:${PORT}`;

test("a page opened on localhost lands on the configured address, same path and query", async ({
  page,
}) => {
  await page.goto(`${OTHER}/login?next=%2Fcourses`);
  await expect(page).toHaveURL(`${BASE_URL}/login?next=%2Fcourses`);
  await expect(page.getByRole("form", { name: "Log in" })).toBeVisible();
});

for (const path of ["//evil.example/x", "/%2F%2Fevil.example/x"])
  test(`a path that looks like another site stays on the configured address (${path})`, async ({
    page,
  }) => {
    await page.goto(`${OTHER}${path}`);
    // Compared as a URL, not a pattern: the same scheme, host and port as the configured address.
    await expect(page).toHaveURL((url) => url.origin === BASE_URL);
    expect(new URL(page.url()).origin).toBe(BASE_URL);
  });
