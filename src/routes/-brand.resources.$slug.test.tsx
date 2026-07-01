import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandResource: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandResource: h.fetchBrandResource,
  brandKeys: { resource: (slug: string) => ["brand-resource", slug] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/lib/admin", () => ({ AdminRequestError: class extends Error {} }));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({
    brand: { email: "b@x", workspaceId: "w1", workspaceName: "Acme", role: "owner" },
    reportAuthError: h.reportAuthError,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useParams: () => ({ slug: "budget-explainer" }),
  };
});

import { Route as ResourceDetailRoute } from "./brand.resources.$slug";

function withClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("brand resource detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders the title and markdown body, with no related-articles block", async () => {
    h.fetchBrandResource.mockResolvedValue({
      item: {
        id: "r1", slug: "budget-explainer", kind: "article", title: "預算解說",
        excerpt: null, body: "# 標題\n\n內容", coverImageUrl: null,
        publishedAt: "2026-01-01T00:00:00Z", pinned: false, views: 3,
      },
    });
    const C = ResourceDetailRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("預算解說")).toBeInTheDocument());
    expect(screen.queryByText("相關內容")).not.toBeInTheDocument();
  });
});
