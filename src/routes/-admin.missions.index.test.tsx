// src/routes/-admin.missions.index.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(), fetchAdminMissions: vi.fn(), publishMission: vi.fn(), closeMission: vi.fn(), deleteMissionDraft: vi.fn(),
  duplicateMission: vi.fn(), navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useNavigate: () => h.navigate,
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchWorkspaces: h.fetchWorkspaces, fetchAdminMissions: h.fetchAdminMissions,
  publishMission: h.publishMission, closeMission: h.closeMission, deleteMissionDraft: h.deleteMissionDraft,
  duplicateMission: h.duplicateMission,
  adminMissionKeys: { workspaces: ["w"], list: (a: string, b: string) => ["m", a, b], detail: (id: string) => ["d", id] },
  AdminAuthError: class extends Error {}, AdminRequestError: class extends Error {},
}));

import { Route } from "./admin.missions.index";

function r() {
  const C = (Route as unknown as { component: React.ComponentType }).component;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin missions list", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists missions for the default workspace and shows a Publish action on drafts", async () => {
    h.fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: "w1", slug: "demo", name: "Demo" }] });
    h.fetchAdminMissions.mockResolvedValue({
      missions: [{ id: "m1", title: "草稿任務", slug: "test-x", mission_type: "ugc", status: "draft", engaged: false, points_reward: 100, cash_reward: null, filled: 0, quota: 10, deadline: null }],
    });
    h.publishMission.mockResolvedValue({});
    r();
    await screen.findByText("草稿任務");
    expect(screen.getByText("草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByText("發佈"));
    await waitFor(() => expect(h.publishMission).toHaveBeenCalledWith("m1"));
  });

  it("duplicates a mission and navigates to the new draft's editor", async () => {
    h.fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: "w1", slug: "demo", name: "Demo" }] });
    h.fetchAdminMissions.mockResolvedValue({ missions: [
      { id: "m1", slug: "ugc-1", title: "M1", status: "active", workspace_id: "w1", engaged: false },
    ] });
    h.duplicateMission.mockResolvedValue({ mission: { id: "m2" } });
    r();
    await screen.findByText("M1");
    fireEvent.click(screen.getByRole("button", { name: /複製/ }));
    await waitFor(() => expect(h.duplicateMission).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/admin/missions/$missionId", params: { missionId: "m2" } }),
    ));
  });
});
