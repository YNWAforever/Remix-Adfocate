import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BadgePill } from "./BadgePill";
import { FilterPills } from "./FilterPills";
import { PointsBalanceCard } from "./PointsBalanceCard";
import { MissionCard } from "./MissionCard";
import { RewardCard } from "./RewardCard";

describe("presentational components", () => {
  it("BadgePill shows its label", () => {
    render(<BadgePill>美容</BadgePill>);
    expect(screen.getByText("美容")).toBeInTheDocument();
  });
  it("FilterPills renders options and marks the active one pressed", () => {
    render(<FilterPills options={["全部", "美容"]} value="美容" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "美容" })).toHaveAttribute("aria-pressed", "true");
  });
  it("PointsBalanceCard shows the balance and label", () => {
    render(<PointsBalanceCard balance={1250} availableTo="2026-09-01T00:00:00Z" />);
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("你的積分餘額")).toBeInTheDocument();
  });
  it("MissionCard shows title, points and category", () => {
    render(<MissionCard title="美容精華試用" category="美容" points={300} deadline="2026-05-31" />);
    expect(screen.getByText("美容精華試用")).toBeInTheDocument();
    expect(screen.getByText(/300/)).toBeInTheDocument();
  });
  it("RewardCard shows name, cost and a sold-out badge when out of stock", () => {
    render(<RewardCard name="HK$50 現金券" pointsCost={500} stockRemaining={0} />);
    expect(screen.getByText("HK$50 現金券")).toBeInTheDocument();
    expect(screen.getByText("已換罄")).toBeInTheDocument();
  });
});
