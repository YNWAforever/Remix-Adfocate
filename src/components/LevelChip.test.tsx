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
});
