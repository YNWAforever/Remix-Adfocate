import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { useRedemptions, useEarnings } from "./kocmax";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useRedemptions", () => {
  it("fetches the caller's redemption history", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ redemptions: [{ id: "r1" }] });
    const { result } = renderHook(() => useRedemptions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/redemption/history");
  });
});

describe("useEarnings", () => {
  it("fetches the earnings summary", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ available: 50, pending: 30 });
    const { result } = renderHook(() => useEarnings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(50);
    expect(api.apiFetch).toHaveBeenCalledWith("/wallet/earnings");
  });
});
