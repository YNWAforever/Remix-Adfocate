import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionEligibility, RewardContract, WorkflowState } from "@/lib/activeMission";
import type { AdminPendingReward, AdminRewardContract } from "@/lib/adminRewardHandoff";
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
  rewardContract: (RewardContract & Partial<AdminRewardContract>) | null;
  eligibility: CompletionEligibility;
  pendingReward: AdminPendingReward | null;
  acceptedProofAnchors: Array<{ workItemId: string; proofAttemptId: string }>;
  processingWindowDays: number | null;
  processingTargetAt: string | null;
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
      acceptedProofAnchors={overrides.acceptedProofAnchors ?? []}
      processingWindowDays={overrides.processingWindowDays ?? null}
      processingTargetAt={overrides.processingTargetAt ?? null}
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
  function fillValidBackfill() {
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Cash amount"), { target: { value: "125.5" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "hkd" } });
    fireEvent.change(screen.getByLabelText("Confirmation evidence"), {
      target: { value: "operator_record" },
    });
    fireEvent.change(screen.getByLabelText("Confirmation reason"), {
      target: { value: "Confirmed against the signed operator record." },
    });
  }


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
    expect(screen.getByText(/HK\$\s?125\.00/)).toBeVisible();
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();

    rerender(
      <MissionCompletionReview
        workflowId="workflow-1"
        workflowState="proof_verified"
        workflowRevision={8}
        rewardContract={{ ...contract, xpAmount: 2_500 }}
        eligibility={eligible}
        pendingReward={null}
        busy={false}
        onBackfill={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onActionError={vi.fn()}
      />,
    );
    expect(screen.getByText("2,500 XP")).toBeVisible();
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
  it("shows backfill rejection inline, preserves every field, and retries", async () => {
    const onBackfill = vi.fn()
      .mockRejectedValueOnce(new Error("Reward contract lookup timed out"))
      .mockResolvedValueOnce({});
    renderReview({ rewardContract: null, onBackfill });
    fillValidBackfill();
    fireEvent.change(screen.getByLabelText("Source mission updated at"), {
      target: { value: "2026-07-30T18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save frozen reward contract" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reward contract lookup timed out");
    expect(screen.getByLabelText("Points")).toHaveValue(500);
    expect(screen.getByLabelText("Cash amount")).toHaveValue(125.5);
    expect(screen.getByLabelText("Currency")).toHaveValue("hkd");
    expect(screen.getByLabelText("Source mission updated at"))
      .toHaveValue("2026-07-30T18:00");
    expect(screen.getByLabelText("Confirmation evidence")).toHaveValue("operator_record");
    expect(screen.getByLabelText("Confirmation reason"))
      .toHaveValue("Confirmed against the signed operator record.");
    expect(screen.getByLabelText("Points")).toHaveAttribute("name", "pointsAmount");
    expect(screen.getByLabelText("Confirmation reason"))
      .toHaveAttribute("name", "confirmationReason");
    fireEvent.click(screen.getByRole("button", { name: "Save frozen reward contract" }));
    await waitFor(() => expect(onBackfill).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Reward contract lookup timed out"))
      .not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Reward contract backfilled.");
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

  it("contains approval focus and blocks Tab and Escape while busy", async () => {
    const request = deferred<unknown>();
    renderReview({ onApprove: vi.fn(() => request.promise) });
    fireEvent.click(screen.getByRole("button", { name: "Approve completion" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-busy", "true");
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await act(async () => { request.resolve({}); await request.promise; });
  });

  it("shows exact proof anchors, SLA target, provenance, and cancellation handoff ID", () => {
    renderReview({
      workflowState: "reward_pending",
      rewardContract: {
        ...contract,
        source: "operator_backfill",
        confirmationEvidenceSource: "operator_record",
        sourceMissionUpdatedAt: "2026-07-29T10:00:00.000Z",
      },
      pendingReward,
      acceptedProofAnchors: [{ workItemId: "work-item-1", proofAttemptId: "proof-attempt-1" }],
      processingWindowDays: 7,
      processingTargetAt: "2026-08-06T10:00:00.000Z",
    });
    expect(screen.getByText("work-item-1 / proof-attempt-1")).toBeVisible();
    expect(screen.getByText("operator_backfill")).toBeVisible();
    expect(screen.getByText("operator_record")).toBeVisible();
    expect(screen.getByText("2026-08-06T10:00:00.000Z")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reward handoff" }));
    expect(screen.getByText(/Reward handoff ID: pending-1/)).toBeVisible();
  });
  it("contains cancellation focus and blocks Tab and Escape while busy", async () => {
    const request = deferred<unknown>();
    renderReview({
      workflowState: "reward_pending",
      pendingReward,
      onCancel: vi.fn(() => request.promise),
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel reward handoff" }));
    fireEvent.change(screen.getByLabelText("Cancellation category"), {
      target: { value: "contract_error" },
    });
    fireEvent.change(screen.getByLabelText("Cancellation note"), {
      target: { value: "Contract mismatch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await act(async () => { request.resolve({}); await request.promise; });
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
    const dialog = screen.getByRole("alertdialog");
    const keepReviewing = screen.getByRole("button", { name: "Keep reviewing" });
    const confirm = screen.getByRole("button", { name: "Confirm approval" });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveFocus();
    expect(confirm).toBeEnabled();
    expect(onActionError).toHaveBeenCalledWith(expect.any(Error));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(keepReviewing).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.click(confirm);
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
  it("reconciles an open approval when refresh advances to reward pending", () => {
    const onApprove = vi.fn(async () => ({}));
    const view = renderReview({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Approve completion" }));
    view.rerender(
      <MissionCompletionReview workflowId="workflow-1" workflowState="reward_pending"
        workflowRevision={9} rewardContract={contract} eligibility={eligible}
        pendingReward={pendingReward} busy={false} onBackfill={vi.fn()}
        onApprove={onApprove} onCancel={vi.fn()} onActionError={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Workflow changed. Review the current state before acting again.",
    );
    const keepReviewing = screen.getByRole("button", { name: "Keep reviewing" });
    const confirm = screen.getByRole("button", { name: "Confirm approval" });
    const outsideAction = screen.getByRole("button", { name: "Cancel reward handoff" });
    expect(confirm).toBeDisabled();
    expect(keepReviewing).toBeEnabled();
    outsideAction.focus();
    fireEvent.keyDown(outsideAction, { key: "Tab" });
    expect(keepReviewing).toHaveFocus();
    outsideAction.focus();
    fireEvent.keyDown(outsideAction, { key: "Tab", shiftKey: true });
    expect(keepReviewing).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("preserves cancellation input but disables stale action after refresh", () => {
    const onCancel = vi.fn(async () => ({}));
    const view = renderReview({
      workflowState: "reward_pending",
      pendingReward,
      onCancel,
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel reward handoff" }));
    fireEvent.change(screen.getByLabelText("Cancellation category"), {
      target: { value: "contract_error" },
    });
    fireEvent.change(screen.getByLabelText("Cancellation note"), {
      target: { value: "Preserve this note" },
    });
    view.rerender(
      <MissionCompletionReview workflowId="workflow-1" workflowState="proof_verified"
        workflowRevision={9} rewardContract={contract} eligibility={eligible}
        pendingReward={null} busy={false} onBackfill={vi.fn()} onApprove={vi.fn()}
        onCancel={onCancel} onActionError={vi.fn()} />,
    );
    expect(screen.getByLabelText("Cancellation category")).toHaveValue("contract_error");
    expect(screen.getByLabelText("Cancellation note")).toHaveValue("Preserve this note");
    expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Workflow changed. Review the current state before acting again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("uses the refreshed revision when the same approval remains valid", async () => {
    const onApprove = vi.fn(async () => ({}));
    const view = renderReview({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Approve completion" }));
    view.rerender(
      <MissionCompletionReview workflowId="workflow-1" workflowState="proof_verified"
        workflowRevision={9} rewardContract={contract} eligibility={eligible}
        pendingReward={null} busy={false} onBackfill={vi.fn()}
        onApprove={onApprove} onCancel={vi.fn()} onActionError={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      expectedState: "proof_verified",
      expectedRevision: 9,
    }));
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
