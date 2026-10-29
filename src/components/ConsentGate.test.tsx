import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: h.apiFetch }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { ConsentGate } from "./ConsentGate";
import { LEGAL_VERSIONS } from "@/lib/legalVersions";

const status = (needsAcceptance: boolean) => ({ required: LEGAL_VERSIONS, needsAcceptance, marketing: { granted: false, recordedAt: null } });
const r = (enabled = true) => render(<QueryClientProvider client={new QueryClient()}><ConsentGate enabled={enabled} /></QueryClientProvider>);

describe("ConsentGate (F-008)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks until the current Terms and Privacy Policy are accepted, recording the marketing choice", async () => {
    h.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? { accepted: true } : status(true)));
    r();
    const accept = await screen.findByRole("button", { name: "接受並繼續" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByLabelText("我已閱讀並同意服務條款及私隱政策。"));
    fireEvent.click(screen.getByLabelText("向我發送任務及優惠消息（可選）。"));
    fireEvent.click(accept);
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalledWith("/me/consents", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse(h.apiFetch.mock.calls.find(c => c[1]?.method === "POST")![1].body);
    expect(body).toEqual({ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, marketing: true });
  });

  it("stays hidden once accepted, and on login/auth routes", async () => {
    h.apiFetch.mockResolvedValue(status(false));
    const { unmount } = r();
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    h.apiFetch.mockClear();
    r(false);
    expect(h.apiFetch).not.toHaveBeenCalled();
  });
});
