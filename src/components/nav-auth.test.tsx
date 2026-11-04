import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_MESSAGE } from "@/lib/api-client/errors";
import { NavAuth } from "./nav-auth";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const session = vi.hoisted(() => ({
  current: { data: null as object | null, isPending: false },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => session.current },
}));

function renderNav(
  signOut: () => Promise<string | undefined> = vi.fn(async () => undefined),
) {
  render(
    <ul>
      <NavAuth signOut={signOut} />
    </ul>,
  );
  return signOut;
}

const signOutButton = () => screen.getByRole("button", { name: /Sign out/ });

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
  session.current = { data: null, isPending: false };
});

describe("NavAuth", () => {
  it("shows nothing while the session loads", () => {
    session.current = { data: null, isPending: true };
    renderNav();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers log in and sign up when signed out", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("signs out and goes to /login when signed in", async () => {
    session.current = { data: { user: { name: "Ada" } }, isPending: false };
    const signOut = renderNav();
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    await act(async () => fireEvent.click(signOutButton()));
    expect(signOut).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("signs out once on a double click", async () => {
    session.current = { data: { user: { name: "Ada" } }, isPending: false };
    let finish = () => {};
    const signOut = vi.fn(
      () =>
        new Promise<undefined>(
          (resolve) => (finish = () => resolve(undefined)),
        ),
    );
    renderNav(signOut);
    fireEvent.click(signOutButton());
    fireEvent.click(signOutButton());
    await act(async () => finish());
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("stays and says why when signing out fails", async () => {
    session.current = { data: { user: { name: "Ada" } }, isPending: false };
    renderNav(vi.fn(async () => NETWORK_MESSAGE));
    await act(async () => fireEvent.click(signOutButton()));
    expect(screen.getByRole("status")).toHaveTextContent(NETWORK_MESSAGE);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
