import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { useMissions } from "./kocmax";

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
