import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "@/lib/api-client/errors";
import {
  CHECK_DETAILS,
  INVALID_LOGIN,
  RATE_LIMITED,
  SIGNUP_LOGIN_FAILED,
  logIn,
  signOut,
  signUp,
} from "./auth-actions";

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: client }));

const success = { data: {}, error: null };
/** Better Auth's client error: the status plus whatever the server sent. */
const failure = (status: number, message = "server text <b>raw</b>") => ({
  data: null,
  error: { status, statusText: "", message },
});

const ada = { email: " ada@example.com ", password: "correct horse" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("logIn", () => {
  it("signs in with the trimmed email and returns nothing", async () => {
    client.signIn.email.mockResolvedValue(success);
    await expect(logIn(ada)).resolves.toBeUndefined();
    expect(client.signIn.email).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
    });
  });

  it.each([
    [401, INVALID_LOGIN],
    [429, RATE_LIMITED],
    [400, CHECK_DETAILS],
    [403, GENERIC_MESSAGE],
    [500, GENERIC_MESSAGE],
  ])("turns a %i into fixed text, never the server's", async (status, text) => {
    client.signIn.email.mockResolvedValue(failure(status));
    await expect(logIn(ada)).resolves.toBe(text);
  });

  it("says the server couldn't be reached when the call throws", async () => {
    client.signIn.email.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(logIn(ada)).resolves.toBe(NETWORK_MESSAGE);
  });
});

describe("signUp", () => {
  const values = { ...ada, name: " Ada " };

  it("creates the account, then signs in", async () => {
    client.signUp.email.mockResolvedValue(success);
    client.signIn.email.mockResolvedValue(success);
    await expect(signUp(values)).resolves.toBeUndefined();
    expect(client.signUp.email).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      password: "correct horse",
    });
    expect(client.signIn.email).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
    });
  });

  it("points to log in when signing in after sign-up fails (an existing email)", async () => {
    client.signUp.email.mockResolvedValue(success);
    client.signIn.email.mockResolvedValue(failure(401));
    await expect(signUp(values)).resolves.toBe(SIGNUP_LOGIN_FAILED);
  });

  it("doesn't sign in when sign-up fails", async () => {
    client.signUp.email.mockResolvedValue(failure(429));
    await expect(signUp(values)).resolves.toBe(RATE_LIMITED);
    expect(client.signIn.email).not.toHaveBeenCalled();
  });

  it("reports a rate limit on the sign-in step", async () => {
    client.signUp.email.mockResolvedValue(success);
    client.signIn.email.mockResolvedValue(failure(429));
    await expect(signUp(values)).resolves.toBe(RATE_LIMITED);
  });
});

describe("signOut", () => {
  it("returns nothing on success", async () => {
    client.signOut.mockResolvedValue(success);
    await expect(signOut()).resolves.toBeUndefined();
  });

  it("returns a fixed message when it fails", async () => {
    client.signOut.mockRejectedValue(new Error("offline"));
    await expect(signOut()).resolves.toBe(NETWORK_MESSAGE);
  });
});
