import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: {
    data: {
      id: "u1",
      display_name: "阿明",
      level: "L0",
      effective_level: "L0",
      xp: 0,
    },
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
}));

import { Route } from "./_app.guide.index";

function renderHub() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

beforeEach(() => {
  hoisted.me = {
    data: {
      id: "u1",
      display_name: "阿明",
      level: "L0",
      effective_level: "L0",
      xp: 0,
    },
    isLoading: false,
    isError: false,
  };
});

describe("GuideHub page", () => {
  it("renders the Quick Guides section heading", () => {
    renderHub();
    expect(screen.getByText("快速指南")).toBeInTheDocument();
  });

  it("renders the Playbooks section heading", () => {
    renderHub();
    expect(screen.getByText("攻略庫")).toBeInTheDocument();
  });

  it("renders the Creator Academy section heading", () => {
    renderHub();
    expect(screen.getByText("創作者學院")).toBeInTheDocument();
  });

  it("renders a known guide doc title", () => {
    renderHub();
    // "account" doc → titleKey "app.guide.doc.account" → zh "帳戶"
    expect(screen.getByText("帳戶")).toBeInTheDocument();
  });

  it("renders the first academy track title", () => {
    renderHub();
    expect(screen.getByText("KOC新手訓練營")).toBeInTheDocument();
  });

  it("shows progress count when creatorId is present", () => {
    renderHub();
    // guideDocs.length = 8, readCount = 0 (nothing in localStorage)
    expect(screen.getByText("0/8 已讀")).toBeInTheDocument();
  });

  it("hides progress count when not logged in", () => {
    hoisted.me = { data: undefined, isLoading: false, isError: false };
    renderHub();
    expect(screen.queryByText(/已讀/)).not.toBeInTheDocument();
  });
});
