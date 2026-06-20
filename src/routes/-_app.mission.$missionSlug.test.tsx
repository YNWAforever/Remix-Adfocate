import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a href="/">{p.children}</a> };
});
vi.mock("@/components/HookPanel", () => ({ HookPanel: () => <div>HOOK_PANEL</div> }));

const hoisted = vi.hoisted(() => ({
  mission: { data: { slug: "m1", title: "美容試用", description: "d", category: "美容", access_type: "open", points_reward: 300, mission_type: "ugc", quota: 5, filled: 1, status: "active", deliverables: [] as string[], requirements: [] as string[], platforms: [] as string[] }, isLoading: false, isError: false },
  my: { data: [] as unknown[], isLoading: false },
  join: vi.fn(),
  submit: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMission: () => hoisted.mission,
  useMyMissions: () => hoisted.my,
  useJoinMission: () => ({ mutateAsync: hoisted.join, isPending: false }),
  useSubmitMission: () => ({ mutateAsync: hoisted.submit, isPending: false }),
  useApplyMission: () => ({ mutateAsync: hoisted.apply, isPending: false }),
  useMe: () => ({ data: { level: "L0" } }),
}));

import { Route } from "./_app.mission.$missionSlug";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo", missionSlug: "m1" } as never);

function renderDetail() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Mission detail writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.my.data = [];
    hoisted.mission.data.access_type = "open";
    hoisted.mission.data.deliverables = [];
    hoisted.mission.data.requirements = [];
    hoisted.mission.data.platforms = [];
    hoisted.mission.data.description = "d";
    hoisted.join.mockResolvedValue({ id: "s1", status: "joined" });
    hoisted.submit.mockResolvedValue({ id: "s1", status: "submitted" });
    hoisted.apply.mockResolvedValue({ id: "s1", status: "applied" });
  });

  it("shows the Join CTA for an open, un-joined mission", () => {
    renderDetail();
    expect(screen.getByText("加入任務")).toBeInTheDocument();
  });

  it("calls join when the CTA is clicked", async () => {
    renderDetail();
    fireEvent.click(screen.getByText("加入任務"));
    await waitFor(() => expect(hoisted.join).toHaveBeenCalled());
  });

  it("shows the submit form once joined", () => {
    hoisted.my.data = [{ id: "s1", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByPlaceholderText(/貼上你的內容連結/)).toBeInTheDocument();
  });

  it("submits the entered URLs", async () => {
    hoisted.my.data = [{ id: "s1", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    fireEvent.change(screen.getByPlaceholderText(/貼上你的內容連結/), { target: { value: "https://ig.com/p/a" } });
    fireEvent.click(screen.getByRole("button", { name: "提交內容" }));
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledWith({ content_urls: ["https://ig.com/p/a"] }));
  });

  it("shows the apply CTA for an application mission and applies", async () => {
    hoisted.mission.data.access_type = "application";
    renderDetail();
    fireEvent.click(screen.getByText("申請任務"));
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalled());
  });

  it("shows 審批中 once an application is pending", () => {
    hoisted.mission.data.access_type = "application";
    hoisted.my.data = [{ id: "s1", status: "applied", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByText("審批中")).toBeInTheDocument();
  });

  it("shows 未獲接受 for a declined application", () => {
    hoisted.mission.data.access_type = "application";
    hoisted.my.data = [{ id: "s1", status: "declined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByText("未獲接受")).toBeInTheDocument();
  });

  it("reveals the hook generator panel when the CTA is clicked", () => {
    renderDetail();
    expect(screen.queryByText("HOOK_PANEL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成內容靈感" }));
    expect(screen.getByText("HOOK_PANEL")).toBeInTheDocument();
  });

  it("shows the facts grid (spots left)", () => {
    renderDetail();
    expect(screen.getByText("尚餘 4 個")).toBeInTheDocument(); // quota 5 - filled 1
  });

  it("renders brief deliverables when present", () => {
    hoisted.mission.data.deliverables = ["1 條 Reel"];
    renderDetail();
    expect(screen.getByText("交付內容")).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel")).toBeInTheDocument();
  });
});
