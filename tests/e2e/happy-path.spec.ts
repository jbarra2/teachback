// The whole loop a student goes through, in the real app (T29): sign up → course → upload →
// practice → feedback → map. AI_PROVIDER=fake, so the grading is deterministic.
import path from "node:path";
import { expect, test } from "playwright/test";
import { IP_HEADER, PASSWORD, freshEmail, freshIp } from "./env";
import { uniqueName } from "./helpers";

const notesFile = path.resolve(
  __dirname,
  "../../fixtures/seed/sorting-notes.md",
);

// A new user on their own client IP, so the sign-up and sign-in limits never meet other tests'.
test.use({ extraHTTPHeaders: { [IP_HEADER]: freshIp() } });

test("sign up, create a course, upload notes, practice, get feedback and see the map", async ({
  page,
}) => {
  const course = uniqueName("Algorithms");
  let courseUrl = "";

  await test.step("sign up", async () => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Happy Path");
    await page.getByLabel("Email").fill(freshEmail("happy"));
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/courses$/);
  });

  await test.step("create a course", async () => {
    await page.getByLabel("New course").fill(course);
    await page.getByRole("button", { name: /Create course/ }).click();
    await page.getByRole("link", { name: course }).click();
    await expect(page).toHaveURL(/\/courses\/[^/]+$/);
    courseUrl = page.url();
  });

  await test.step("upload notes and wait until they're ready", async () => {
    const form = page.getByRole("form", { name: "Upload notes" });
    await form.getByLabel("Title").fill("Sorting notes");
    await form.getByLabel("File", { exact: true }).setInputFiles(notesFile);
    await form.getByRole("button", { name: /Upload/ }).click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("practice a concept and get feedback grounded in the notes", async () => {
    await page
      .getByRole("navigation", { name: "Course" })
      .getByRole("link", { name: "Practice" })
      .click();
    await page
      .getByRole("main")
      .getByRole("listitem")
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/practice\?concept=/);

    const answer = page.getByLabel("Explain it in your own words");
    await answer.fill(
      "Merge sort splits the list in half, sorts each half and merges them.",
    );
    await page.getByRole("button", { name: /Submit answer/ }).click();

    const feedback = page.getByRole("region", { name: "Feedback" });
    await expect(feedback).toBeVisible();
    await expect(feedback.getByText("Partly correct")).toBeVisible();
    await expect(feedback.getByText("Confidence: Medium")).toBeVisible();
    const quotes = feedback.getByRole("list", {
      name: "Quotes from your notes",
    });
    await expect(quotes.getByRole("listitem").first()).toBeVisible();
  });

  await test.step("see the concept map", async () => {
    await page.goto(courseUrl);
    await page
      .getByRole("navigation", { name: "Course" })
      .getByRole("link", { name: "Concept map" })
      .click();
    const map = page.getByRole("region", { name: "Concept map" });
    await expect(map).toBeVisible();
    await expect(map.getByRole("link").first()).toBeVisible();
  });
});
