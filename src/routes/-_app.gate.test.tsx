import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSession, signOut } = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession, signOut } } }));

const { apiFetch, setWorkspaceSlug } = vi.hoisted(() => ({ apiFetch: vi.fn(), setWorkspaceSlug: vi.fn() }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, apiFetch, setWorkspaceSlug }; // keep the real ApiError class for instanceof
});

import { ApiError } from "@/lib/api";
import { isRedirect } from "@tanstack/react-router";
import { Route } from "./_app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beforeLoad = Route.options.beforeLoad as any;
function run(pathname: string, qc: unknown) {
  return beforeLoad({ location: { pathname }, context: { queryClient: qc } });
}

describe("_app gate beforeLoad", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs out a stale session (401 on /me) and redirects to /login instead of crashing", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    const qc = {
      ensureQueryData: vi.fn().mockRejectedValue(new ApiError(401, "bad_token", "Invalid token")),
      removeQueries: vi.fn(),
    };
    let thrown: unknown;
    try { await run("/home", qc); } catch (e) { thrown = e; }
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(qc.removeQueries).toHaveBeenCalledWith({ queryKey: ["me"] });
    expect(isRedirect(thrown)).toBe(true);
  });

  it("redirects an anonymous visitor to /login", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    let thrown: unknown;
    try { await run("/home", { ensureQueryData: vi.fn(), removeQueries: vi.fn() }); } catch (e) { thrown = e; }
    expect(isRedirect(thrown)).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("re-throws a non-auth error (does NOT sign the user out)", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "ok" } } });
    const qc = {
      ensureQueryData: vi.fn().mockRejectedValue(new ApiError(500, "db_error", "boom")),
      removeQueries: vi.fn(),
    };
    let thrown: unknown;
    try { await run("/home", qc); } catch (e) { thrown = e; }
    expect(signOut).not.toHaveBeenCalled();
    expect(isRedirect(thrown)).toBe(false);
  });
});
