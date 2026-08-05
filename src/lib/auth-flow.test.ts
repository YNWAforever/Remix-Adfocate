import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { refreshSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));
const { apiFetch, setWorkspaceSlug } = vi.hoisted(() => ({ apiFetch: vi.fn(), setWorkspaceSlug: vi.fn() }));
vi.mock("./api", () => ({ apiFetch, setWorkspaceSlug }));

import { supabase } from "./supabase";
import { finishAuth, bindQueryCacheToAuth } from "./auth-flow";

const navigate = vi.fn();

describe("finishAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
  });

  it("bootstraps, sets the slug, and routes incomplete users to the wizard", async () => {
    apiFetch.mockResolvedValueOnce({ created: true }); // /me/bootstrap
    apiFetch.mockResolvedValueOnce({ onboarding_completed: false }); // /onboarding/status
    const result = await finishAuth(navigate as never);
    expect(setWorkspaceSlug).toHaveBeenCalledWith("demo");
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/onboarding" });
    expect(result).toEqual({ created: true, onboardingCompleted: false, destination: "/onboarding" });
  });

  it("routes already-onboarded users home", async () => {
    apiFetch.mockResolvedValueOnce({ created: false });
    apiFetch.mockResolvedValueOnce({ onboarding_completed: true });
    const result = await finishAuth(navigate as never);
    expect(navigate).toHaveBeenCalledWith({ to: "/home" });
    expect(result).toEqual({ created: false, onboardingCompleted: true, destination: "/home" });
  });

  it("throws (and does not navigate) when the session refresh fails", async () => {
    apiFetch.mockResolvedValueOnce({ created: true });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: { message: "refresh failed" } } as never);
    await expect(finishAuth(navigate as never)).rejects.toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});

type AuthHandler = Parameters<typeof supabase.auth.onAuthStateChange>[0];

/** Binds a stub client and returns a way to drive the auth events by hand. */
function bind() {
  let handler!: AuthHandler;
  const unsubscribe = vi.fn();
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb) => {
    handler = cb;
    return { data: { subscription: { unsubscribe } } } as never;
  });
  const queryClient = { clear: vi.fn() };
  const dispose = bindQueryCacheToAuth(queryClient as never);
  return {
    queryClient,
    dispose,
    unsubscribe,
    emit: (event: string, userId: string | null) =>
      handler(event as never, (userId ? { user: { id: userId } } : null) as never),
  };
}

describe("bindQueryCacheToAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the cache when a different creator signs in on the same tab", () => {
    const { emit, queryClient } = bind();
    emit("INITIAL_SESSION", "creator-a");
    emit("SIGNED_IN", "creator-b");
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps the cache on a token refresh for the same user", () => {
    const { emit, queryClient } = bind();
    emit("INITIAL_SESSION", "creator-a");
    emit("TOKEN_REFRESHED", "creator-a");
    emit("SIGNED_IN", "creator-a");
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it("clears the cache on sign-out", () => {
    const { emit, queryClient } = bind();
    emit("INITIAL_SESSION", "creator-a");
    emit("SIGNED_OUT", null);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it("does not clear on the initial session of a fresh page load", () => {
    const { emit, queryClient } = bind();
    emit("INITIAL_SESSION", "creator-a");
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it("unsubscribes when disposed", () => {
    const { dispose, unsubscribe } = bind();
    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
