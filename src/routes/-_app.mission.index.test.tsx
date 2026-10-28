import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mission } from "@/lib/queries/kocmax";
import { ApiError } from "@/lib/api";

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
  missions: { data: [] as Mission[] | undefined, isLoading: false, isError: false } as {
    data: Mission[] | undefined; isLoading: boolean; isError: boolean; error?: Error | null; refetch?: () => Promise<unknown>;
  },
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<Component />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

beforeEach(() => {
  h.missions = { data: [], isLoading: false, isError: false };
  h.useMe.mockClear();
});

describe("mission discovery", () => {
  it("retains the selected filter and stale facts on retry, then hides protected cached facts on 403", () => {
    const retry=vi.fn().mockResolvedValue({});
    h.missions={data:[{...richMission,category:"旅遊"}],isLoading:false,isError:true,error:new ApiError(503,"UNAVAILABLE","offline"),refetch:retry};
    const {rerender}=renderMissions();
    fireEvent.click(screen.getByRole("button",{name:"旅遊"}));
    fireEvent.click(screen.getByRole("button",{name:/重試/}));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button",{name:"旅遊"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("link",{name:/夏日美妝開箱/})).toBeInTheDocument();
    h.missions.error=new ApiError(403,"FORBIDDEN","denied");
    const Component=Route.options.component as React.ComponentType;rerender(<Component />);
    expect(screen.queryByRole("link",{name:/夏日美妝開箱/})).not.toBeInTheDocument();
    expect(screen.queryByText("此分類暫無任務")).not.toBeInTheDocument();
  });
  it("keeps pet, travel aliases and unknown long categories separately filterable", () => {
    h.missions = { data: [
      {...richMission,id:"pet",slug:"pet",title:"寵物任務",category:"寵物"},
      {...richMission,id:"travel",slug:"travel",title:"歷史旅遊任務",category:"travel"},
      {...richMission,id:"custom",slug:"custom",title:"自訂任務",category:"原有未知長中文分類"},
    ],isLoading:false,isError:false };
    renderMissions();
    fireEvent.click(screen.getByRole("button",{name:"寵物"}));
    expect(screen.getByRole("link",{name:/寵物任務/})).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/歷史旅遊任務/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"旅遊"}));
    expect(screen.getByRole("link",{name:/歷史旅遊任務/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"原有未知長中文分類"}));
    expect(screen.getByRole("link",{name:/自訂任務/})).toBeInTheDocument();
  });
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
    expect(screen.queryByText("需 L1 · 你符合")).not.toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("審批中")).toBeInTheDocument();
    expect(h.useMe).toHaveBeenCalledOnce();
  });

  it.each([
    ["applied", "審批中"],
    ["declined", "未獲接受"],
  ] as const)("labels the real %s application state without calling it expired", (myStatus, label) => {
    h.missions = {
      data: [{ ...richMission, id: `mission-${myStatus}`, slug: myStatus, my_status: myStatus }],
      isLoading: false,
      isError: false,
    };
    renderMissions();

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("已過期")).not.toBeInTheDocument();
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
