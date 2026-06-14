import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate, Link: ({ children }: { children: React.ReactNode }) => children };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn() } },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { Route } from "./kocmax.$slug.auth.callback";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(<Callback />);
}

describe("Auth callback (PKCE landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?code=abc123");
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: null } as never);
    mockFinishAuth.mockResolvedValue(undefined);
  });

  it("exchanges the code then delegates to finishAuth", async () => {
    renderCallback();
    await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123"));
    expect(mockFinishAuth).toHaveBeenCalledWith("demo", mockNavigate);
  });

  it("shows the recovery state when no code is present", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback");
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when the exchange fails", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: { message: "bad code" } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when finishAuth throws", async () => {
    mockFinishAuth.mockRejectedValue(new Error("boom"));
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
  });
});
