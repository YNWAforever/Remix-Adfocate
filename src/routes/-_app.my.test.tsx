import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyMission } from "@/lib/queries/kocmax";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children: React.ReactNode }) => {
      const href = to.replace("$missionSlug", params?.missionSlug ?? "").replace("$submissionId", params?.submissionId ?? "");
      return <a href={href}>{children}</a>;
    },
  };
});

const hoisted = vi.hoisted(() => ({
  my: {
    data: [
      { id: "a", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "進行任務", points_reward: 100, mission_type: "ugc" } },
      { id: "b", status: "submitted", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m2", title: "審批任務", points_reward: 200, mission_type: "ugc" } },
      { id: "c", status: "approved", content_urls: [], points_awarded: 300, created_at: "", missions: { slug: "m3", title: "完成任務", points_reward: 300, mission_type: "ugc" } },
    ] as MyMission[],
    isLoading: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMyMissions: () => hoisted.my }));

import { Route } from "./_app.my.index";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderMy() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("My Missions", () => {
  it("groups submissions under status headings", () => {
    renderMy();
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("審批中")).toBeInTheDocument();
    expect(screen.getByText("已通過")).toBeInTheDocument();
    expect(screen.getByText("進行任務")).toBeInTheDocument();
    expect(screen.getByText("完成任務")).toBeInTheDocument();
  });

  it("links active joined work to its submission workspace and keeps legacy links unchanged", () => {
    hoisted.my.data = [
      {
        id: "active-sub", status: "joined", creator_workflow_mode: "active_workspace", active_workflow_id: "wf-1",
        content_urls: [], points_awarded: 0, created_at: "",
        missions: { slug: "active", title: "Active mission", points_reward: 100, mission_type: "ugc", creator_workflow_mode: "active_workspace" },
      },
      {
        id: "legacy-sub", status: "joined", creator_workflow_mode: "legacy", active_workflow_id: null,
        content_urls: [], points_awarded: 0, created_at: "",
        missions: { slug: "legacy", title: "Legacy mission", points_reward: 100, mission_type: "ugc", creator_workflow_mode: "legacy" },
      },
    ];
    renderMy();
    expect(screen.getByRole("link", { name: /Active mission/ })).toHaveAttribute("href", "/my/active-sub");
    expect(screen.getByRole("link", { name: /Legacy mission/ })).toHaveAttribute("href", "/mission/legacy");
  });
});
