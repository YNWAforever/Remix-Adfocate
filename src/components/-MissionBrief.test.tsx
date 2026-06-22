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

  it("renders the new B2 brief sections only when populated", () => {
    render(<MissionBrief mission={{
      ...base,
      target_audience: "20-30 城市女性",
      dos: ["真實分享"],
      donts: ["避免誇大"],
      key_messages: ["新精華"],
      reference_links: ["https://example.com/post"],
    }} />);
    expect(screen.getByText("20-30 城市女性")).toBeInTheDocument();
    expect(screen.getByText("真實分享")).toBeInTheDocument();
    expect(screen.getByText("避免誇大")).toBeInTheDocument();
    expect(screen.getByText("新精華")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://example.com/post" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hides B2 brief sections when empty", () => {
    render(<MissionBrief mission={{ ...base, description: "d" }} />);
    expect(screen.queryByText("目標受眾")).not.toBeInTheDocument();
    expect(screen.queryByText("重點訊息")).not.toBeInTheDocument();
  });
});
