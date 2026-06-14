import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", display_name: "阿明", avatar_url: null } },
  passport: {
    data: {
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["level_l1", "social_linked"],
    },
    isLoading: false,
    isError: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useMyPassport: () => hoisted.passport,
}));

import { Route } from "./_app.passport";

function renderPassport() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

describe("Passport page", () => {
  it("renders the four score labels and a computed value", () => {
    renderPassport();
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("可靠度")).toBeInTheDocument();
    expect(screen.getByText("品牌安全")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("renders locked rings as 敬請期待 (content + brand safety + null reliability)", () => {
    renderPassport();
    expect(screen.getAllByText("敬請期待").length).toBeGreaterThanOrEqual(2);
  });

  it("renders earned badge labels", () => {
    renderPassport();
    expect(screen.getByText("升級者")).toBeInTheDocument();
    expect(screen.getByText("已連結社交")).toBeInTheDocument();
  });
});
