import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useParams: () => ({ token: "token-1" }),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  usePublicPassport: () => ({
    isLoading: false,
    isError: false,
    data: {
      creator: { displayName: "阿明", avatarUrl: null, level: "L1", xp: 500 },
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["social_linked"],
      socialTrustBadges: ["social_scan_connected", "active_creator", "internal_only_flag"],
      profileMedia: {
        publishedAt: "2026-06-18T00:00:00.000Z",
        highlights: [
          {
            url: "https://example.com/public",
            title: "Public campaign",
            platform_type: "website",
            caption: "Launch recap",
            sort_order: 1,
          },
        ],
      },
    },
  }),
}));

import { Route } from "./passport.$token";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("public passport route", () => {
  it("renders only public-safe trust badges", () => {
    renderRoute();
    expect(screen.getByText("阿明")).toBeInTheDocument();
    expect(screen.getByText("Social scan connected")).toBeInTheDocument();
    expect(screen.getByText("Active creator")).toBeInTheDocument();
    expect(screen.getByText("Creator highlights")).toBeInTheDocument();
    expect(screen.getByText("Public campaign")).toBeInTheDocument();
    expect(screen.getByText("Launch recap")).toBeInTheDocument();
    expect(screen.queryByText("internal_only_flag")).not.toBeInTheDocument();
    expect(screen.queryByText("已連結社交")).not.toBeInTheDocument();
    expect(screen.queryByText(/followers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/engagement/i)).not.toBeInTheDocument();
  });
});
