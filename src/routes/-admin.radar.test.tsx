import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchRadar: vi.fn(), reportAuthError: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", () => ({
  fetchRadar: h.fetchRadar,
  adminKeys: { radar: (ws: string, d: number) => ["admin-radar", ws, d] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.radar";
import { AdminAuthError } from "@/lib/admin";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

const populatedRadar = {
  radar: {
    window: { days: 30, from: "2026-06-01T00:00:00.000Z" },
    atRisk: {
      items: [
        { creator_id: "c1", display_name: "Alice Lam", phone: null, last_active: "2026-05-01T00:00:00.000Z", days_idle: 60 },
      ],
      total: 1,
    },
    slaBreaching: { items: [], total: 0 },
    rising: { items: [], total: 0 },
    newUnactivated: { items: [], total: 0 },
  },
};

describe("admin radar page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("shows a loading skeleton before data resolves", () => {
    h.fetchRadar.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = r();
    expect(container.querySelector(".skeleton-acid")).not.toBeNull();
  });

  it("renders queue headings and a creator name when data resolves", async () => {
    h.fetchRadar.mockResolvedValue(populatedRadar);
    r();
    await waitFor(() => expect(screen.getByText("有流失風險的創作者")).toBeInTheDocument());
    expect(screen.getByText("Alice Lam")).toBeInTheDocument();
    // Empty queues show their empty messages
    expect(screen.getByText("審核逾期")).toBeInTheDocument();
  });

  it("reports auth errors through reportAuthError", async () => {
    h.fetchRadar.mockRejectedValue(new AdminAuthError("unauthorized"));
    r();
    await waitFor(() => expect(h.reportAuthError).toHaveBeenCalled());
  });

  it("shows load-error message on a non-auth error", async () => {
    h.fetchRadar.mockRejectedValue(new Error("network failure"));
    r();
    await waitFor(() => expect(screen.getByText("無法載入雷達數據。")).toBeInTheDocument());
  });

  it("recovers from a load error when Retry is clicked", async () => {
    h.fetchRadar.mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce(populatedRadar);
    r();
    const retry = await screen.findByRole("button", { name: "重試" });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Alice Lam")).toBeInTheDocument());
  });
});
