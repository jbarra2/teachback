// Shared steps for the specs (T29). Each test makes its own courses and notes through the API, so
// tests don't depend on each other or on the order they run in.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "playwright/test";
import {
  BASE_URL,
  IPS,
  IP_HEADER,
  PASSWORD,
  STORAGE,
  freshEmail,
  freshIp,
} from "./env";

const root = path.resolve(__dirname, "../..");

/** Fictional notes from the seed fixtures: long enough for several chunks and concepts. */
export const NOTES = readFileSync(
  path.join(root, "fixtures/seed/sorting-notes.md"),
  "utf8",
);

export type SavedUser = keyof typeof STORAGE;

/** A browser context signed in as a saved user, sending that user's client IP. */
export function signedInContext(
  browser: Browser,
  user: SavedUser,
): Promise<BrowserContext> {
  return browser.newContext({
    storageState: path.join(root, STORAGE[user]),
    extraHTTPHeaders: { [IP_HEADER]: IPS[user] },
  });
}

/** An API client signed in as a saved user. Mutating calls carry the app's own Origin, as a browser would. */
export function apiAs(user: SavedUser): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE_URL,
    storageState: path.join(root, STORAGE[user]),
    extraHTTPHeaders: { [IP_HEADER]: IPS[user], Origin: BASE_URL },
  });
}

/** Signs up and signs in a brand-new user, for a test that changes its own session (sign out). */
export async function newSignedInUser(
  browser: Browser,
): Promise<{ context: BrowserContext; email: string }> {
  const ip = freshIp();
  const email = freshEmail("own");
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { [IP_HEADER]: ip, Origin: BASE_URL },
  });
  try {
    const signUp = await api.post("/api/auth/sign-up/email", {
      data: { name: "Own user", email, password: PASSWORD },
    });
    expect(signUp.status(), "sign-up").toBe(200);
    const signIn = await api.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    expect(signIn.status(), "sign-in").toBe(200);
    const context = await browser.newContext({
      storageState: await api.storageState(),
      extraHTTPHeaders: { [IP_HEADER]: ip },
    });
    return { context, email };
  } finally {
    await api.dispose();
  }
}

/** A name no other test or run has used, so assertions can't match someone else's course. */
export function uniqueName(label: string): string {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function createCourse(
  api: APIRequestContext,
  name: string,
): Promise<string> {
  const res = await api.post("/api/courses", { data: { name } });
  expect(res.status(), "create course").toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Uploads pasted notes and waits until processing finishes. */
export async function uploadReadyNotes(
  api: APIRequestContext,
  courseId: string,
  title = "Sorting notes",
): Promise<string> {
  const res = await api.post("/api/documents", {
    multipart: { courseId, title, text: NOTES },
  });
  expect(res.status(), "upload").toBe(202);
  const { id } = (await res.json()) as { id: string };
  await expect
    .poll(
      async () => {
        const doc = await api.get(`/api/documents/${id}`);
        return ((await doc.json()) as { status: string }).status;
      },
      {
        message: "document becomes READY",
        timeout: 60_000,
        intervals: [500, 1_000],
      },
    )
    .toBe("READY");
  return id;
}

/** The course's concepts, as the practice picker lists them. */
export async function concepts(
  api: APIRequestContext,
  courseId: string,
): Promise<{ id: string; name: string }[]> {
  const res = await api.get(`/api/courses/${courseId}/concepts`);
  expect(res.status(), "list concepts").toBe(200);
  return (await res.json()) as { id: string; name: string }[];
}
