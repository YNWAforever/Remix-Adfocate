import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode; to: string }) => <a href={p.to}>{p.children}</a> };
});

// academyTracks: a3 requires L2, a1 requires L0
const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", effective_level: "L1" } } as { data: { id: string; level: string; effective_level: string } | null },
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

describe("Track detail page — gating", () => {
  it("locked (effective L1, required L2): renders teaser, NOT description", () => {
    hoisted.me = { data: { id: "u1", level: "L1", effective_level: "L1" } };
    hoisted.trackId = "a3";
    renderTrack();

    // t("app.guide.teaser.a3") → zh: "升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。"
    expect(screen.getByText("升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。")).toBeInTheDocument();
    // t("app.guide.unlockAt", { level: "信譽 KOC" }) → "信譽 KOC 解鎖"
    expect(screen.getByText("信譽 KOC 解鎖")).toBeInTheDocument();
    // Description must NOT be shown
    expect(screen.queryByText("掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。")).not.toBeInTheDocument();
  });

  it("unlocked (effective L3): renders description, NOT teaser", () => {
    hoisted.me = { data: { id: "u1", level: "L3", effective_level: "L3" } };
    hoisted.trackId = "a3";
    renderTrack();

    expect(screen.getByText("掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。")).toBeInTheDocument();
    expect(screen.queryByText("升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。")).not.toBeInTheDocument();
  });

  it("uses effective_level over level for gating", () => {
    // level=L3 but effective_level=L1 → still locked for L2 track
    hoisted.me = { data: { id: "u1", level: "L3", effective_level: "L1" } };
    hoisted.trackId = "a3";
    renderTrack();

    expect(screen.getByText("升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。")).toBeInTheDocument();
    expect(screen.queryByText("掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。")).not.toBeInTheDocument();
  });

  it("L0 track (a1) is always unlocked for any creator", () => {
    hoisted.me = { data: { id: "u1", level: "L0", effective_level: "L0" } };
    hoisted.trackId = "a1";
    renderTrack();

    expect(screen.getByText("由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。")).toBeInTheDocument();
    // teaser zh: "解鎖基礎：了解 KOC 任務流程，賺取你的第一批積分。" — must NOT appear
    expect(screen.queryByText("解鎖基礎：了解 KOC 任務流程，賺取你的第一批積分。")).not.toBeInTheDocument();
  });

  it("shows a fallback for unknown trackId", () => {
    hoisted.me = { data: { id: "u1", level: "L3", effective_level: "L3" } };
    hoisted.trackId = "nonexistent";
    renderTrack();

    expect(screen.getByText("找不到課程。")).toBeInTheDocument();
  });
});
