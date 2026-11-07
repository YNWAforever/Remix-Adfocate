import type { ComponentProps, ComponentType, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider, useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { StaffAccessProvider, useStaffAccess } from "@/components/admin/StaffAccessContext";
import type { MissionDraftInput, StaffAccessSnapshot } from "@/lib/admin";
import { ROLE_CAPABILITIES, type StaffWorkspaceRole } from "../../server/lib/staffCapabilities";

const api = vi.hoisted(() => ({
  access: vi.fn(), workspaces: vi.fn(), create: vi.fn(), navigate: vi.fn(),
  saves: [] as Array<(body: MissionDraftInput) => Promise<unknown>>,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<object>()), createFileRoute: () => (options: unknown) => options,
  useNavigate: () => api.navigate, useBlocker: () => undefined,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/admin", async (original) => ({
  ...(await original<object>()), fetchStaffAccess: api.access, fetchWorkspaces: api.workspaces,
  createMission: api.create,
}));
vi.mock("@/components/admin/MissionEditor", async (original) => {
  const actual = await original<typeof import("@/components/admin/MissionEditor")>();
  return { ...actual, MissionEditor: (props: ComponentProps<typeof actual.MissionEditor>) => {
    // Observe retained callbacks while exercising the actual editor, fields and submit validation.
    api.saves.push(props.onSave); return <actual.MissionEditor {...props} />;
  } };
});
import { Route } from "./admin.missions.new";

const accessFor = (role: StaffWorkspaceRole = "workspace_admin", id = "w1"): StaffAccessSnapshot => ({
  workspace: { id, slug: id === "w1" ? "owned" : "other", role, capabilities: ROLE_CAPABILITIES[role], revision: 1 },
  platformCapabilities: [], scopeStatus: null,
});
const payload = { workspace_id: "w1", title: "Private unsaved title", slug: "private-draft" } as MissionDraftInput;
function Controls() {
  const { setWorkspace } = useAdminWorkspace(); const access = useStaffAccess();
  return <>
    <output data-testid="access-state">{!access ? "missing" : access.loading ? "pending" : access.error ? "error" : access.access?.workspace?.role ?? "empty"}</output>
    <button onClick={() => setWorkspace("w2", "other")}>Switch fixture workspace</button>
    <button onClick={() => void access?.refresh()}>Refresh fixture access</button>
  </>;
}
const clients: QueryClient[] = [];
function mount(withAccess = true) {
  const Component = (Route as unknown as { component: ComponentType }).component;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const tree = (userId: string | null, authed = true) => <QueryClientProvider client={client}>
    <AdminAuthContext.Provider value={{ authed, staff: userId ? { userId, email: `${userId}@example.test` } : null, reportAuthError: vi.fn(), signOut: vi.fn(async () => {}) }}>
      <AdminWorkspaceProvider>{withAccess ? <StaffAccessProvider><Controls /><Component /></StaffAccessProvider> : <><Controls /><Component /></>}</AdminWorkspaceProvider>
    </AdminAuthContext.Provider>
  </QueryClientProvider>;
  const view = render(tree("staff-a"));
  return { ...view, identity: (id: string | null, authed = true) => view.rerender(tree(id, authed)) };
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function fill() {
  fireEvent.change(await screen.findByLabelText("標題"), { target: { value: payload.title } });
  fireEvent.change(screen.getByLabelText("任務網址代號"), { target: { value: payload.slug } });
  return api.saves.at(-1)!;
}
beforeEach(() => {
  vi.clearAllMocks(); api.saves.length = 0;
  api.access.mockReset().mockResolvedValue({ access: accessFor() });
  api.workspaces.mockReset().mockResolvedValue({ workspaces: [{ id: "w2", name: "Other workspace" }, { id: "w1", name: "Owned workspace" }] });
  api.create.mockReset().mockResolvedValue({ mission: { id: "created" } });
  window.sessionStorage.clear(); window.localStorage.clear();
  window.history.replaceState(null, "", "/admin/missions/new?ws=w1");
});
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); });

