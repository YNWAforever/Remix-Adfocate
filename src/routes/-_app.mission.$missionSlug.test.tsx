import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> };
});

const hoisted = vi.hoisted(() => ({
  mission: { data: { slug: "m1", title: "美容試用", description: "d", category: "美容", access_type: "open", points_reward: 300, mission_type: "ugc", quota: 5, filled: 1, status: "active" }, isLoading: false, isError: false },
  my: { data: [] as unknown[], isLoading: false },
  join: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMission: () => hoisted.mission,
  useMyMissions: () => hoisted.my,
  useJoinMission: () => ({ mutateAsync: hoisted.join, isPending: false }),
  useSubmitMission: () => ({ mutateAsync: hoisted.submit, isPending: false }),
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
    hoisted.join.mockResolvedValue({ id: "s1", status: "joined" });
    hoisted.submit.mockResolvedValue({ id: "s1", status: "submitted" });
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

  it("disables the CTA for an application mission", () => {
    hoisted.mission.data.access_type = "application";
    renderDetail();
    expect(screen.getByText(/需要申請/)).toBeInTheDocument();
  });
});
