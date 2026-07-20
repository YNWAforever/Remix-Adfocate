import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, params, children }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, encodeURIComponent(value)),
        to,
      );
      return <a href={href}>{children}</a>;
    },
  };
});
vi.mock("@/components/HookPanel", () => ({ HookPanel: () => <div>HOOK_PANEL</div> }));

const hoisted = vi.hoisted(() => ({
  mission: { data: { id: "mission-1", slug: "m1", title: "美容試用", description: "d", category: "美容", access_type: "open", points_reward: 300, mission_type: "ugc", quota: 5, filled: 1, status: "active", deliverables: [] as string[], requirements: [] as string[], platforms: [] as string[] }, isLoading: false, isError: false },
  my: { data: [] as unknown[], isLoading: false },
  me: { data: { level: "L0", is_trusted: true, onboarding_completed: false } },
  matches: { data: [] as unknown[], isLoading: false, isError: false },
  join: vi.fn(),
  submit: vi.fn(),
  useSubmitMission: vi.fn(),
  apply: vi.fn(),
  track: vi.fn(),
  joinError: null as Error | null,
  applyError: null as Error | null,
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMission: () => hoisted.mission,
  useMyMissions: () => hoisted.my,
  useJoinMission: () => ({ mutateAsync: hoisted.join, isPending: false, isError: hoisted.joinError !== null, error: hoisted.joinError }),
  useSubmitMission: (...args: unknown[]) => {
    hoisted.useSubmitMission(...args);
    return { mutateAsync: hoisted.submit, isPending: false };
  },
  useApplyMission: () => ({ mutateAsync: hoisted.apply, isPending: false, isError: hoisted.applyError !== null, error: hoisted.applyError }),
  useMe: () => hoisted.me,
  useMissionMatch: () => hoisted.matches,
}));
vi.mock("@/lib/activationAnalytics", () => ({ trackActivationEvent: hoisted.track }));

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
    hoisted.me.data = { level: "L0", is_trusted: true, onboarding_completed: false };
    hoisted.matches.data = [];
    hoisted.matches.isError = false;
    hoisted.joinError = null;
    hoisted.applyError = null;
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

  it("links active joined missions to the workspace without mounting the legacy submission form", () => {
    hoisted.my.data = [{
      id: "sub-1", status: "joined", creator_workflow_mode: "active_workspace", active_workflow_id: "workflow-1",
      content_urls: [], points_awarded: 0, created_at: "",
      missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc", creator_workflow_mode: "active_workspace" },
    }];

    renderDetail();

    expect(screen.getByRole("link", { name: "繼續任務" })).toHaveAttribute("href", "/my/sub-1");
    expect(screen.queryByPlaceholderText(/貼上你的內容連結/)).not.toBeInTheDocument();
    expect(hoisted.useSubmitMission).not.toHaveBeenCalled();
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
    expect(screen.getAllByText("交付內容")).toHaveLength(2);
    expect(screen.getAllByText("1 條 Reel")).toHaveLength(2);
  });

  it("shows verify copy and /profile link when join returns verification_required 409", () => {
    hoisted.joinError = new ApiError(409, "verification_required", "verification required");
    renderDetail();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("驗證社交帳號以解鎖此任務")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /立即驗證/i });
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("shows a friendly message for level_locked error", () => {
    hoisted.joinError = new ApiError(409, "level_locked", "level locked");
    renderDetail();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("你的等級未符合此任務要求")).toBeInTheDocument();
  });

  it("shows a generic fallback for an unknown error code", () => {
    hoisted.joinError = new ApiError(500, "unknown_error", "unexpected");
    renderDetail();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("操作失敗，請重試。")).toBeInTheDocument();
  });

  it("puts the commitment summary immediately before Join without replacing the join handler", async () => {
    hoisted.mission.data.deliverables = ["1 條 Reel"];
    renderDetail();

    const summary = screen.getByRole("heading", { name: "參加前確認" }).closest("section");
    const joinButton = screen.getByRole("button", { name: "加入任務" });
    expect(summary).not.toBeNull();
    expect(summary!.compareDocumentPosition(joinButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(joinButton);
    await waitFor(() => expect(hoisted.join).toHaveBeenCalledOnce());
  });

  it("puts the commitment summary immediately before Apply without replacing the apply handler", async () => {
    hoisted.mission.data.access_type = "application";
    renderDetail();

    const summary = screen.getByRole("heading", { name: "參加前確認" }).closest("section");
    const applyButton = screen.getByRole("button", { name: "申請任務" });
    expect(summary).not.toBeNull();
    expect(summary!.compareDocumentPosition(applyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(applyButton);
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalledOnce());
  });

  it("emits one typed PII-free mission_viewed event per mission on the mounted detail", async () => {
    renderDetail();

    await waitFor(() =>
      expect(hoisted.track).toHaveBeenCalledWith("mission_viewed", {
        locale: "zh",
        missionId: "mission-1",
        missionType: "ugc",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成內容靈感" }));
    const missionViews = hoisted.track.mock.calls.filter(([name]) => name === "mission_viewed");
    expect(missionViews).toHaveLength(1);
    expect(JSON.stringify(missionViews[0])).not.toMatch(/美容試用|display_name|email|creator/i);
  });

  it("emits creator_activated once when onboarding is complete and the mission is a suitable unlocked match", async () => {
    hoisted.me.data.onboarding_completed = true;
    hoisted.matches.data = [{
      id: "mission-1", slug: "m1", title: "美容試用", category: "美容", mission_type: "ugc",
      required_level: "L0", points_reward: 300, cash_reward: null, deadline: null,
      quota: 5, filled: 1, fit_score: 91, reasons: ["美容"], rationale: "符合美容興趣", locked: false,
    }];
    renderDetail();

    await waitFor(() =>
      expect(hoisted.track).toHaveBeenCalledWith("creator_activated", {
        locale: "zh",
        activationPath: "mission_viewed",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成內容靈感" }));
    expect(hoisted.track.mock.calls.filter(([name]) => name === "creator_activated")).toHaveLength(1);
  });

  it("does not activate a creator for a locked match", async () => {
    hoisted.me.data.onboarding_completed = true;
    hoisted.matches.data = [{ id: "mission-1", locked: true }];
    renderDetail();
    await waitFor(() => expect(hoisted.track).toHaveBeenCalledWith("mission_viewed", expect.any(Object)));
    expect(hoisted.track).not.toHaveBeenCalledWith("creator_activated", expect.any(Object));
  });
});
