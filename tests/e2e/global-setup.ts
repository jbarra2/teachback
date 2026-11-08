// Runs once, after Playwright has started the dev server and before any spec (T29):
// 1. checks that the database is the local `_test` one, then migrates it and empties every table
//    (in that order, in prepare-db.ts), so a run never depends on earlier runs or on rows
//    `npm run test:int` left behind, 2. compiles each route once, and 3. signs up users A and B and
//    saves their sessions, so specs reuse them instead of signing in again.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { request } from "playwright/test";
import {
  BASE_URL,
  IPS,
  IP_HEADER,
  PASSWORD,
  STORAGE,
  freshEmail,
  runDbStep,
} from "./env";

const root = path.resolve(__dirname, "../..");

export default async function globalSetup(): Promise<void> {
  runDbStep("prepare");
  await warmRoutes();

  mkdirSync(path.join(root, path.dirname(STORAGE.a)), { recursive: true });
  await createUser("Demo A", IPS.a, STORAGE.a);
  await createUser("Demo B", IPS.b, STORAGE.b);
}

/**
 * `next dev` compiles a route the first time it's requested, which can take longer than a test
 * should wait. Requesting each one here moves that cost out of the specs. Signed out, the pages
 * redirect to /login, which still compiles them. The POST-only routes get a GET: Next answers
 * 405 before any app code runs, so nothing is read or written, but it compiles the route first.
 */
async function warmRoutes(): Promise<void> {
  const api = await request.newContext({ baseURL: BASE_URL, timeout: 120_000 });
  const id = "cwarm0000000000000000000";
  const paths = [
    "/",
    "/login",
    "/signup",
    "/courses",
    `/courses/${id}`,
    `/courses/${id}/practice`,
    `/courses/${id}/practice?concept=${id}`,
    `/courses/${id}/map`,
    "/api/courses",
    `/api/courses/${id}`,
    `/api/courses/${id}/concepts`,
    `/api/courses/${id}/map`,
    `/api/documents/${id}`,
    "/api/documents",
    `/api/concepts/${id}/question`,
    `/api/questions/${id}/answer`,
    "/api/auth/get-session",
  ];
  try {
    for (const route of paths) await api.get(route, { maxRedirects: 0 });
  } finally {
    await api.dispose();
  }
}

/** Signs up a new user through the app's own auth API and saves the signed-in session. */
async function createUser(
  name: string,
  ip: string,
  file: string,
): Promise<void> {
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { [IP_HEADER]: ip, Origin: BASE_URL },
  });
  try {
    const email = freshEmail(name.toLowerCase().replace(/\W+/g, "-"));
    const signUp = await api.post("/api/auth/sign-up/email", {
      data: { name, email, password: PASSWORD },
    });
    if (!signUp.ok())
      throw new Error(`Sign-up for ${name} failed: ${signUp.status()}`);
    const signIn = await api.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });
    if (!signIn.ok())
      throw new Error(`Sign-in for ${name} failed: ${signIn.status()}`);
    await api.storageState({ path: path.join(root, file) });
  } finally {
    await api.dispose();
  }
}
