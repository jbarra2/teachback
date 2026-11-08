// Cross-user access (T29, TESTING §7): user B opening user A's URLs sees "not found" and none of
// A's data, and the API answers 404, the same as for an id that doesn't exist.
import { expect, test, type APIRequestContext } from "playwright/test";
import {
  apiAs,
  concepts,
  createCourse,
  signedInContext,
  uniqueName,
  uploadReadyNotes,
} from "./helpers";

let apiA: APIRequestContext;
let apiB: APIRequestContext;
let courseId: string;
let courseName: string;
let concept: { id: string; name: string };

test.beforeAll(async () => {
  apiA = await apiAs("a");
  apiB = await apiAs("b");
  courseName = uniqueName("A's private course");
  courseId = await createCourse(apiA, courseName);
  await uploadReadyNotes(apiA, courseId);
  [concept] = await concepts(apiA, courseId);
});

test.afterAll(async () => {
  await apiA?.dispose();
  await apiB?.dispose();
});

test("user B gets not-found on user A's course, practice and map pages", async ({
  browser,
}) => {
  const context = await signedInContext(browser, "b");
  try {
    const page = await context.newPage();

    await page.goto(`/courses/${courseId}`);
    await expect(
      page.getByRole("heading", { name: "Course not found" }),
    ).toBeVisible();

    await page.goto(`/courses/${courseId}/practice`);
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load concepts" }),
    ).toContainText(/not found/i);

    await page.goto(`/courses/${courseId}/practice?concept=${concept.id}`);
    await expect(
      page.getByRole("heading", { name: "Concept not found" }),
    ).toBeVisible();

    await page.goto(`/courses/${courseId}/map`);
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't load the map" }),
    ).toContainText(/not found/i);

    // Nothing of A's leaked onto any of those pages.
    for (const text of [courseName, concept.name])
      await expect(page.getByText(text)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("user B's API calls for user A's resources answer 404 NOT_FOUND", async () => {
  for (const url of [
    `/api/courses/${courseId}`,
    `/api/courses/${courseId}/concepts`,
    `/api/courses/${courseId}/map`,
  ]) {
    const res = await apiB.get(url);
    expect(res.status(), url).toBe(404);
    expect(await res.json(), url).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  }
  const question = await apiB.post(`/api/concepts/${concept.id}/question`);
  expect(question.status()).toBe(404);

  // A still sees it: the 404s above are about ownership, not a missing course.
  expect((await apiA.get(`/api/courses/${courseId}`)).status()).toBe(200);
});
