import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { LevelChip } from "./LevelChip";

describe("LevelChip", () => {
  it("shows the current level label and links to /passport", () => {
    render(<LevelChip xp={600} />); // L1 KOC 新手
    const link = screen.getByText(/KOC 新手/).closest("a");
    expect(link).toHaveAttribute("href", "/passport");
    expect(screen.getByText(/看護照/)).toBeInTheDocument();
  });

  it("shows the capped effective level when effectiveLevelId is lower than XP-derived level", () => {
    // xp=3000 → raw L2 (信譽 KOC), but effective_level=L1 (unverified) → should show L1
    render(<LevelChip xp={3000} effectiveLevelId="L1" />);
    expect(screen.getByText(/KOC 新手/)).toBeInTheDocument();
    expect(screen.queryByText(/信譽 KOC/)).not.toBeInTheDocument();
  });

  it("shows XP-derived level when effectiveLevelId matches or exceeds it", () => {
    // xp=3000 → L2, effective_level=L2 → no cap, shows L2
    render(<LevelChip xp={3000} effectiveLevelId="L2" />);
    expect(screen.getByText(/信譽 KOC/)).toBeInTheDocument();
  });
});
