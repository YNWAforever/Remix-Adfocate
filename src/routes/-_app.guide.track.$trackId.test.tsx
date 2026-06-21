import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode; to: string }) => <a href={p.to}>{p.children}</a> };
});

// a3 requires L2, a1 requires L0. Gating now uses RAW level + is_trusted.
const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", is_trusted: false } } as {
    data: { id: string; level: string; is_trusted: boolean } | null;
  },
  trackId: "a3",
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
}));

import { Route } from "./_app.guide.track.$trackId";
vi.spyOn(Route, "useParams").mockImplementation(() => ({ trackId: hoisted.trackId } as never));

function renderTrack() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

const A3_DESC = "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。";
const A3_TEASER = "升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。";

describe("Track detail page — gating", () => {
  it("locked (raw L1 < required L2): renders teaser, NOT description", () => {
    hoisted.me = { data: { id: "u1", level: "L1", is_trusted: false } };
    hoisted.trackId = "a3";
    renderTrack();

    expect(screen.getByText(A3_TEASER)).toBeInTheDocument();
    expect(screen.queryByText(A3_DESC)).not.toBeInTheDocument();
  });

  it("unlocked (raw L3 + trusted): renders description, NOT teaser", () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: true } };
    hoisted.trackId = "a3";
    renderTrack();

    expect(screen.getByText(A3_DESC)).toBeInTheDocument();
    expect(screen.queryByText(A3_TEASER)).not.toBeInTheDocument();
  });

  it("XP met but unverified: still locked, shows a verify CTA to /profile", () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: false } };
    hoisted.trackId = "a3";
    const { container } = renderTrack();

    expect(screen.getByText(A3_TEASER)).toBeInTheDocument();
    expect(screen.queryByText(A3_DESC)).not.toBeInTheDocument();
    expect(screen.getByText(/驗證社交帳號/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it("L0 track (a1) is always unlocked for any creator", () => {
    hoisted.me = { data: { id: "u1", level: "L0", is_trusted: false } };
    hoisted.trackId = "a1";
    renderTrack();

    expect(screen.getByText("由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。")).toBeInTheDocument();
  });

  it("shows a fallback for unknown trackId", () => {
    hoisted.me = { data: { id: "u1", level: "L3", is_trusted: true } };
    hoisted.trackId = "nonexistent";
    renderTrack();

    expect(screen.getByText("找不到課程。")).toBeInTheDocument();
  });
});
