import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ access: vi.fn(), workspaces: vi.fn() }));
vi.mock("@/lib/admin", async original => ({ ...await original<object>(), fetchStaffAccess: h.access, fetchWorkspaces: h.workspaces }));
import { AdminRequestError } from "@/lib/admin";
import { AdminAuthContext } from "./AdminAuthContext";
import { AdminWorkspaceProvider } from "./AdminWorkspaceContext";
import { StaffAccessProvider } from "./StaffAccessContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/admin?ws=obsolete");
  sessionStorage.setItem("adfocate_admin_workspace", "obsolete");
  h.access.mockImplementation(async (workspace: string) => {
    if (workspace === "obsolete") throw new AdminRequestError("Not found", "NOT_FOUND", undefined, 404);
    return { access: { workspace: { id: "owned", slug: "owned", role: "operator", revision: 1, capabilities: ["creator.read"] }, platformCapabilities: [] } };
  });
  h.workspaces.mockResolvedValue({ workspaces: [{ id: "owned", slug: "owned", name: "Current owned workspace" }] });
});
afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("recovers a stale workspace selector through current access without discarding the mounted draft", async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AdminAuthContext.Provider value={{ authed: true, staff: { userId: "staff", email: "synthetic@example.test" }, reportAuthError: vi.fn() }}>
      <AdminWorkspaceProvider><StaffAccessProvider><WorkspaceSwitcher /><input aria-label="Unsent draft" defaultValue="Draft kept" /></StaffAccessProvider></AdminWorkspaceProvider>
    </AdminAuthContext.Provider>
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Use current workspace/ }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "workspace" })).toHaveValue("owned"));
  expect(screen.getByLabelText("Unsent draft")).toHaveValue("Draft kept");
  expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe("owned");
  expect(new URLSearchParams(window.location.search).get("ws")).toBe("owned");
});
