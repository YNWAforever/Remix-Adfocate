import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandResources: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandResources: h.fetchBrandResources,
  brandKeys: {
    resources: (page: number) => ["brand-resources", page],
  },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Link: ({ to, params, children, ...p }: any) => {
      const href = params
        ? String(to).replace(/\$(\w+)/g, (_: string, k: string) => String(params[k]))
        : to;
      return <a href={href} {...p}>{children}</a>;
    },
    useNavigate: () => vi.fn(),
  };
});

import { Route as ResourcesRoute } from "./brand.resources.index";

function withClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("brand resources list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders a resource title and links to its slug", async () => {
    h.fetchBrandResources.mockResolvedValue({
      items: [
        { id: "r1", slug: "budget-explainer", kind: "article", title: "預算解說", excerpt: "了解你的錢包", coverImageUrl: null, publishedAt: "2026-01-01T00:00:00Z", pinned: false, views: 0 },
      ],
      page: 1, pageSize: 20, total: 1,
    });
    const C = ResourcesRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("預算解說")).toBeInTheDocument());
    const link = screen.getByText("預算解說").closest("a");
    expect(link?.getAttribute("href")).toBe("/brand/resources/budget-explainer");
  });

  it("shows the empty state when there are no items", async () => {
    h.fetchBrandResources.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const C = ResourcesRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("暫時未有內容。")).toBeInTheDocument());
  });
});
