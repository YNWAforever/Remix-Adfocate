import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Mission } from "@/lib/queries/kocmax";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, params }: { children: React.ReactNode; params?: { missionSlug?: string } }) => (
      <a href={params?.missionSlug ? `/mission/${params.missionSlug}` : "/mission"}>{children}</a>
    ),
  };
});

const richMission: Mission = {
  id: "mission-1",
  slug: "beauty-reel",
  title: "夏日美妝開箱",
  brand: "Glow Labs",
  category: "美容",
  mission_type: "ugc",
  access_type: "application",
  platforms: ["instagram", "tiktok"],
  deliverables: ["1 條 Reel", "3 個限時動態"],
  points_reward: 800,
  cash_reward: 1_200,
  deadline: "2026-08-31T00:00:00Z",
  effort: "medium",
  quota: 10,
  filled: 10,
  required_level: "L1",
  my_status: "submitted",
  status: "active",
};

const h = vi.hoisted(() => ({
  missions: { data: [] as Mission[] | undefined, isLoading: false, isError: false },
  useMe: vi.fn(() => ({ data: { level: "L1", is_trusted: true } })),
}));

vi.mock("@/lib/queries/kocmax", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/kocmax")>();
  return {
    ...actual,
    useMissions: () => h.missions,
    useMe: h.useMe,
  };
});

import { Route } from "./_app.mission.index";

function renderMissions() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

beforeEach(() => {
  h.missions = { data: [], isLoading: false, isError: false };
  h.useMe.mockClear();
});

describe("mission discovery", () => {
  it("renders rich API-backed facts and a mission-detail link", () => {
    h.missions = { data: [richMission], isLoading: false, isError: false };
    renderMissions();

    expect(screen.getByRole("heading", { level: 2, name: "所有任務" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /夏日美妝開箱/ })).toHaveAttribute("href", "/mission/beauty-reel");
    expect(screen.getByText("Glow Labs")).toBeInTheDocument();
    expect(screen.getByText("原創內容")).toBeInTheDocument();
    expect(screen.getByText("申請制")).toBeInTheDocument();
    expect(screen.getByText("Instagram、TikTok")).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel、3 個限時動態")).toBeInTheDocument();
    expect(screen.getByText(/HK\$1,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/2026.*8.*31/)).toBeInTheDocument();
    expect(screen.getByText("中")).toBeInTheDocument();
    expect(screen.getByText("暫不可參加")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("審批中")).toBeInTheDocument();
    expect(h.useMe).toHaveBeenCalledOnce();
  });

  it("shows an accessible loading state", () => {
    h.missions = { data: undefined, isLoading: true, isError: false };
    renderMissions();
    expect(screen.getByRole("status")).toHaveTextContent("載入任務中");
  });

  it("shows an accessible error state", () => {
    h.missions = { data: undefined, isLoading: false, isError: true };
    renderMissions();
    expect(screen.getByRole("alert")).toHaveTextContent("載入失敗");
  });

  it("shows the category empty state", () => {
    renderMissions();
    expect(screen.getByText("此分類暫無任務")).toBeInTheDocument();
  });
});
