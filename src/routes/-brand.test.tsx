import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandMe: vi.fn(),
  fetchBrandMissions: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandMe: h.fetchBrandMe,
  fetchBrandMissions: h.fetchBrandMissions,
  publishBrandMission: vi.fn(),
  closeBrandMission: vi.fn(),
  deleteBrandMission: vi.fn(),
  brandKeys: {
    me: () => ["brand-me"],
    missions: (s: string) => ["brand-missions", s],
    mission: (id: string) => ["brand-mission", id],
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
    Link: ({ to, children, ...p }: any) => <a href={to} {...p}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { BrandAuthGate } from "@/components/brand/BrandAuthGate";
import { Route as MissionsRoute } from "./brand.missions.index";
import { BrandAuthError } from "@/lib/brand";

function withClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("BrandAuthGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("shows loading then renders children when fetchBrandMe resolves", async () => {
    let resolve!: (v: unknown) => void;
    h.fetchBrandMe.mockReturnValue(new Promise((r) => { resolve = r; }));
    withClient(<BrandAuthGate>{(brand) => <div>OK {brand.workspaceName}</div>}</BrandAuthGate>);
    expect(screen.getByText("載入中…")).toBeInTheDocument();
    resolve({ brand: { email: "b@x", workspaceId: "w1", workspaceName: "Acme", role: "owner" } });
    await waitFor(() => expect(screen.getByText("OK Acme")).toBeInTheDocument());
  });

  it("shows the no-access card + sign-in link on a BrandAuthError", async () => {
    h.fetchBrandMe.mockRejectedValue(new BrandAuthError("403"));
    withClient(<BrandAuthGate>{() => <div>SHOULD NOT RENDER</div>}</BrandAuthGate>);
    await waitFor(() =>
      expect(screen.getByText("沒有品牌存取權 — 請聯絡你的 Fimmick 對接人。")).toBeInTheDocument(),
    );
    const link = screen.getByText("前往登入");
    expect(link.getAttribute("href")).toBe("/brand/login");
  });
});

describe("brand missions list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders a mission title and its status chip", async () => {
    h.fetchBrandMissions.mockResolvedValue({
      missions: [
        { id: "m1", slug: "test-x", title: "夏日企劃", status: "draft", mission_type: "ugc", points_reward: 100, cash_reward: null, filled: 0, quota: 10, deadline: null },
      ],
    });
    const C = MissionsRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("夏日企劃")).toBeInTheDocument());
    expect(screen.getByText("草稿")).toBeInTheDocument();
  });
});
