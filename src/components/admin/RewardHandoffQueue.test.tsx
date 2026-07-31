import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RewardHandoffQueueItem } from "@/lib/adminRewardHandoff";

let language: "en" | "zh" = "en";
let localeReady = true;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params, className }: {
    children: React.ReactNode; params: { workflowId: string }; className?: string;
  }) => <a href={"/admin/active-missions/" + params.workflowId} className={className}>{children}</a>,
}));
vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  return { useI18n: () => ({
    lang: language,
    localeReady,
    t: (key: string, params?: Record<string, string | number>) =>
      (dict[language][key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
        String(params?.[name] ?? "{" + name + "}")),
  }) };
});

import { RewardHandoffQueue } from "./RewardHandoffQueue";

function item(overrides: Partial<RewardHandoffQueueItem> = {}): RewardHandoffQueueItem {
  return {
    id: "pending-1", workflowId: "workflow-1", submissionId: "submission-1",
    creatorId: "creator-private", missionId: "mission-1", rewardContractId: "contract-1",
    completionDecisionId: "decision-1", cancellationDecisionId: null,
    reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
    status: "pending", processingWindowDays: 7,
    targetAt: "2026-08-02T10:00:00.000Z", createdAt: "2026-07-26T10:00:00.000Z",
    cancelledAt: null, decision: null, creatorDisplayName: "Amy Wong",
    missionTitle: "Summer launch",
    completionDecision: {
      id: "decision-1", kind: "approved", decidedAt: "2026-07-26T10:00:00.000Z",
      requiredItemCount: 2, verifiedRequiredItemCount: 2, evidenceAvailable: true,
    },
    ...overrides,
  };
}

const baseProps = {
  filters: { status: "pending" as const },
  processingWindowDays: 7,
  onFiltersChange: vi.fn(),
  onSaveProcessingWindow: vi.fn(),
};

describe("RewardHandoffQueue", () => {
  beforeEach(() => {
    language = "en";
    localeReady = true;
    vi.clearAllMocks();
  });

  it("preserves canonical order and shows read-only finance facts without notes", () => {
    const items = [
      item({ id: "early", workflowId: "workflow-early", creatorDisplayName: "Earliest creator" }),
      item({
        id: "later", workflowId: "workflow-later",
        creatorDisplayName: "Later creator with an exceptionally long display name that must wrap",
        missionTitle: "A very long mission title that remains inside the card at narrow widths",
        targetAt: "2026-08-05T10:00:00.000Z",
        decision: {
          id: "cancel-private-note", kind: "cancelled", workflowRevision: 4,
          requiredItemCount: 2, verifiedRequiredItemCount: 2,
          evidence: { requiredItems: [] }, reasonCategory: "other",
          reasonNote: "operator-authored secret note", decidedBy: "staff-private",
          decidedAt: "2026-07-28T10:00:00.000Z",
        },
      }),
    ];
    render(<RewardHandoffQueue {...baseProps} items={items} />);
    const cards = screen.getAllByTestId("reward-handoff-row");
    expect(cards[0]).toHaveTextContent("Earliest creator");
    expect(cards[1]).toHaveTextContent("Later creator");
    expect(within(cards[0]).getByRole("link")).toHaveAttribute(
      "href", "/admin/active-missions/workflow-early",
    );
    expect(cards[0]).toHaveTextContent("500 points");
    expect(cards[0]).toHaveTextContent("HK$125");
    expect(cards[0]).toHaveTextContent("Evidence available");
    expect(screen.queryByText("operator-authored secret note")).not.toBeInTheDocument();
    for (const forbidden of [/issue/i, /mark paid/i, /^pay$/i, /^release$/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
    expect(cards[1]).toHaveClass("min-w-0", "overflow-hidden");
  });

  it("groups missing targets under localized copy and exposes cancelled audit rows", () => {
    const cancelled = item({
      id: "cancelled-1", status: "cancelled", targetAt: null,
      cancelledAt: "2026-07-29T10:00:00.000Z", creatorDisplayName: "Cancelled creator",
    });
    const { rerender } = render(
      <RewardHandoffQueue {...baseProps} items={[cancelled]} filters={{ status: "cancelled" }} />,
    );
    expect(screen.getByRole("heading", { name: "No target date" })).toBeVisible();
    expect(screen.getAllByText("Cancelled creator")[0]).toBeVisible();
    expect(screen.getAllByText("Cancelled")[0]).toBeVisible();
    language = "zh";
    rerender(
      <RewardHandoffQueue {...baseProps} items={[cancelled]} filters={{ status: "cancelled" }} />,
    );
    expect(screen.getByRole("heading", { name: "沒有目標日期" })).toBeVisible();
    expect(screen.getAllByText("已取消")[0]).toBeVisible();
  });

  it("waits for explicit filter application through native controls", () => {
    const onFiltersChange = vi.fn();
    render(<RewardHandoffQueue {...baseProps} items={[]} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "no_target" } });
    fireEvent.change(screen.getByLabelText("Reward component"), { target: { value: "cash" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "cancelled" } });
    expect(onFiltersChange).not.toHaveBeenCalled();
    const apply = screen.getByRole("button", { name: "Apply filters" });
    expect(apply).toHaveAttribute("type", "button");
    fireEvent.click(apply);
    expect(onFiltersChange).toHaveBeenCalledWith({
      due: "no_target", component: "cash", status: "cancelled",
    });
  });

  it.each(["NaN", "Infinity", "-1", "1.5", "366"])(
    "rejects invalid SLA input %s",
    async (value) => {
      const onSave = vi.fn();
      render(<RewardHandoffQueue {...baseProps} items={[]} onSaveProcessingWindow={onSave} />);
      fireEvent.change(screen.getByLabelText("Processing window"), { target: { value } });
      expect(onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save processing window" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Enter a whole number from 0 to 365, or leave blank.",
      );
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("saves zero or null only on explicit submit and announces success", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <RewardHandoffQueue {...baseProps} items={[]} onSaveProcessingWindow={onSave} />,
    );
    const input = screen.getByLabelText("Processing window");
    expect(screen.getByText("calendar days")).toBeVisible();
    fireEvent.change(input, { target: { value: "0" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save processing window" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(0));
    expect(screen.getByRole("status")).toHaveTextContent("Saved 0 calendar days.");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save processing window" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole("status")).toHaveTextContent("Saved without a target date.");
    language = "zh";
    rerender(<RewardHandoffQueue {...baseProps} items={[]} processingWindowDays={null} />);
    expect(screen.getByText("日曆日")).toBeVisible();
  });

  it("bounds retryable save errors, preserves input, and retries", async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error("private database detail creator@example.com"))
      .mockResolvedValueOnce(undefined);
    render(<RewardHandoffQueue {...baseProps} items={[]} onSaveProcessingWindow={onSave} />);
    fireEvent.change(screen.getByLabelText("Processing window"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save processing window" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save the processing window.",
    );
    expect(screen.queryByText(/creator@example/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Processing window")).toHaveValue("12");
    fireEvent.click(screen.getByRole("button", { name: "Save processing window" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[0][0]).toBe(12);
    expect(onSave.mock.calls[1][0]).toBe(12);
  });

  it("keeps live status empty before locale hydration and has a 320px-safe shell", () => {
    localeReady = false;
    render(<RewardHandoffQueue {...baseProps} items={[]} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("reward-handoff-responsive-shell"))
      .toHaveClass("min-w-0", "max-w-full");
  });
});
