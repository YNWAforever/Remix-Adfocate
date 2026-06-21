import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", effective_level: "L1", level_seen: "L0" } as Record<string, unknown> },
  mark: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useMarkLevelSeen: () => ({ mutate: hoisted.mark, isPending: false }),
}));

import { LevelUpModal } from "./LevelUpModal";

describe("LevelUpModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.me = { data: { id: "u1", level: "L1", effective_level: "L1", level_seen: "L0" } };
  });

  it("shows the celebration when effective_level is ahead of level_seen", () => {
    render(<LevelUpModal />);
    expect(screen.getByText("🎉 你升級了！")).toBeInTheDocument();
    expect(screen.getByText("KOC 新手")).toBeInTheDocument();
  });

  it("calls markLevelSeen when 太好了 is tapped", () => {
    render(<LevelUpModal />);
    fireEvent.click(screen.getByText("太好了"));
    expect(hoisted.mark).toHaveBeenCalled();
  });

  it("renders nothing when level_seen has caught up to effective_level", () => {
    hoisted.me = { data: { id: "u1", level: "L1", effective_level: "L1", level_seen: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when level_seen is missing (no false celebration)", () => {
    hoisted.me = { data: { id: "u1", level: "L1", effective_level: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does NOT celebrate when raw level is L2 but effective_level is still L1 (untrusted transient)", () => {
    // raw XP crossed into L2 territory but creator not yet verified → effective capped at L1
    // level_seen was last stamped at L1 (effective) — no celebration should fire
    hoisted.me = { data: { id: "u1", level: "L2", effective_level: "L1", level_seen: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("celebrates when effective_level jumps L1→L2 (verification grants Trusted KOC)", () => {
    // creator just verified → effective_level finally becomes L2, level_seen still L1
    hoisted.me = { data: { id: "u1", level: "L2", effective_level: "L2", level_seen: "L1" } };
    render(<LevelUpModal />);
    expect(screen.getByText("🎉 你升級了！")).toBeInTheDocument();
    expect(screen.getByText("信譽 KOC")).toBeInTheDocument();
  });
});
