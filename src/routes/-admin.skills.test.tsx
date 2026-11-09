import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchMcpServers: vi.fn(), createMcpServer: vi.fn(), updateMcpServer: vi.fn(), deleteMcpServer: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "w1", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("@/lib/admin", () => ({
  AdminAuthError: class extends Error {},
  AdminRequestError: class extends Error {
    code?: string; status?: number;
    constructor(message: string, code?: string, _fields?: Record<string, string>, status?: number) { super(message); this.code = code; this.status = status; }
  },
}));
vi.mock("@/lib/admin/mcp", () => ({
  fetchMcpServers: h.fetchMcpServers,
  fetchMcpAudit: async () => ({ calls: [], summary: { total: 0, ok: 0, errors: 0, avg_duration_ms: null } }),
  createMcpServer: h.createMcpServer,
  updateMcpServer: h.updateMcpServer,
  deleteMcpServer: h.deleteMcpServer,
  mcpAdminKeys: { all: ["admin", "mcp"], list: (workspace: string) => ["admin", "mcp", workspace], audit: (workspace: string) => ["admin", "mcp", "audit", workspace] },
}));

import { Route } from "./admin.skills";

function renderPage() {
  const Component = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><Component /></QueryClientProvider>);
}

const server = { id: "s1", name: "notes", url: "https://mcp.example.test/rpc", enabled: true, tools: ["lookup_note"] };

describe("admin skills page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchMcpServers.mockResolvedValue({ servers: [server] });
    h.updateMcpServer.mockResolvedValue({ ok: true });
    h.createMcpServer.mockResolvedValue({ ok: true });
  });

  it("lists servers and disables one", async () => {
    renderPage();
    expect(await screen.findByText("notes")).toBeVisible();
    expect(screen.getByText("lookup_note")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "app.admin.skillsDisable" }));
    await waitFor(() => expect(h.updateMcpServer).toHaveBeenCalledWith("w1", "s1", { enabled: false }));
  });

  it("creates a server from the form", async () => {
    renderPage();
    await screen.findByText("notes");
    fireEvent.change(screen.getByLabelText("app.admin.skillsName"), { target: { value: "fixture" } });
    fireEvent.change(screen.getByLabelText("app.admin.skillsUrl"), { target: { value: "https://mcp.example.test/rpc" } });
    fireEvent.change(screen.getByLabelText("app.admin.skillsTools"), { target: { value: "lookup_note, get_brief" } });
    fireEvent.click(screen.getByRole("button", { name: "app.admin.skillsCreate" }));
    await waitFor(() => expect(h.createMcpServer).toHaveBeenCalledWith("w1", { name: "fixture", url: "https://mcp.example.test/rpc", tools: ["lookup_note", "get_brief"] }));
  });

  it("shows the disabled state when the feature is off", async () => {
    const { AdminRequestError } = await import("@/lib/admin");
    h.fetchMcpServers.mockRejectedValue(new AdminRequestError("off", "mcp_disabled", undefined, 404));
    renderPage();
    expect(await screen.findByText("app.admin.skillsDisabled")).toBeVisible();
  });
});
