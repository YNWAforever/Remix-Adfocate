import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorPendingReward } from "@/lib/activeMission";
import { setActivationAnalyticsSink } from "@/lib/activationAnalytics";

const localeState = vi.hoisted(() => ({ lang: "en" as "en" | "zh", localeReady: false }));

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  return {
    useI18n: () => ({
      ...localeState,
      setLang: vi.fn(),
      t: (key: string, params?: Record<string, string | number>) =>
        (dict[localeState.lang][key] ?? dict.en[key] ?? key)
          .replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`)),
    }),
  };
});

import { RewardPendingCard } from "./RewardPendingCard";

function reward(overrides: Partial<CreatorPendingReward> = {}): CreatorPendingReward {
  return {
    id: null,
    status: "pending",
    reward: { pointsAmount: 100, cashAmount: 25, currency: "HKD", xpAmount: 5 },
    processingWindowDays: 7,
    targetAt: "2026-08-07T10:00:00+08:00",
    createdAt: "2026-08-01T01:00:00.000Z",
    cancelledAt: null,
    decisionState: { kind: "approved", decidedAt: "2026-08-01T01:00:00.000Z" },
    ...overrides,
  };
}

function card(value: CreatorPendingReward) {
  return (
    <RewardPendingCard
      missionTitle="Launch mission"
      pendingReward={value}
      supportHref="/contact?topic=reward-pending&submission=review-test"
    />
  );
}

describe("RewardPendingCard review hardening", () => {
  beforeEach(() => {
    localeState.lang = "en";
    localeState.localeReady = false;
    setActivationAnalyticsSink(null);
  });
  afterEach(() => act(() => setActivationAnalyticsSink(null)));

  it("has one locale-ready focus and announcement owner across bootstrap and rerenders", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const value = reward({ createdAt: "2026-08-01T02:00:00.000Z" });
    const view = render(card(value));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(focus).not.toHaveBeenCalled();

    localeState.localeReady = true;
    view.rerender(card(value));
    const heading = screen.getByRole("heading", { name: "Mission complete — reward under finance review" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Mission complete");
    expect(focus).toHaveBeenCalledTimes(1);

    localeState.lang = "zh";
    view.rerender(card({ ...value }));
    expect(screen.getByRole("heading", { name: "任務已完成 — 獎賞正由財務審核" })).toBeVisible();
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it("retries view delivery after late sink initialization and deduplicates accepted delivery", async () => {
    localeState.localeReady = true;
    const events: Array<{ name: string }> = [];
    const value = reward({ createdAt: "2026-08-01T03:00:00.000Z" });
    const view = render(card(value));

    act(() => setActivationAnalyticsSink((event) => {
      events.push(event);
      return true;
    }));
    await waitFor(() => expect(events.map(({ name }) => name)).toEqual(["mission_reward_pending_viewed"]));
    view.rerender(card({ ...value }));
    expect(events).toHaveLength(1);
  });

  it("uses the conservative cancellation discriminant for mismatched projection fields", () => {
    localeState.localeReady = true;
    render(card(reward({
      status: "pending",
      decisionState: { kind: "cancelled", decidedAt: "2026-08-01T04:00:00.000Z" },
      createdAt: "2026-08-01T04:00:00.000Z",
    })));
    expect(screen.getByRole("heading", { name: "Proof verified — reward reassessment" })).toBeVisible();
    expect(screen.queryByText("Points")).not.toBeInTheDocument();
  });

  it("rejects invalid timestamps and reward values while preserving strict RFC3339 raw dates", () => {
    localeState.localeReady = true;
    const invalid = [
      "2026-02-30T10:00:00Z",
      "2026-08-07T10:00:00+24:00",
      "12345",
    ];
    for (const [index, targetAt] of invalid.entries()) {
      const view = render(card(reward({
        targetAt,
        reward: { pointsAmount: Number.POSITIVE_INFINITY, cashAmount: -1, currency: "HKD", xpAmount: Number.NaN },
        processingWindowDays: index === 0 ? -1 : index === 1 ? 1.5 : Number.POSITIVE_INFINITY,
        createdAt: `2026-08-01T0${index + 5}:00:00.000Z`,
      })));
      expect(screen.getByText("Finance is reviewing your reward. A processing date has not been set yet.")).toBeVisible();
      expect(view.container.querySelector("time")).not.toBeInTheDocument();
      expect(screen.queryByText("Points")).not.toBeInTheDocument();
      expect(screen.queryByText("Cash")).not.toBeInTheDocument();
      expect(screen.queryByText("XP")).not.toBeInTheDocument();
      expect(screen.queryByText(/Usual review window/)).not.toBeInTheDocument();
      view.unmount();
    }

    const valid = render(card(reward({
      targetAt: "2026-08-07T10:00:00+08:00",
      processingWindowDays: 0,
      createdAt: "2026-08-01T08:00:00.000Z",
    })));
    const time = valid.container.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-08-07T10:00:00+08:00");
    expect(time).toHaveTextContent(/(?:GMT|UTC)/);
    expect(screen.getByText("Usual review window: 0 days")).toBeVisible();
  });

  it("supports a 320px viewport, hover affordance, and keyboard-generated activation", () => {
    localeState.localeReady = true;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const events: Array<{ name: string }> = [];
    setActivationAnalyticsSink((event) => {
      events.push(event);
      return true;
    });
    render(card(reward({ createdAt: "2026-08-01T09:00:00.000Z" })));

    const region = screen.getByRole("region");
    expect(region.scrollWidth).toBeLessThanOrEqual(320);
    const support = screen.getByRole("link", { name: "Contact support about this reward" });
    expect(support.className).toContain("hover:");
    support.addEventListener("click", (event) => event.preventDefault(), { once: true });
    support.focus();
    fireEvent.keyDown(support, { key: "Enter" });
    fireEvent.click(support, { detail: 0 });
    expect(events.map(({ name }) => name)).toContain("mission_reward_support_selected");
  });
});
