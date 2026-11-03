import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInBody, SignUpBody } from "@/lib/schemas";

// The client keeps the fetch it finds when first imported, so each test stubs fetch, then imports it.
async function load() {
  vi.resetModules();
  return (await import("./auth-client")).authClient;
}

function stubFetch() {
  const fetch = vi.fn(async () => Response.json({ success: true }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function call(fetch: ReturnType<typeof stubFetch>, index = 0) {
  const [input, init] = fetch.mock.calls[index] as unknown as [
    string | URL | Request,
    RequestInit | undefined,
  ];
  const request = input instanceof Request ? input : new Request(input, init);
  return {
    url: request.url,
    method: request.method,
    credentials: init?.credentials,
    request,
  };
}

const isJson = (request: Request) =>
  request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
  "application/json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authClient", () => {
  // The auth route takes only application/json with exactly these fields (src/lib/api/auth-route.ts).
  it("sends bodies the auth route accepts", async () => {
    const fetch = stubFetch();
    const authClient = await load();
    await authClient.signUp.email({
      name: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
    });
    await authClient.signIn.email({
      email: "ada@example.com",
      password: "correct-horse",
    });
    await authClient.signOut();
    const [signUp, signIn, signOut] = [0, 1, 2].map(
      (i) => call(fetch, i).request,
    );
    for (const request of [signUp, signIn, signOut])
      expect(isJson(request)).toBe(true);
    expect(SignUpBody.safeParse(await signUp.json()).success).toBe(true);
    expect(SignInBody.safeParse(await signIn.json()).success).toBe(true);
    expect(await signOut.json()).toEqual({});
  });

  // Better Auth's client reads these before the page's origin when it has no baseURL of its own.
  it("ignores auth URLs in the environment and stays on this origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", "https://evil.example");
    vi.stubEnv("BETTER_AUTH_URL", "https://evil.example");
    const fetch = stubFetch();
    const authClient = await load();
    await authClient.signIn.email({ email: "ada@example.com", password: "x" });
    expect(call(fetch).url).toBe(
      `${window.location.origin}/api/auth/sign-in/email`,
    );
  });

  it("signs in at this origin's /api/auth, sending the cookie", async () => {
    const fetch = stubFetch();
    const authClient = await load();
    await authClient.signIn.email({ email: "ada@example.com", password: "x" });
    expect(call(fetch)).toMatchObject({
      url: `${window.location.origin}/api/auth/sign-in/email`,
      method: "POST",
      credentials: "include",
    });
  });

  it("signs up and signs out at the matching endpoints", async () => {
    const fetch = stubFetch();
    const authClient = await load();
    await authClient.signUp.email({
      name: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
    });
    await authClient.signOut();
    expect(call(fetch, 0).url).toBe(
      `${window.location.origin}/api/auth/sign-up/email`,
    );
    expect(call(fetch, 1).url).toBe(
      `${window.location.origin}/api/auth/sign-out`,
    );
  });

  it("reads the session with a GET", async () => {
    const fetch = stubFetch();
    const authClient = await load();
    await authClient.getSession();
    expect(call(fetch)).toMatchObject({
      url: `${window.location.origin}/api/auth/get-session`,
      method: "GET",
    });
  });
});
