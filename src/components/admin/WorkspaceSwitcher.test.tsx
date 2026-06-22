import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchWorkspaces: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  fetchWorkspaces: h.fetchWorkspaces,
  adminMissionKeys: { workspaces: ["admin-workspaces"] },
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));

import { AdminWorkspaceProvider, useAdminWorkspace } from "./AdminWorkspaceContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function Probe() {
  const { workspace } = useAdminWorkspace();
  return <div data-testid="ws">{workspace || "ALL"}</div>;
}

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminWorkspaceProvider>
        <WorkspaceSwitcher />
        <Probe />
      </AdminWorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/admin/missions");
    h.fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: "w1", name: "Brand A" }, { id: "w2", name: "Brand B" }] });
  });

  it("defaults to All and persists a selection to sessionStorage + URL", async () => {
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("ALL");
    await screen.findByRole("option", { name: "Brand A" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "w1" } });
    expect(screen.getByTestId("ws").textContent).toBe("w1");
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe("w1");
    expect(new URLSearchParams(window.location.search).get("ws")).toBe("w1");
  });

  it("reads the initial selection from the URL", async () => {
    window.history.replaceState(null, "", "/admin/missions?ws=w2");
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("w2");
  });
});
