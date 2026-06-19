import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ conversation_id: "c1", answer: "你好", citations: [] })), ApiError: class {} }));
import { apiFetch } from "@/lib/api";
import { useAssistantChat } from "./kocmax";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAssistantChat", () => {
  beforeEach(() => vi.clearAllMocks());
  it("posts the message and returns the answer", async () => {
    const { result } = renderHook(() => useAssistantChat(), { wrapper });
    result.current.mutate({ message: "點樣賺分？" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/assistant/chat", expect.objectContaining({ method: "POST" }));
    expect(result.current.data?.answer).toBe("你好");
  });
});
