import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({ supabase: { auth: { refreshSession: vi.fn() } } }));
const { apiFetch, setWorkspaceSlug } = vi.hoisted(() => ({ apiFetch: vi.fn(), setWorkspaceSlug: vi.fn() }));
vi.mock("./api", () => ({ apiFetch, setWorkspaceSlug }));

import { supabase } from "./supabase";
import { finishAuth } from "./auth-flow";

const navigate = vi.fn();

describe("finishAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
  });

  it("bootstraps, sets the slug, and routes incomplete users to the wizard", async () => {
    apiFetch.mockResolvedValueOnce({ created: true }); // /me/bootstrap
    apiFetch.mockResolvedValueOnce({ onboarding_completed: false }); // /onboarding/status
    await finishAuth(navigate as never);
    expect(setWorkspaceSlug).toHaveBeenCalledWith("demo");
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/onboarding" });
  });

  it("routes already-onboarded users home", async () => {
    apiFetch.mockResolvedValueOnce({ created: false });
    apiFetch.mockResolvedValueOnce({ onboarding_completed: true });
    await finishAuth(navigate as never);
    expect(navigate).toHaveBeenCalledWith({ to: "/home" });
  });

  it("throws (and does not navigate) when the session refresh fails", async () => {
    apiFetch.mockResolvedValueOnce({ created: true });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: { message: "refresh failed" } } as never);
    await expect(finishAuth(navigate as never)).rejects.toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
