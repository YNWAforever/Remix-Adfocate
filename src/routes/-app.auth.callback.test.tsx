import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ navigate: vi.fn(), finishAuth: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => hoisted.navigate,
    Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    createFileRoute: () => (opts: unknown) => opts,
  };
});
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn(async () => ({ error: null })) } },
}));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: hoisted.finishAuth }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { Route } from "./_app.auth.callback";

function renderCallback(search: string) {
  window.history.replaceState({}, "", `/auth/callback${search}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const C = (Route as any).component as React.ComponentType;
  return render(<C />);
}

beforeEach(() => { hoisted.navigate.mockReset(); hoisted.finishAuth.mockReset(); });

describe("auth callback", () => {
  it("skips creator bootstrap and navigates to next for staff (next=/admin)", async () => {
    renderCallback("?next=/admin&code=abc");
    await waitFor(() => expect(hoisted.navigate).toHaveBeenCalledWith({ to: "/admin" }));
    expect(hoisted.finishAuth).not.toHaveBeenCalled();
  });

  it("runs creator finishAuth when there is no admin next", async () => {
    renderCallback("?code=abc");
    await waitFor(() => expect(hoisted.finishAuth).toHaveBeenCalled());
  });

  it("does not skip bootstrap for a non-admin next that merely starts with 'admin' text", async () => {
    renderCallback("?next=/adminfoo&code=abc");
    await waitFor(() => expect(hoisted.finishAuth).toHaveBeenCalled());
    expect(hoisted.navigate).not.toHaveBeenCalledWith({ to: "/adminfoo" });
  });
});
