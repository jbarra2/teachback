import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

const { readSession } = await import("./session");

const USER = {
  id: "cuser00000000000000000001",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("readSession", () => {
  it("reads the session from the request's own headers only", async () => {
    getSession.mockResolvedValue({ headers: new Headers(), response: null });
    const request = new Request("https://t.example/api/x", {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    await readSession(request);
    expect(getSession).toHaveBeenCalledWith({
      headers: request.headers,
      returnHeaders: true,
    });
  });

  it("is null when Better Auth finds no session", async () => {
    getSession.mockResolvedValue({ headers: new Headers(), response: null });
    expect(await readSession(new Request("https://t.example/"))).toBeNull();
  });

  it("returns only the user's id, email and name, and the cookies to refresh", async () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "better-auth.session_token=new; Path=/; HttpOnly",
    );
    getSession.mockResolvedValue({
      headers,
      response: { user: USER, session: { id: "s1", token: "secret-token" } },
    });
    expect(await readSession(new Request("https://t.example/"))).toEqual({
      user: { id: USER.id, email: USER.email, name: USER.name },
      setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
    });
  });
});
