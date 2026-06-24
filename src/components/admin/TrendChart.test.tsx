// src/components/admin/TrendChart.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart, type TrendPoint } from "./TrendChart";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

const populated: TrendPoint[] = [
  { bucket: "2026-06-01", joined: 2, submitted: 1, approved: 0 },
  { bucket: "2026-06-02", joined: 3, submitted: 2, approved: 1 },
];
const zeros: TrendPoint[] = [
  { bucket: "2026-06-01", joined: 0, submitted: 0, approved: 0 },
  { bucket: "2026-06-02", joined: 0, submitted: 0, approved: 0 },
];

describe("TrendChart", () => {
  it("renders an accessible svg chart when there is data", () => {
    render(<TrendChart data={populated} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img.querySelectorAll("path").length).toBe(3); // joined/submitted/approved series
  });

  it("renders the empty state when all values are zero", () => {
    render(<TrendChart data={zeros} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("未有足夠數據")).toBeInTheDocument(); // app.insights.trendEmpty (zh)
  });

  it("renders the empty state when there is no data at all", () => {
    render(<TrendChart data={[]} />);
    expect(screen.getByText("未有足夠數據")).toBeInTheDocument();
  });
});
