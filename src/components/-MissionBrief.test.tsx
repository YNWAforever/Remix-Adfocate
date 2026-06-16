import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionBrief } from "./MissionBrief";
import type { Mission } from "@/lib/queries/kocmax";

const base: Mission = {
  id: "m1", slug: "m1", title: "T", mission_type: "ugc", points_reward: 300,
  quota: 10, filled: 7, status: "active",
};

describe("MissionBrief", () => {
  it("renders every populated section", () => {
    render(<MissionBrief mission={{
      ...base,
      description: "幫品牌試用新精華",
      deliverables: ["1 條 Reel ≥30 秒"],
      requirements: ["標註 @brand"],
      platforms: ["instagram", "tiktok"],
      effort: "medium",
    }} />);
    expect(screen.getByText("關於任務")).toBeInTheDocument();
    expect(screen.getByText("幫品牌試用新精華")).toBeInTheDocument();
    expect(screen.getByText("交付內容")).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel ≥30 秒")).toBeInTheDocument();
    expect(screen.getByText("注意事項")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText("中")).toBeInTheDocument();
  });

  it("shows a placeholder when the brief is entirely empty", () => {
    render(<MissionBrief mission={base} />);
    expect(screen.getByText("詳情陸續更新")).toBeInTheDocument();
    expect(screen.queryByText("交付內容")).not.toBeInTheDocument();
  });
});
