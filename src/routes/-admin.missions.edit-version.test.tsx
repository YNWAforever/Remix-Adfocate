// src/routes/-admin.missions.edit-version.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchAdminMission: vi.fn(), updateMission: vi.fn() }));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useParams: () => ({ missionId: "m1" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "staff", email: "staff@example.test" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "w1" }) }));
vi.mock("@/components/admin/StaffAccessContext", () => ({
  useStaffAccess: () => ({
    access: { workspace: { id: "w1", slug: "w1", role: "workspace_admin", capabilities: ["mission.manage"], revision: 1 }, platformCapabilities: [], scopeStatus: null },
    loading: false, error: null, refresh: vi.fn(), can: (capability: string) => capability === "mission.manage",
  }),
}));
vi.mock("@/components/admin/useMissionEditorNavigation", () => ({
  useMissionEditorNavigation: () => ({ saved: vi.fn(), changed: vi.fn(), confirmDiscard: () => true }),
}));
vi.mock("@/components/admin/MissionManage", () => ({ MissionManage: () => null }));
// Stand-in for the real editor: like it, it keeps the form values it was mounted with.
vi.mock("@/components/admin/MissionEditor", () => ({
  MissionEditor: ({ initial, onSave }: { initial: { updated_at: string }; onSave: (body: unknown) => Promise<unknown> }) =>
    <><output>seen {initial.updated_at}</output><button type="button" onClick={() => void onSave({ title: "mine" })}>save</button></>,
}));
vi.mock("@/lib/admin", () => ({
  fetchAdminMission: h.fetchAdminMission, updateMission: h.updateMission,
  adminMissionKeys: { detail: (id: string) => ["md", id] }, AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.missions.$missionId";

describe("mission editor optimistic locking (F-022)", () => {
  it("saves against the version the editor was mounted with, not a later refetch", async () => {
    const mission = (updated_at: string) => ({ mission: { id: "m1", workspace_id: "w1", title: "任務", filled: 0, status: "draft", updated_at } });
    h.fetchAdminMission.mockResolvedValueOnce(mission("v1")).mockResolvedValue(mission("v2"));
    h.updateMission.mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as unknown as { component: React.ComponentType }).component;
    render(<QueryClientProvider client={qc}><C /></QueryClientProvider>);
    await screen.findByRole("button", { name: "save" });
    await act(() => qc.refetchQueries({ queryKey: ["md", "m1"] }));
    await screen.findByText("seen v2"); // the page has re-rendered with the newer copy
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(h.updateMission).toHaveBeenCalled());
    expect(h.updateMission).toHaveBeenCalledWith("m1", { title: "mine", expected_updated_at: "v1" });
  });
});
