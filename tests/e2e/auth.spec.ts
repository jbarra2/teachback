// Sessions end to end (T29, TESTING §7): signed-out visitors go to /login, and signing out really
// ends the session, for pages and the API alike.
import { expect, test } from "playwright/test";
import { IP_HEADER, freshIp } from "./env";
import { createCourse, newSignedInUser, uniqueName } from "./helpers";

test.describe("signed out", () => {
  test.use({ extraHTTPHeaders: { [IP_HEADER]: freshIp() } });

  for (const target of ["/courses", "/courses/cnotacourse00000000000001/map"]) {
    test(`${target} redirects to /login and keeps where you were going`, async ({
      page,
    }) => {
      await page.goto(target);
      await expect(page).toHaveURL(/\/login(\?|$)/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(target);
      await expect(page.getByRole("form", { name: "Log in" })).toBeVisible();
    });
  }

  test("the API answers 401 without a session", async ({ request }) => {
    const res = await request.get("/api/courses");
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

test("sign out ends the session: back and refresh show no private data, the API answers 401", async ({
  browser,
}) => {
  // Its own user: signing out the shared users would break the other specs.
  const { context } = await newSignedInUser(browser);
  try {
    const page = await context.newPage();
    const course = uniqueName("Private course");
    await createCourse(context.request, course);

    // Two private pages in the history, so "back" after signing out lands on one of them.
    await page.goto("/courses");
    await page.getByRole("link", { name: course }).click();
    await expect(page).toHaveURL(/\/courses\/[^/]+$/);

    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/login(\?|$)|\/$/);

    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByText(course)).toHaveCount(0);

    const res = await context.request.get("/api/courses");
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  } finally {
    await context.close();
  }
});
