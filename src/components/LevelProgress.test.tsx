import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelProgress } from "./LevelProgress";

describe("LevelProgress", () => {
  it("shows current level, XP and the next-level hint", () => {
    render(<LevelProgress xp={600} />); // L1 Explorer (>=500), next L2 Creator (2000)
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText(/600 XP/)).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 Creator")).toBeInTheDocument();
    expect(screen.getByText("解鎖：UGC 有薪工作、CPM 軌道、工作室")).toBeInTheDocument();
  });

  it("shows the max-level state at L6", () => {
    render(<LevelProgress xp={100000} />); // L6 Elite, no next
    expect(screen.getByText("最高等級")).toBeInTheDocument();
  });
});
