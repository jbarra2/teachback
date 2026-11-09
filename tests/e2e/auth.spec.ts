// Sessions end to end (T29, TESTING §7): signed-out visitors go to /login, and signing out really
// ends the session, for pages and the API alike.
import { expect, test } from "playwright/test";
import { IP_HEADER, PASSWORD, freshIp } from "./env";
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

// T32 (#95): before the page's JavaScript runs, the browser submits the form itself. It must
// never put what was typed in the URL, and the server must answer with a page, not an error.
test.describe("a submit before the page is interactive", () => {
  test.use({
    javaScriptEnabled: false,
    extraHTTPHeaders: { [IP_HEADER]: freshIp() },
  });

  test("keeps the email and password out of the URL", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    const [response] = await Promise.all([
      page.waitForEvent("response", (r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Log in" }).click(),
    ]);
    // The page itself again, not an error page.
    expect(response.status()).toBe(200);
    await expect(page.getByRole("form", { name: "Log in" })).toBeVisible();
    expect(page.url()).not.toContain(PASSWORD);
    for (const url of requests) {
      expect(url).not.toContain(PASSWORD);
      expect(url).not.toContain("nobody%40example.test");
    }
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
