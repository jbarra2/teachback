// User text renders as text (T29, TESTING §7): script and image payloads in a course name and in
// an answer show up literally, and nothing runs.
import { expect, test, type Page } from "playwright/test";
import {
  apiAs,
  concepts,
  createCourse,
  signedInContext,
  uniqueName,
  uploadReadyNotes,
} from "./helpers";

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";
const IMG_PAYLOAD = "<img src=x onerror=alert(1)>";

/** Fails the test on any dialog: alert(1) firing is exactly what must never happen. */
function failOnDialog(page: Page, dialogs: string[]): void {
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
}

async function expectNothingInjected(page: Page): Promise<void> {
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  const injected = await page
    .locator("script")
    .evaluateAll(
      (scripts) =>
        scripts.filter((s) => s.textContent?.includes("alert(1)")).length,
    );
  expect(injected).toBe(0);
}

test("a course name with a script tag renders as text", async ({ browser }) => {
  const name = `${SCRIPT_PAYLOAD} ${uniqueName("xss")}`;
  const api = await apiAs("a");
  const context = await signedInContext(browser, "a");
  const dialogs: string[] = [];
  try {
    await createCourse(api, name);
    const page = await context.newPage();
    failOnDialog(page, dialogs);

    await page.goto("/courses");
    await expect(page.getByRole("link", { name })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expectNothingInjected(page);
    expect(dialogs).toEqual([]);
  } finally {
    await context.close();
    await api.dispose();
  }
});

test("an answer with an image payload renders as text and nothing runs", async ({
  browser,
}) => {
  const api = await apiAs("a");
  const context = await signedInContext(browser, "a");
  const dialogs: string[] = [];
  try {
    const courseId = await createCourse(api, uniqueName("XSS answers"));
    await uploadReadyNotes(api, courseId);
    const [concept] = await concepts(api, courseId);

    const page = await context.newPage();
    failOnDialog(page, dialogs);
    await page.goto(`/courses/${courseId}/practice?concept=${concept.id}`);

    const answer = page.getByLabel("Explain it in your own words");
    await answer.fill(`${IMG_PAYLOAD} ${SCRIPT_PAYLOAD}`);
    await page.getByRole("button", { name: /Submit answer/ }).click();

    await expect(page.getByRole("region", { name: "Feedback" })).toBeVisible();
    await expect(answer).toHaveValue(`${IMG_PAYLOAD} ${SCRIPT_PAYLOAD}`);
    await expectNothingInjected(page);
    expect(dialogs).toEqual([]);
  } finally {
    await context.close();
    await api.dispose();
  }
});
