import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dict } from "@/lib/i18n.dict";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (p: { children: React.ReactNode; to: string; params?: Record<string, string> }) => {
      const href = p.params
        ? Object.entries(p.params).reduce((path, [key, value]) => path.replace(`$${key}`, value), p.to)
        : p.to;
      return <a href={href}>{p.children}</a>;
    },
  };
});

const hoisted = vi.hoisted(() => ({
  my: {
    data: [
      { id: "workflow-submission", status: "joined", content_urls: [], points_awarded: 0, created_at: "", creator_studio_available: true, creator_studio_state: "drafting", missions: { slug: "workflow-mission", title: "Workflow mission", points_reward: 100, mission_type: "ugc" } },
      { id: "legacy-submission", status: "submitted", content_urls: [], points_awarded: 0, created_at: "", creator_studio_available: false, creator_studio_state: null, missions: { slug: "legacy-mission", title: "Legacy mission", points_reward: 200, mission_type: "ugc" } },
      { id: "approved-legacy-submission", status: "approved", content_urls: [], points_awarded: 300, created_at: "", creator_studio_available: false, creator_studio_state: null, missions: { slug: "approved-legacy-mission", title: "Approved legacy mission", points_reward: 500, mission_type: "ugc" } },
    ],
    isLoading: false,
  },
}));

vi.mock("@/lib/queries/kocmax", () => ({ useMyMissions: () => hoisted.my }));

import { Route } from "./_app.my";

function renderMy() {
  const Component = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><Component /></QueryClientProvider>);
}

describe("My Missions", () => {
  it("keeps submissions grouped under their existing status headings", () => {
    renderMy();

    expect(screen.getByText(dict.zh["app.mission.statusJoined"])).toBeInTheDocument();
    expect(screen.getByText(dict.zh["app.mission.statusApplied"])).toBeInTheDocument();
    expect(screen.getByText(dict.zh["app.mission.statusApproved"])).toBeInTheDocument();
  });

  it("routes workflow-backed submissions into Creator Studio while retaining legacy mission links", () => {
    renderMy();

    expect(screen.getByText("Workflow mission").closest("a")).toHaveAttribute("href", "/my/workflow-submission");
    expect(screen.getByText("Legacy mission").closest("a")).toHaveAttribute("href", "/mission/legacy-mission");
  });

  it("preserves legacy reward and awarded-points labels", () => {
    renderMy();

    expect(screen.getByText(dict.zh["app.my.pointsReward"].replace("{n}", "100"))).toBeInTheDocument();
    expect(screen.getByText(dict.zh["app.my.pointsReward"].replace("{n}", "200"))).toBeInTheDocument();
    expect(screen.getByText(dict.zh["app.my.pointsAwarded"].replace("{n}", "300"))).toBeInTheDocument();
  });
});
