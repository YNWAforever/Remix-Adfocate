import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { useMissions, useUpdateProfile } from "./kocmax";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useMissions", () => {
  it("fetches missions for the current workspace", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ missions: [{ id: "1", title: "T" }] });
    const { result } = renderHook(() => useMissions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/missions");
  });
});

describe("useUpdateProfile", () => {
  it("PUTs a stringified body to /me/profile", async () => {
    const spy = vi.spyOn(api, "apiFetch").mockResolvedValue({ id: "u1" });
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ display_name: "X", categories: ["美容"] });
    });
    expect(spy).toHaveBeenCalledWith("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ display_name: "X", categories: ["美容"] }),
    });
  });
});
