import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionFacts } from "./MissionFacts";
import type { Mission } from "@/lib/queries/kocmax";

const base: Mission = {
  id: "m1", slug: "m1", title: "T", mission_type: "ugc", points_reward: 300,
  quota: 10, filled: 7, status: "active",
};

describe("MissionFacts", () => {
  it("shows reward, spots left, no-deadline fallback, and eligibility", () => {
    render(<MissionFacts mission={base} creatorLevel="L0" />);
    expect(screen.getByText(/300 積分/)).toBeInTheDocument();
    expect(screen.getByText("尚餘 3 個")).toBeInTheDocument();
    expect(screen.getByText("無截止日期")).toBeInTheDocument();
    expect(screen.getByText("所有等級可參加")).toBeInTheDocument();
  });

  it("appends cash when present and shows 額滿 when full", () => {
    render(<MissionFacts mission={{ ...base, cash_reward: 500, filled: 10 }} creatorLevel="L0" />);
    expect(screen.getByText(/HK\$500/)).toBeInTheDocument();
    expect(screen.getByText("額滿")).toBeInTheDocument();
  });

  it("shows a locked eligibility label when under-levelled", () => {
    render(<MissionFacts mission={{ ...base, required_level: "L2" }} creatorLevel="L1" />);
    expect(screen.getByText("需 L2 · 你係 L1")).toBeInTheDocument();
  });
});
