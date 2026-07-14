import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionCommitmentSummary } from "./MissionCommitmentSummary";
import type { Mission } from "@/lib/queries/kocmax";

const baseMission: Mission = {
  id: "mission-1",
  slug: "beauty-reel",
  title: "美容短片任務",
  mission_type: "ugc",
  points_reward: 1_200,
  quota: 10,
  filled: 2,
  status: "active",
};

describe("MissionCommitmentSummary", () => {
  it("summarizes only backed deliverables, platforms, deadline, rewards, and effort", () => {
    render(
      <MissionCommitmentSummary
        locale="zh"
        mission={{
          ...baseMission,
          deliverables: ["1 條 Reel", "3 個限時動態"],
          platforms: ["instagram", "tiktok"],
          deadline: "2026-08-31T00:00:00Z",
          cash_reward: 500,
          effort: "medium",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "參加前確認" })).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel")).toBeInTheDocument();
    expect(screen.getByText("3 個限時動態")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText(/2026.*8.*31/)).toBeInTheDocument();
    expect(screen.getByText(/1,200 積分.*HK\$500\.00/)).toBeInTheDocument();
    expect(screen.getByText("中")).toBeInTheDocument();
    expect(screen.queryByText(/使用權|取消政策|取消條款/)).not.toBeInTheDocument();
  });

  it("shows a specific unavailable-deliverables message and omits absent optional facts", () => {
    render(<MissionCommitmentSummary locale="zh" mission={baseMission} />);

    expect(screen.getByText("詳細交付內容未提供")).toBeInTheDocument();
    expect(screen.queryByText("平台")).not.toBeInTheDocument();
    expect(screen.queryByText("截止日期")).not.toBeInTheDocument();
    expect(screen.queryByText("預計投入")).not.toBeInTheDocument();
    expect(screen.getByText("1,200 積分")).toBeInTheDocument();
  });

  it("omits a deadline that cannot be formatted", () => {
    render(
      <MissionCommitmentSummary
        locale="zh"
        mission={{ ...baseMission, deadline: "not-a-date" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "參加前確認" })).toBeInTheDocument();
    expect(screen.queryByText("截止日期")).not.toBeInTheDocument();
  });
});
