import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from "./ScoreRing";

describe("ScoreRing", () => {
  it("renders the label and the numeric value", () => {
    render(<ScoreRing value={50} label="影響力" accent="var(--color-acid)" />);
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("renders a locked '敬請期待' state for null", () => {
    render(<ScoreRing value={null} label="內容" accent="var(--color-ink)" />);
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("敬請期待")).toBeInTheDocument();
  });

  it("renders a real 0 as the value, not as locked", () => {
    render(<ScoreRing value={0} label="影響力" accent="var(--color-acid)" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("敬請期待")).not.toBeInTheDocument();
  });

  it("renders a numeric brand-safety value (no longer always locked in 6C)", () => {
    render(<ScoreRing value={90} label="品牌安全" accent="var(--color-ink)" />);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.queryByText("敬請期待")).not.toBeInTheDocument();
  });
});
