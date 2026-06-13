import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Stable navigate spy (hoisted so the vi.mock factory can close over it).
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

// Partial-mock the router: real everything, but a controllable useNavigate and a Link that
// renders its children without needing router context.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn(), refreshSession: vi.fn() } },
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), WORKSPACE_SLUG: "demo" }));

import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { Route } from "./kocmax.$slug.auth.callback";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(<Callback />);
}

describe("Auth callback (magic-link landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: "t" } } } as never);
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(apiFetch).mockResolvedValue({} as never);
  });

  it("bootstraps, refreshes and navigates home on a valid session", async () => {
    renderCallback();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/kocmax/$slug", params: { slug: "demo" } }),
    );
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(supabase.auth.refreshSession).toHaveBeenCalled();
  });

  it("shows the recovery state and does NOT navigate when no session arrived", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the recovery state and does NOT navigate when bootstrap fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("boom"));
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the recovery state and does NOT navigate when the session refresh fails", async () => {
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: { message: "refresh failed" } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
