import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreatorPendingReward } from "@/lib/activeMission";
import { setActivationAnalyticsSink } from "@/lib/activationAnalytics";
import { I18nProvider } from "@/lib/i18n";
import { RewardPendingCard } from "./RewardPendingCard";

function pendingReward(overrides: Partial<CreatorPendingReward> = {}): CreatorPendingReward {
  return {
    id: null,
    status: "pending",
    reward: { pointsAmount: 12_500, cashAmount: 1_234.5, currency: "HKD", xpAmount: 300 },
    processingWindowDays: 7,
    targetAt: "2026-08-07T10:00:00.000Z",
    createdAt: "2026-07-31T10:00:00.000Z",
    cancelledAt: null,
    decisionState: { kind: "approved", decidedAt: "2026-07-31T10:00:00.000Z" },
    ...overrides,
  };
}

function renderCard(reward: CreatorPendingReward, locale: "en" | "zh" = "en", strict = false) {
  window.localStorage.setItem("lang", locale);
  const card = (
    <I18nProvider>
      <RewardPendingCard
        missionTitle="Launch mission"
        pendingReward={reward}
        supportHref="/contact?topic=reward-pending&submission=sub-1"
      />
    </I18nProvider>
  );
  return render(strict ? <StrictMode>{card}</StrictMode> : card);
}

describe("RewardPendingCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivationAnalyticsSink(null);
  });
  afterEach(() => setActivationAnalyticsSink(null));

  it("shows a frozen locale-aware reward snapshot without claiming funds exist", async () => {
    renderCard(pendingReward());
    const heading = screen.getByRole("heading", { name: "Mission complete — reward under finance review" });
    expect(heading).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("12,500")).toBeVisible();
    expect(screen.getByText("HK$1,234.50")).toBeVisible();
    expect(screen.getByText("300")).toBeVisible();
    expect(screen.getByText("Usual review window: 7 days")).toBeVisible();
    expect(screen.getByText(/Aug 7, 2026/)).toBeVisible();
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-08-07T10:00:00.000Z");
    expect(document.body).not.toHaveTextContent(/paid|available|credited|issued/i);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("omits every zero reward component and uses honest no-date copy", () => {
    renderCard(pendingReward({
      reward: { pointsAmount: 0, cashAmount: 0, currency: "HKD", xpAmount: 0 },
      processingWindowDays: null,
      targetAt: "not-a-date",
      createdAt: "2026-07-31T11:00:00.000Z",
      decisionState: { kind: "approved", decidedAt: "2026-07-31T11:00:00.000Z" },
    }));
    expect(screen.queryByText("Points")).not.toBeInTheDocument();
    expect(screen.queryByText("Cash")).not.toBeInTheDocument();
    expect(screen.queryByText("XP")).not.toBeInTheDocument();
    expect(document.querySelector("time")).not.toBeInTheDocument();
    expect(screen.getByText("Finance is reviewing your reward. A processing date has not been set yet.")).toBeVisible();
  });

  it("keeps reassessment proof-verified and reward-neutral in Traditional Chinese", async () => {
    renderCard(pendingReward({
      status: "cancelled",
      targetAt: null,
      cancelledAt: "2026-08-01T08:00:00.000Z",
      createdAt: "2026-07-31T12:00:00.000Z",
      decisionState: { kind: "cancelled", decidedAt: "2026-08-01T08:00:00.000Z" },
    }), "zh");
    expect(await screen.findByRole("heading", { name: "發佈證明已核實 — 獎賞重新評估中" })).toBeVisible();
    expect(screen.getByText("你的發佈證明仍然有效。財務團隊正在重新評估獎賞資料。")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/reversed|撤回|扣回/i);
  });

  it("deduplicates viewed analytics by stable projection identity and tracks support only on activation", async () => {
    const events: Array<{ name: string; properties: object }> = [];
    setActivationAnalyticsSink((event) => events.push(event));
    const reward = pendingReward({
      createdAt: "2026-07-31T13:00:00.000Z",
      decisionState: { kind: "approved", decidedAt: "2026-07-31T13:00:00.000Z" },
    });
    const rendered = renderCard(reward, "en", true);
    await waitFor(() => expect(events.map(({ name }) => name)).toEqual(["mission_reward_pending_viewed"]));
    rendered.rerender(
      <StrictMode>
        <I18nProvider>
          <RewardPendingCard missionTitle="Launch mission" pendingReward={{ ...reward }} supportHref="/contact?topic=reward-pending&submission=sub-1" />
        </I18nProvider>
      </StrictMode>,
    );
    expect(events).toHaveLength(1);
    const support = screen.getByRole("link", { name: "Contact support about this reward" });
    expect(support).toHaveAttribute("href", "/contact?topic=reward-pending&submission=sub-1");
    expect(support).not.toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(support, { key: "Tab" });
    expect(events).toHaveLength(1);
    support.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(support);
    expect(events.map(({ name }) => name)).toEqual([
      "mission_reward_pending_viewed",
      "mission_reward_support_selected",
    ]);
    expect(events[0]?.properties).toEqual({
      locale: "en",
      deviceCategory: "desktop",
      workflowState: "reward_pending",
      hasPoints: true,
      hasCash: true,
      hasXp: true,
    });
    expect(JSON.stringify(events)).not.toContain("sub-1");
  });

  it("uses a narrow, wrapping layout contract suitable for 320px viewports", () => {
    renderCard(pendingReward({
      createdAt: "2026-07-31T14:00:00.000Z",
      decisionState: { kind: "approved", decidedAt: "2026-07-31T14:00:00.000Z" },
    }));
    const region = screen.getByRole("region", { name: "Launch mission reward review" });
    expect(region).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(screen.getByRole("link", { name: "Contact support about this reward" })).toHaveClass("break-words");
  });
});
