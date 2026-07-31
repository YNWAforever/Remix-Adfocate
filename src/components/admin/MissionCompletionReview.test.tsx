import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionEligibility, RewardContract, WorkflowState } from "@/lib/activeMission";
import type { AdminPendingReward } from "@/lib/adminRewardHandoff";
import { MissionCompletionReview } from "./MissionCompletionReview";

const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  return {
    useI18n: () => ({
      lang: i18n.lang,
      localeReady: true,
      setLang: vi.fn(),
      t: (key: string, params?: Record<string, string | number>) =>
        (dict[i18n.lang][key] ?? key).replace(
          /\{(\w+)\}/g,
          (_, name: string) => String(params?.[name] ?? `{${name}}`),
        ),
    }),
  };
});

const contract: RewardContract = {
  id: "contract-1",
  pointsAmount: 500,
  cashAmount: 125,
  currency: "HKD",
  xpAmount: 0,
  source: "join",
  createdAt: "2026-07-30T10:00:00.000Z",
};

const eligible: CompletionEligibility = {
  eligible: true,
  blockers: [],
  requiredItemCount: 3,
  verifiedRequiredItemCount: 3,
};

const pendingReward: AdminPendingReward = {
  id: "pending-1",
  workflowId: "workflow-1",
  submissionId: "submission-1",
  creatorId: "creator-1",
  missionId: "mission-1",
  rewardContractId: "contract-1",
  completionDecisionId: "decision-1",
  cancellationDecisionId: null,
  reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
  status: "pending",
  processingWindowDays: 7,
  targetAt: "2026-08-06T10:00:00.000Z",
  createdAt: "2026-07-30T10:00:00.000Z",
  cancelledAt: null,
  decision: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderReview(overrides: Partial<{
  workflowState: WorkflowState;
  workflowRevision: number;
  rewardContract: RewardContract | null;
  eligibility: CompletionEligibility;
  pendingReward: AdminPendingReward | null;
  busy: boolean;
  onBackfill: ReturnType<typeof vi.fn>;
  onApprove: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onActionError: ReturnType<typeof vi.fn>;
}> = {}) {
  const callbacks = {
    onBackfill: vi.fn(async () => ({})),
    onApprove: vi.fn(async () => ({})),
    onCancel: vi.fn(async () => ({})),
    onActionError: vi.fn(),
    ...overrides,
  };
  const view = render(
    <MissionCompletionReview
      workflowId="workflow-1"
      workflowState={overrides.workflowState ?? "proof_verified"}
      workflowRevision={overrides.workflowRevision ?? 8}
      rewardContract={overrides.rewardContract === undefined ? contract : overrides.rewardContract}
      eligibility={overrides.eligibility ?? eligible}
      pendingReward={overrides.pendingReward === undefined ? null : overrides.pendingReward}
      busy={overrides.busy ?? false}
      onBackfill={callbacks.onBackfill}
      onApprove={callbacks.onApprove}
      onCancel={callbacks.onCancel}
      onActionError={callbacks.onActionError}
    />,
  );
  return { ...view, callbacks };
}

describe("MissionCompletionReview", () => {
  beforeEach(() => {
    i18n.lang = "en";
  });

  it("is hidden outside proof_verified and reward_pending", () => {
    const { container, rerender } = render(
      <MissionCompletionReview
        workflowId="workflow-1"
        workflowState="publication_in_progress"
        workflowRevision={8}
        rewardContract={contract}
        eligibility={eligible}
        pendingReward={null}
        busy={false}
        onBackfill={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onActionError={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <MissionCompletionReview
        workflowId="workflow-1"
        workflowState="cancelled"
        workflowRevision={8}
        rewardContract={contract}
        eligibility={eligible}
        pendingReward={null}
        busy={false}
        onBackfill={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onActionError={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows exact proof counts, canonical blockers, and the reward-neutral warning", () => {
    renderReview({
      eligibility: {
        eligible: false,
        blockers: ["required_proof_incomplete", "pending_reward_exists"],
        requiredItemCount: 3,
        verifiedRequiredItemCount: 2,
      },
    });
    expect(screen.getByRole("heading", { name: "Mission completion review" })).toBeVisible();
    expect(screen.getByText("2 of 3 required proofs verified")).toBeVisible();
    expect(screen.getByText("Required proof is incomplete")).toBeVisible();
    expect(screen.getByText("A pending reward handoff already exists")).toBeVisible();
    expect(screen.getByText(
      "Approval records completion and opens a pending reward handoff. It does not issue, pay, or credit a reward.",
    )).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve completion" })).toBeDisabled();
  });

  it("renders the frozen reward without visually emphasizing zero XP", () => {
    const { rerender } = renderReview();
    expect(screen.getByText("500 points")).toBeVisible();
    expect(screen.getByText("HKD 125")).toBeVisible();
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();

    rerender(
      <MissionCompletionReview
        workflowId="workflow-1"
        workflowState="proof_verified"
        workflowRevision={8}
        rewardContract={{ ...contract, xpAmount: 25 }}
        eligibility={eligible}
        pendingReward={null}
        busy={false}
        onBackfill={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onActionError={vi.fn()}
      />,
    );
    expect(screen.getByText("25 XP")).toBeVisible();
  });

  it("validates audited backfill provenance and always submits zero XP", async () => {
    const onBackfill = vi.fn(async () => ({}));
    renderReview({ rewardContract: null, onBackfill });
    fireEvent.click(screen.getByRole("button", { name: "Save frozen reward contract" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter valid reward amounts, currency, evidence, and a confirmation reason.",
    );
    expect(onBackfill).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "hkd" } });
    fireEvent.change(screen.getByLabelText("Confirmation evidence"), {
      target: { value: "operator_record" },
    });
    fireEvent.change(screen.getByLabelText("Confirmation reason"), {
      target: { value: "Confirmed against the signed operator record." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save frozen reward contract" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(onBackfill).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Cash amount"), { target: { value: "125.5" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "hkd" } });
    fireEvent.change(screen.getByLabelText("Source mission updated at"), {
      target: { value: "2026-07-30T18:00" },
    });
    fireEvent.change(screen.getByLabelText("Confirmation evidence"), {
      target: { value: "operator_record" },
    });
    fireEvent.change(screen.getByLabelText("Confirmation reason"), {
      target: { value: "  Confirmed against the signed operator record.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save frozen reward contract" }));

    await waitFor(() => expect(onBackfill).toHaveBeenCalledWith({
      pointsAmount: 500,
      cashAmount: 125.5,
      currency: "HKD",
      xpAmount: 0,
      sourceMissionUpdatedAt: new Date("2026-07-30T18:00").toISOString(),
      confirmationEvidenceSource: "operator_record",
      confirmationReason: "Confirmed against the signed operator record.",
    }));
    expect(screen.getByText("XP is fixed at 0 for audited backfills.")).toBeVisible();
  });

  it("keeps approval open and busy, then announces success and restores trigger focus", async () => {
    const request = deferred<unknown>();
    const onApprove = vi.fn(() => request.promise);
    renderReview({ onApprove });
    const trigger = screen.getByRole("button", { name: "Approve completion" });
    fireEvent.click(trigger);
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep reviewing" })).toBeDisabled();
    expect(onApprove).toHaveBeenCalledWith({
      expectedState: "proof_verified",
      expectedRevision: 8,
    });

    await act(async () => {
      request.resolve({});
      await request.promise;
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Mission completion approved.");
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the review region when refresh removes the action trigger", async () => {
    const request = deferred<unknown>();
    const onApprove = vi.fn(() => request.promise);
    const view = renderReview({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Approve completion" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    view.rerender(
      <MissionCompletionReview
        workflowId="workflow-1"
        workflowState="reward_pending"
        workflowRevision={9}
        rewardContract={contract}
        eligibility={eligible}
        pendingReward={pendingReward}
        busy={false}
        onBackfill={vi.fn()}
        onApprove={onApprove}
        onCancel={vi.fn()}
        onActionError={vi.fn()}
      />,
    );
    await act(async () => { request.resolve({}); await request.promise; });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Mission completion review" })).toHaveFocus();
  });

  it("preserves an approval dialog after an ambiguous failure and allows retry", async () => {
    const onApprove = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({});
    const onActionError = vi.fn();
    renderReview({ onApprove, onActionError });
    fireEvent.click(screen.getByRole("button", { name: "Approve completion" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("response lost");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
    expect(onActionError).toHaveBeenCalledWith(expect.any(Error));

    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("requires a bounded cancellation category and note, preserving them on failure", async () => {
    const onCancel = vi.fn()
      .mockRejectedValueOnce(new Error("network uncertain"))
      .mockResolvedValueOnce({});
    renderReview({
      workflowState: "reward_pending",
      pendingReward,
      onCancel,
    });
    const trigger = screen.getByRole("button", { name: "Cancel reward handoff" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a cancellation category and add a note.",
    );
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Cancellation category"), {
      target: { value: "contract_error" },
    });
    fireEvent.change(screen.getByLabelText("Cancellation note"), {
      target: { value: "  Contract value needs correction.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network uncertain");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByLabelText("Cancellation category")).toHaveValue("contract_error");
    expect(screen.getByLabelText("Cancellation note")).toHaveValue(
      "  Contract value needs correction.  ",
    );
    expect(onCancel).toHaveBeenCalledWith({
      expectedState: "reward_pending",
      expectedRevision: 8,
      reasonCategory: "contract_error",
      reasonNote: "Contract value needs correction.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Pending reward handoff cancelled.");
    expect(trigger).toHaveFocus();
  });

  it("uses Traditional Chinese copy and supports Escape focus restoration", async () => {
    i18n.lang = "zh";
    renderReview();
    expect(screen.getByRole("heading", { name: "任務完成審核" })).toBeVisible();
    const trigger = screen.getByRole("button", { name: "批准任務完成" });
    fireEvent.click(trigger);
    expect(screen.getByRole("alertdialog")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("button", { name: "確認批准" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
