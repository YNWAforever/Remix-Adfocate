import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>{children}</a>
    ),
  };
});

const h = vi.hoisted(() => ({
  match: { data: [] as unknown[] | undefined, isLoading: false, isError: false },
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMissionMatch: () => h.match }));

import { Route } from "./_app.match";

function renderMatch() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "m1", slug: "s1", title: "夏日美妝開箱", category: "美妝", mission_type: "ugc",
  required_level: "L0", points_reward: 200, cash_reward: null, deadline: "2026-06-30",
  quota: 10, filled: 0, fit_score: 92, reasons: ["啱你嘅美妝範疇"], rationale: "啱你嘅美妝範疇", locked: false, ...over,
});

beforeEach(() => { h.match = { data: [], isLoading: false, isError: false }; });

describe("Match page", () => {
  it("renders the heading", () => {
    renderMatch();
    expect(screen.getByText("今日整乜好？")).toBeInTheDocument();
  });

  it("renders ranked rows with a fit badge and rationale", () => {
    h.match = { data: [row()], isLoading: false, isError: false };
    renderMatch();
    expect(screen.getByText("夏日美妝開箱")).toBeInTheDocument();
    expect(screen.getByText("92% 啱你")).toBeInTheDocument();
    expect(screen.getByText("啱你嘅美妝範疇")).toBeInTheDocument();
  });

  it("renders a locked row's rationale", () => {
    h.match = { data: [row({ locked: true, rationale: "🔒 升級至 L1 解鎖", fit_score: 40 })], isLoading: false, isError: false };
    renderMatch();
    expect(screen.getByText("🔒 升級至 L1 解鎖")).toBeInTheDocument();
  });

  it("passes typed reward, fit, availability, and required-level context into the card", () => {
    h.match = { data: [row({ cash_reward: 800, filled: 10, required_level: "L2" })], isLoading: false, isError: false };
    renderMatch();

    expect(screen.getByText(/HK\$800\.00/)).toBeInTheDocument();
    expect(screen.getByText("原創內容")).toBeInTheDocument();
    expect(screen.getByText("L2")).toBeInTheDocument();
    expect(screen.getAllByText("暫不可參加")).toHaveLength(2);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("啱你嘅美妝範疇")).toBeInTheDocument();
    expect(screen.queryByText("可參加")).not.toBeInTheDocument();
    expect(screen.queryByText("需 L2 · 你係 L0")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no matches", () => {
    renderMatch();
    expect(screen.getByText("暫時冇啱你嘅任務，遲啲再嚟睇睇")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    h.match = { data: undefined, isLoading: false, isError: true };
    renderMatch();
    expect(screen.getByText("載入失敗，請重試")).toBeInTheDocument();
  });
});