describe("new mission route requires current workspace mission.manage", () => {
  it.each(["operator", "reviewer", "finance_viewer"] as const)("denies direct %s access without querying or mounting the editor", async role => {
    api.access.mockResolvedValue({ access: accessFor(role) }); mount();
    await waitFor(() => expect(screen.getByTestId("access-state")).toHaveTextContent(role)); await flush();
    expect(screen.queryByLabelText("標題")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回管理首頁" })).toHaveAttribute("href", "/admin");
    expect(api.workspaces).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
  });
  it.each(["/admin/missions/new", "/admin/missions/new?ws=owned", "/admin/missions/new?ws=w1"])("allows an admin only in the resolved workspace: %s", async url => {
    window.history.replaceState(null, "", url); mount(); await fill();
    expect(screen.getByRole("combobox", { name: "品牌" })).toHaveValue("w1");
    expect(screen.queryByRole("option", { name: "Other workspace" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining(payload)));
    expect(api.navigate).toHaveBeenCalledWith({ to: "/admin/missions" });
  });
  it.each(["pending", "error", "missing", "empty", "mismatch"])("keeps create controls unavailable for %s authority", async state => {
    if (state === "pending") api.access.mockImplementation(() => new Promise(() => {}));
    if (state === "error") api.access.mockRejectedValue(new Error("temporary access outage"));
    if (state === "empty") api.access.mockResolvedValue({ access: { workspace: null, platformCapabilities: [], scopeStatus: "unavailable" } });
    if (state === "mismatch") api.access.mockResolvedValue({ access: accessFor("workspace_admin", "w2") });
    mount(state !== "missing");
    await waitFor(() => expect(screen.getByTestId("access-state")).toHaveTextContent(state === "mismatch" ? "workspace_admin" : state)); await flush();
    expect(screen.queryByLabelText("標題")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存/ })).not.toBeInTheDocument();
    expect(api.workspaces).not.toHaveBeenCalled();
  });
  it("preserves the real unsaved form hidden and disabled through same-owner access error and retry", async () => {
    api.access.mockResolvedValueOnce({ access: accessFor() }).mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValue({ access: accessFor() });
    mount(); const staleSave = await fill();
    fireEvent.click(screen.getByText("Refresh fixture access"));
    await waitFor(() => expect(screen.getByTestId("access-state")).toHaveTextContent("error"));
    expect(screen.getByLabelText("標題")).toHaveValue(payload.title);
    expect(screen.getByLabelText("標題")).not.toBeVisible(); expect(screen.getByLabelText("標題")).toBeDisabled();
    await act(async () => { await expect(staleSave(payload)).rejects.toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" }); });
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重試權限檢查" }));
    await waitFor(() => expect(screen.getByLabelText("標題")).toBeVisible());
    expect(screen.getByLabelText("標題")).toHaveValue(payload.title);
    fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining(payload)));
  });
  it("discards denied drafts and prevents an old callback from reviving after regrant", async () => {
    api.access.mockResolvedValueOnce({ access: accessFor() }).mockResolvedValueOnce({ access: accessFor("operator") }).mockResolvedValue({ access: accessFor() });
    mount(); const staleSave = await fill(); fireEvent.click(screen.getByText("Refresh fixture access"));
    await waitFor(() => expect(screen.getByTestId("access-state")).toHaveTextContent("operator"));
    expect(screen.queryByLabelText("標題")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh fixture access"));
    expect(await screen.findByLabelText("標題")).toHaveValue("");
    await act(async () => { await expect(staleSave(payload)).rejects.toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" }); });
    expect(api.create).not.toHaveBeenCalled();
  });
  it.each(["identity", "workspace", "signout"])("clears the form on %s change and rejects retained handlers", async change => {
    const view = mount(); const staleSave = await fill();
    if (change === "identity") view.identity("staff-b");
    if (change === "workspace") { api.access.mockResolvedValue({ access: accessFor("workspace_admin", "w2") }); fireEvent.click(screen.getByText("Switch fixture workspace")); }
    if (change === "signout") { view.identity(null, false); expect(screen.queryByLabelText("標題")).not.toBeInTheDocument(); view.identity("staff-a"); }
    await waitFor(() => expect(screen.getByLabelText("標題")).toHaveValue(""));
    await act(async () => { await expect(staleSave(payload)).rejects.toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" }); });
    expect(api.create).not.toHaveBeenCalled(); expect(api.navigate).not.toHaveBeenCalled();
  });
  it("resets a bare-URL draft when the server resolves a different workspace", async () => {
    window.history.replaceState(null, "", "/admin/missions/new");
    api.access.mockResolvedValueOnce({ access: accessFor() }).mockResolvedValue({ access: accessFor("workspace_admin", "w2") });
    mount(); const staleSave = await fill(); fireEvent.click(screen.getByText("Refresh fixture access"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "品牌" })).toHaveValue("w2"));
    expect(screen.getByLabelText("標題")).toHaveValue("");
    await act(async () => { await expect(staleSave(payload)).rejects.toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" }); });
    expect(api.create).not.toHaveBeenCalled();
  });
  it("rejects a forged body workspace even from a currently allowed handler", async () => {
    mount(); const save = await fill();
    await act(async () => { await expect(save({ ...payload, workspace_id: "w2" })).rejects.toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" }); });
    expect(api.create).not.toHaveBeenCalled();
  });
  it("ignores a late success after owner change instead of navigating the next editor", async () => {
    let resolve!: (value: unknown) => void; api.create.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = mount(); await fill(); fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    view.identity("staff-b"); await waitFor(() => expect(screen.getByLabelText("標題")).toHaveValue(""));
    await act(async () => { resolve({ mission: { id: "old-owner-result" } }); });
    expect(api.navigate).not.toHaveBeenCalled();
  });
});
