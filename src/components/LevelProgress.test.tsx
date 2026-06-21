import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelProgress } from "./LevelProgress";

describe("LevelProgress", () => {
  it("shows current level, XP and the next-level hint", () => {
    render(<LevelProgress xp={600} />); // L1 KOC 新手 (>=500), next L2 信譽 KOC (2000)
    expect(screen.getByText("KOC 新手")).toBeInTheDocument();
    expect(screen.getByText(/600 XP/)).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 信譽 KOC")).toBeInTheDocument();
    expect(screen.getByText("解鎖：UGC 有薪工作、CPM 軌道、工作室")).toBeInTheDocument();
  });

  it("shows the max-level state at L6", () => {
    render(<LevelProgress xp={100000} />); // L6 Elite, no next
    expect(screen.getByText("最高等級")).toBeInTheDocument();
  });

  it("shows capped L1 label and readyVerify hint when effective_level=L1 but xp>=L2", () => {
    // xp=3000 → raw L2, but effectiveLevelId=L1 (unverified creator)
    render(<LevelProgress xp={3000} effectiveLevelId="L1" />);
    // Header shows capped level (L1)
    expect(screen.getByText("KOC 新手")).toBeInTheDocument();
    // readyVerify hint present and names the raw level to unlock (L2)
    expect(screen.getByText(/已達標/)).toBeInTheDocument();
    expect(screen.getByText(/信譽 KOC/)).toBeInTheDocument(); // named in the hint
    // Normal progress bar is NOT shown (no "還需 … XP" text)
    expect(screen.queryByText(/還需/)).not.toBeInTheDocument();
  });

  it("shows normal progress bar when not capped", () => {
    render(<LevelProgress xp={600} effectiveLevelId="L1" />); // raw=L1, effective=L1, no cap
    expect(screen.getByText("還需 1400 XP 升至 信譽 KOC")).toBeInTheDocument();
  });
});
