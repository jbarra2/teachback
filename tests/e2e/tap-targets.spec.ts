// Tap targets that only a real browser can measure (T32, #94): at phone width, the map's zoom
// buttons come from React Flow's stylesheet, which the app overrides in globals.css.
import { expect, test } from "playwright/test";
import {
  apiAs,
  createCourse,
  signedInContext,
  uniqueName,
  uploadReadyNotes,
} from "./helpers";

test("the map's zoom buttons are at least 44 px at 390 px wide", async ({
  browser,
}) => {
  const api = await apiAs("a");
  const context = await signedInContext(browser, "a");
  try {
    const courseId = await createCourse(api, uniqueName("Tap targets"));
    await uploadReadyNotes(api, courseId);
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/courses/${courseId}/map`);
    await expect(
      page.getByRole("region", { name: "Concept map" }),
    ).toBeVisible();
    for (const name of ["Zoom In", "Zoom Out", "Fit View"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
    await api.dispose();
  }
});
