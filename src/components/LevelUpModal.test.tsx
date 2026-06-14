import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", level_seen: "L0" } as Record<string, unknown> },
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
    hoisted.me = { data: { id: "u1", level: "L1", level_seen: "L0" } };
  });

  it("shows the celebration when level is ahead of level_seen", () => {
    render(<LevelUpModal />);
    expect(screen.getByText("🎉 你升級了！")).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
  });

  it("calls markLevelSeen when 太好了 is tapped", () => {
    render(<LevelUpModal />);
    fireEvent.click(screen.getByText("太好了"));
    expect(hoisted.mark).toHaveBeenCalled();
  });

  it("renders nothing when level_seen has caught up", () => {
    hoisted.me = { data: { id: "u1", level: "L1", level_seen: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when level_seen is missing (no false celebration)", () => {
    hoisted.me = { data: { id: "u1", level: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });
});
