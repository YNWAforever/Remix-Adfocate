import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BadgePill } from "./BadgePill";
import { FilterPills, FilterPillsMulti } from "./FilterPills";
import { PointsBalanceCard } from "./PointsBalanceCard";
import { MissionCard } from "./MissionCard";
import { RewardCard } from "./RewardCard";
import { ProgressBar } from "./ProgressBar";

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
  it("MissionCard renders optional real mission facts with formatted reward and deadline", () => {
    render(
      <MissionCard
        title="高匹配任務"
        category="美容"
        points={500}
        cashReward={1200}
        deadline="2026-08-31T00:00:00Z"
        missionType="內容創作"
        accessType="公開"
        platform="Instagram"
        effort="2 Reels"
        matchRationale="符合你的美容內容經驗"
        matchScore={0.87}
        status="可參加"
      />,
    );
    expect(screen.getByText(/1,200/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText("內容創作")).toBeInTheDocument();
    expect(screen.getByText("公開")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("2 Reels")).toBeInTheDocument();
    expect(screen.getByText("符合你的美容內容經驗")).toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(screen.getByText("可參加")).toBeInTheDocument();
  });
  it("MissionCard omits optional fact labels when their values are absent", () => {
    render(<MissionCard title="基本任務" points={100} />);
    expect(screen.queryByText("現金獎勵")).not.toBeInTheDocument();
    expect(screen.queryByText("平台")).not.toBeInTheDocument();
    expect(screen.queryByText("匹配原因")).not.toBeInTheDocument();
  });
  it("RewardCard shows name, cost and a sold-out badge when out of stock", () => {
    render(<RewardCard name="HK$50 現金券" pointsCost={500} stockRemaining={0} />);
    expect(screen.getByText("HK$50 現金券")).toBeInTheDocument();
    expect(screen.getByText("已換罄")).toBeInTheDocument();
  });
  it("ProgressBar renders with correct aria attributes", () => {
    render(<ProgressBar value={50} max={100} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
  it("ProgressBar clamps at 100% when value exceeds max", () => {
    render(<ProgressBar value={150} max={100} />);
    const fill = document.querySelector('[style*="width"]') as HTMLElement;
    expect(fill?.style.width).toBe("100%");
  });
});

describe("FilterPillsMulti", () => {
  it("toggles a value in and out of the selection", () => {
    const seen: string[][] = [];
    const onChange = (v: string[]) => seen.push(v);
    const { rerender } = render(
      <FilterPillsMulti options={["美容", "餐飲", "寵物"]} value={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("美容"));
    expect(seen.at(-1)).toEqual(["美容"]);

    rerender(<FilterPillsMulti options={["美容", "餐飲", "寵物"]} value={["美容"]} onChange={onChange} />);
    expect(screen.getByText("美容")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("美容"));
    expect(seen.at(-1)).toEqual([]);
  });
});
