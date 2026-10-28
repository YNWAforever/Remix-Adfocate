import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MissionCard } from "./MissionCard";
import { MissionFacts } from "./MissionFacts";
import { MissionCommitmentSummary } from "./MissionCommitmentSummary";
import { I18nProvider } from "@/lib/i18n";
import type { Mission } from "@/lib/queries/kocmax";

describe("D09 mission decision facts", () => {
  beforeEach(() => localStorage.setItem("lang", "en"));
  it("distinguishes a known zero cash reward from missing cash", () => {
    const { rerender } = render(<I18nProvider><MissionCard title="Zero" points={50} cashReward={0} /></I18nProvider>);
    expect(screen.getByText("HK$0.00")).toBeInTheDocument();
    rerender(<I18nProvider><MissionCard title="Unknown" points={50} cashReward={null} /></I18nProvider>);
    const row = screen.getByText("Cash reward").parentElement!;
    expect(within(row).getByText("Not provided")).toBeInTheDocument();
    expect(screen.queryByText("HK$0.00")).not.toBeInTheDocument();
  });
  it("exposes absent platform, deliverables, effort, level, quota and deadline as unknown", () => {
    render(<I18nProvider><MissionCard title="Unknown facts" points={50} requiredLevel={null} creatorLevel="L3" /></I18nProvider>);
    for (const label of ["Platform", "Deliverables", "Effort", "Required level", "Availability", "Deadline"]) {
      expect(within(screen.getByText(label).parentElement!).getByText("Not provided")).toBeInTheDocument();
    }
    expect(screen.getByText("Eligibility not yet known")).toBeInTheDocument();
    expect(screen.queryByText("All levels can join")).not.toBeInTheDocument();
  });
  it.each([
    ["L2", "L1", false, "Needs L2 · you're L1"],
    ["L2", "L3", false, "Verify a social handle to unlock L2 missions"],
    ["L2", "L3", true, "Needs L2 · you qualify"],
    ["L0", "L0", false, "All levels can join"],
    ["future-level", "L3", true, "Eligibility not yet known"],
  ] as const)("shares list/detail qualification for %s with creator=%s trusted=%s", (required, creator, trusted, label) => {
    const mission: Mission = { id:"m",slug:"m",title:"Decision",mission_type:"ugc",points_reward:50,quota:10,filled:1,status:"active",required_level:required };
    render(<I18nProvider><div data-testid="list"><MissionCard title={mission.title} points={50} requiredLevel={required} creatorLevel={creator} isTrusted={trusted} /></div>
      <div data-testid="detail"><MissionFacts mission={mission} creatorLevel={creator} isTrusted={trusted} /></div></I18nProvider>);
    expect(within(screen.getByTestId("list")).getByText(label)).toBeInTheDocument();
    expect(within(screen.getByTestId("detail")).getByText(label)).toBeInTheDocument();
  });
  it("does not assume a creator's missing verification status is trusted", () => {
    render(<I18nProvider><MissionCard title="Verification not loaded" points={50} requiredLevel="L2" creatorLevel="L3" /></I18nProvider>);
    expect(screen.getByText("Eligibility not yet known")).toBeInTheDocument();
  });
  it("keeps detail and pre-join commitment honest about missing cash and deadline", () => {
    const mission: Mission = { id:"m",slug:"m",title:"Unknown",mission_type:"ugc",points_reward:50,quota:10,filled:1,status:"active" };
    render(<I18nProvider><div data-testid="detail"><MissionFacts mission={mission} creatorLevel="L0" /></div>
      <MissionCommitmentSummary mission={mission} locale="en" /></I18nProvider>);
    expect(within(screen.getByTestId("detail")).getByText(/Cash reward: Not provided/)).toBeInTheDocument();
    expect(within(screen.getByTestId("detail")).queryByText("All levels can join")).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading",{name:"Before you commit"}).closest("section")!).getByText(/Cash reward: Not provided/)).toBeInTheDocument();
  });
});
