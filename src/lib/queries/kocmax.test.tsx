import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import * as queries from "./kocmax";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useMissions", () => {
  it("fetches missions for the current workspace", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ missions: [{ id: "1", title: "T" }] });
    const { result } = renderHook(() => queries.useMissions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/missions");
  });
});

describe("useUpdateProfile", () => {
  it("PUTs a stringified body to /me/profile", async () => {
    const spy = vi.spyOn(api, "apiFetch").mockResolvedValue({ id: "u1" });
    const { result } = renderHook(() => queries.useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ display_name: "X", categories: ["美容"] });
    });
    expect(spy).toHaveBeenCalledWith("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ display_name: "X", categories: ["美容"] }),
    });
  });
});

describe("useMyPassport", () => {
  it("fetches the passport from /me/passport", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["level_l1"],
    });
    const { result } = renderHook(() => queries.useMyPassport(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/me/passport");
    expect(result.current.data?.badges).toContain("level_l1");
  });
});

describe("social trust queries", () => {
  it("fetches social trust accounts from /social/accounts", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValueOnce({ accounts: [] });
    const { result } = renderHook(() => queries.useSocialAccounts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/social/accounts");
  });

  it("scans a social account through /social/accounts/:id/scan", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValueOnce({
      account: { id: "acc-1" },
      labels: ["API-synced", "Ownership not verified"],
    });
    const { result } = renderHook(() => queries.useScanSocialAccount(), { wrapper });
    result.current.mutate("acc-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/social/accounts/acc-1/scan", { method: "POST" });
  });

  it("fetches a public passport by token", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValueOnce({
      creator: { displayName: "KOC", avatarUrl: null, level: "L1", xp: 500 },
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: [],
      socialTrustBadges: ["social_scan_connected"],
    });
    const { result } = renderHook(() => queries.usePublicPassport("token-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/public/passports/token-1");
  });
});
