import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> };
});

const hoisted = vi.hoisted(() => ({
  my: {
    data: [
      { id: "a", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "進行任務", points_reward: 100, mission_type: "ugc" } },
      { id: "b", status: "submitted", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m2", title: "審批任務", points_reward: 200, mission_type: "ugc" } },
      { id: "c", status: "approved", content_urls: [], points_awarded: 300, created_at: "", missions: { slug: "m3", title: "完成任務", points_reward: 300, mission_type: "ugc" } },
    ],
    isLoading: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMyMissions: () => hoisted.my }));

import { Route } from "./_app.my";
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
});
