import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcademyBundle } from "@/lib/academy";

type MeData = { id: string; level: string; is_trusted: boolean };
type HoistedMe = { data: MeData | undefined; isLoading: boolean; isError: boolean };

const hoisted = vi.hoisted(() => ({
  me: {
    data: { id: "u1", level: "L0", is_trusted: false } as MeData | undefined,
    isLoading: false,
    isError: false,
  } as HoistedMe,
  fetchAcademy: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
}));

vi.mock("@/lib/academy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/academy")>();
  return {
    ...actual,
    fetchAcademy: hoisted.fetchAcademy,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (p: { children: React.ReactNode; to: string; params?: Record<string, string>; className?: string }) => {
      const href = p.to.replace(/\$(\w+)/g, (_, k) => p.params?.[k] ?? k);
      return <a href={href} className={p.className}>{p.children}</a>;
    },
  };
});

import { Route } from "./_app.guide.index";

function renderHub() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <C />
    </QueryClientProvider>,
  );
}

const bundle: AcademyBundle = {
  docs: [
    { id: "d1", kind: "guide_doc", slug: "leveling", title: "等級制度", excerpt: null, category: "start", emoji: "⭐", sort: 1 },
  ],
  tracks: [
    {
      id: "t1", kind: "track", slug: "a1", title: "KOC新手訓練營", excerpt: "由零開始了解KOC任務流程", requiredLevel: "L0",
      emoji: "🌱", color: "pink", sort: 0,
      meta: { duration: "4堂課", levelLabel: "L0–L1", teaser_zh: "解鎖基礎", teaser_en: "Unlock the basics" },
    },
  ],
  playbooks: [
    { id: "p1", kind: "playbook", slug: "pb1", title: "開箱攻略", emoji: "📦", color: "yellow", sort: 0, meta: { levels: ["L0"], creatorAngle: "示範真實使用情境" } },
  ],
  resources: [
    { id: "r1", kind: "resource", slug: "res1", title: "品牌指南範本", emoji: "📄", sort: 0, meta: { type: "pdf", fileUrl: null } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("lang", "zh");
  hoisted.me = { data: { id: "u1", level: "L0", is_trusted: false }, isLoading: false, isError: false };
  hoisted.fetchAcademy.mockResolvedValue(bundle);
});

describe("GuideHub page", () => {
  it("renders the Quick Guides section heading", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("快速指南")).toBeInTheDocument());
  });

  it("renders the Playbooks section heading", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("攻略庫")).toBeInTheDocument());
  });

  it("renders the Creator Academy section heading", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("創作者學院")).toBeInTheDocument());
  });

  it("renders a guide doc title from the fetched bundle", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("等級制度")).toBeInTheDocument());
  });

  it("renders an academy track title from the fetched bundle", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("KOC新手訓練營")).toBeInTheDocument());
  });

  it("renders a playbook and a resource from the fetched bundle", async () => {
    renderHub();
    await waitFor(() => expect(screen.getByText("開箱攻略")).toBeInTheDocument());
    expect(screen.getByText("品牌指南範本")).toBeInTheDocument();
  });

  it("shows progress count when creatorId is present", async () => {
    renderHub();
    // docs.length = 1, readCount = 0 (nothing in localStorage)
    await waitFor(() => expect(screen.getByText("0/1 已讀")).toBeInTheDocument());
  });

  it("hides progress count when not logged in", async () => {
    hoisted.me = { data: undefined, isLoading: false, isError: false };
    renderHub();
    await waitFor(() => expect(screen.getByText("等級制度")).toBeInTheDocument());
    expect(screen.queryByText(/已讀/)).not.toBeInTheDocument();
  });

  it("calls fetchAcademy with the bundle query key for the active language", async () => {
    renderHub();
    await waitFor(() => expect(hoisted.fetchAcademy).toHaveBeenCalledWith("zh-HK"));
  });
});
