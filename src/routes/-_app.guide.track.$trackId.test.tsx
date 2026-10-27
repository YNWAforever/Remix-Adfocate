import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcademyTrack } from "@/lib/academy";
import { ApiError } from "@/lib/api";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (p: { children: React.ReactNode; to: string; params?: Record<string, string>; className?: string; "aria-label"?: string }) => {
      const href = p.to.replace(/\$(\w+)/g, (_, k) => p.params?.[k] ?? k);
      return <a href={href} className={p.className} aria-label={p["aria-label"]}>{p.children}</a>;
    },
    useParams: () => ({ trackId: hoisted.trackId }),
  };
});

// a3 requires L2, a1 requires L0. Gating uses RAW level + is_trusted (see eligibility() in missionMeta.ts).
const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", is_trusted: false } } as {
    data: { id: string; level: string; is_trusted: boolean } | null;
  },
  trackId: "a3",
  fetchAcademyTrack: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
}));

vi.mock("@/lib/academy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/academy")>();
  return {
    ...actual,
    fetchAcademyTrack: hoisted.fetchAcademyTrack,
  };
});

import { Route } from "./_app.guide.track.$trackId";

function renderTrack() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <C />
    </QueryClientProvider>,
  );
}

const A3_TRACK: AcademyTrack = {
  id: "t3", kind: "track", slug: "a3", title: "Reels 剪接攻略",
  excerpt: "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。",
  body: "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。",
  requiredLevel: "L2", emoji: "🎬", color: "purple", sort: 2,
  meta: {
    duration: "3堂課",
    levelLabel: "L2",
    teaser_zh: "升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。",
    teaser_en: "Reach Trusted KOC to unlock Reels growth tactics and algorithm tips.",
  },
};

const A1_TRACK: AcademyTrack = {
  id: "t1", kind: "track", slug: "a1", title: "KOC新手訓練營",
  excerpt: "由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。",
  body: "由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。",
  requiredLevel: "L0", emoji: "🌱", color: "pink", sort: 0,
  meta: { duration: "4堂課", levelLabel: "L0–L1", teaser_zh: "解鎖基礎", teaser_en: "Unlock the basics" },
};

const A3_DESC = "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。";
const A3_TEASER = "升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("lang", "zh");
});

describe("Track detail page — gating", () => {
  it("locked (raw L1 < required L2): renders teaser, NOT description", async () => {
    hoisted.me = { data: { id: "u1", level: "L1", is_trusted: false } };
    hoisted.trackId = "a3";
    hoisted.fetchAcademyTrack.mockResolvedValue({ item: A3_TRACK });
    renderTrack();

    await waitFor(() => expect(screen.getByText(A3_TEASER)).toBeInTheDocument());
    expect(screen.queryByText(A3_DESC)).not.toBeInTheDocument();
  });

  it("unlocked (raw L3 + trusted): renders description, NOT teaser", async () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: true } };
    hoisted.trackId = "a3";
    hoisted.fetchAcademyTrack.mockResolvedValue({ item: A3_TRACK });
    renderTrack();

    await waitFor(() => expect(screen.getByText(A3_DESC)).toBeInTheDocument());
    expect(screen.queryByText(A3_TEASER)).not.toBeInTheDocument();
  });

  it("XP met but unverified: still locked, shows a verify CTA to /profile", async () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: false } };
    hoisted.trackId = "a3";
    hoisted.fetchAcademyTrack.mockResolvedValue({ item: A3_TRACK });
    const { container } = renderTrack();

    await waitFor(() => expect(screen.getByText(A3_TEASER)).toBeInTheDocument());
    expect(screen.queryByText(A3_DESC)).not.toBeInTheDocument();
    expect(screen.getByText(/驗證社交帳號/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it("L0 track (a1) is always unlocked for any creator", async () => {
    hoisted.me = { data: { id: "u1", level: "L0", is_trusted: false } };
    hoisted.trackId = "a1";
    hoisted.fetchAcademyTrack.mockResolvedValue({ item: A1_TRACK });
    renderTrack();

    await waitFor(() =>
      expect(screen.getByText("由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。")).toBeInTheDocument(),
    );
  });

  it("shows a fallback for an unknown trackId (fetch error)", async () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: true } };
    hoisted.trackId = "nonexistent";
    hoisted.fetchAcademyTrack.mockRejectedValue(new ApiError(404, "not_found", "not found"));
    renderTrack();

    await waitFor(() => expect(screen.getByText("找不到課程。")).toBeInTheDocument());
  });
});
