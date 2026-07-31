import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  CompletionEligibility,
  RewardContract,
  WorkflowState,
} from "@/lib/activeMission";
import type {
  AdminPendingReward,
  ApproveCompletionInput,
  BackfillRewardContractInput,
  CancelRewardHandoffInput,
  RewardCancellationReason,
} from "@/lib/adminRewardHandoff";
import { useI18n } from "@/lib/i18n";

type BackfillInput = Omit<BackfillRewardContractInput, "workspace" | "idempotencyKey">;
type ApproveInput = Omit<ApproveCompletionInput, "workspace" | "idempotencyKey">;
type CancelInput = Omit<CancelRewardHandoffInput, "workspace" | "idempotencyKey">;

export type MissionCompletionReviewProps = {
  workflowId: string;
  workflowState: WorkflowState;
  workflowRevision: number;
  rewardContract: RewardContract | null;
  eligibility: CompletionEligibility;
  pendingReward: AdminPendingReward | null;
  busy: boolean;
  onBackfill: (input: BackfillInput) => Promise<unknown>;
  onApprove: (input: ApproveInput) => Promise<unknown>;
  onCancel: (input: CancelInput) => Promise<unknown>;
  onActionError: (error: unknown) => void;
};

type DialogKind = "approve" | "cancel" | null;

type BackfillForm = {
  pointsAmount: string;
  cashAmount: string;
  currency: string;
  sourceMissionUpdatedAt: string;
  confirmationEvidenceSource: BackfillInput["confirmationEvidenceSource"] | "";
  confirmationReason: string;
};

const EMPTY_BACKFILL: BackfillForm = {
  pointsAmount: "",
  cashAmount: "",
  currency: "",
  sourceMissionUpdatedAt: "",
  confirmationEvidenceSource: "",
  confirmationReason: "",
};

const CANCELLATION_REASONS: readonly RewardCancellationReason[] = [
  "contract_error",
  "eligibility_error",
  "duplicate",
  "other",
];

const EVIDENCE_SOURCES: readonly BackfillInput["confirmationEvidenceSource"][] = [
  "mission_brief",
  "signed_agreement",
  "operator_record",
  "other",
];

const BUTTON = [
  "min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2",
  "font-heading text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50",
  "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--color-ink)]",
].join(" ");

const FIELD = [
  "min-h-11 w-full min-w-0 rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2",
  "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--color-sky)]",
].join(" ");

const BLOCKER_KEYS: Record<CompletionEligibility["blockers"][number], string> = {
  wrong_state: "app.admin.activeMission.completion.blocker.wrongState",
  required_proof_incomplete:
    "app.admin.activeMission.completion.blocker.requiredProofIncomplete",
  reward_contract_required:
    "app.admin.activeMission.completion.blocker.rewardContractRequired",
  pending_reward_exists:
    "app.admin.activeMission.completion.blocker.pendingRewardExists",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validBackfill(form: BackfillForm): boolean {
  const pointsAmount = Number(form.pointsAmount);
  const cashAmount = Number(form.cashAmount);
  const validTimestamp = !form.sourceMissionUpdatedAt
    || Number.isFinite(Date.parse(form.sourceMissionUpdatedAt));
  return Boolean(form.pointsAmount.trim())
    && Boolean(form.cashAmount.trim())
    && Number.isInteger(pointsAmount)
    && pointsAmount >= 0
    && Number.isFinite(cashAmount)
    && cashAmount >= 0
    && /^[A-Za-z]{3}$/.test(form.currency.trim())
    && validTimestamp
    && Boolean(form.confirmationEvidenceSource)
    && form.confirmationReason.trim().length > 0
    && form.confirmationReason.trim().length <= 2_000;
}

export function MissionCompletionReview({
  workflowId,
  workflowState,
  workflowRevision,
  rewardContract,
  eligibility,
  pendingReward,
  busy,
  onBackfill,
  onApprove,
  onCancel,
  onActionError,
}: MissionCompletionReviewProps) {
  const { lang, t } = useI18n();
  const [backfill, setBackfill] = useState<BackfillForm>(EMPTY_BACKFILL);
  const [backfillError, setBackfillError] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [cancellationCategory, setCancellationCategory] = useState<
    RewardCancellationReason | ""
  >("");
  const [cancellationNote, setCancellationNote] = useState("");
  const [cancellationError, setCancellationError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const approvalConfirmRef = useRef<HTMLButtonElement>(null);
  const cancellationCategoryRef = useRef<HTMLSelectElement>(null);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);
  const isBusy = busy || localBusy;
  const locale = lang === "zh" ? "zh-Hant-HK" : "en-HK";
  const approvalActionValid = workflowState === "proof_verified"
    && eligibility.eligible
    && Boolean(rewardContract);
  const cancellationActionValid = workflowState === "reward_pending"
    && pendingReward?.status === "pending";
  const dialogActionValid = dialog === "approve"
    ? approvalActionValid
    : dialog === "cancel"
      ? cancellationActionValid
      : true;

  useEffect(() => {
    if (dialog === "approve") {
      approvalConfirmRef.current?.focus();
      return;
    }
    if (dialog === "cancel") {
      cancellationCategoryRef.current?.focus();
      return;
    }
    const trigger = restoreFocusRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
    } else if (trigger) {
      reviewRef.current?.focus();
    }
    restoreFocusRef.current = null;
  }, [dialog]);

  useEffect(() => {
    if (dialog && isBusy) dialogRef.current?.focus();
  }, [dialog, isBusy]);

  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isBusy) {
          setActionError(null);
          setDialog(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled)",
      ) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialog, isBusy]);

  if (workflowState !== "proof_verified" && workflowState !== "reward_pending") {
    return null;
  }

  const displayReward = rewardContract ?? pendingReward?.reward ?? null;

  function openDialog(kind: Exclude<DialogKind, null>, trigger: HTMLButtonElement) {
    restoreFocusRef.current = trigger;
    setActionError(null);
    setDialog(kind);
  }

  function closeDialog() {
    if (isBusy) return;
    setActionError(null);
    setDialog(null);
  }

  async function perform(
    operation: () => Promise<unknown>,
    successMessage: string,
    closeOnSuccess: boolean,
  ) {
    setActionError(null);
    setLocalBusy(true);
    try {
      await operation();
      setLocalBusy(false);
      setAnnouncement(successMessage);
      if (closeOnSuccess) setDialog(null);
    } catch (error) {
      setLocalBusy(false);
      setActionError(errorMessage(
        error,
        t("app.admin.activeMission.completion.actionFailed"),
      ));
      onActionError(error);
    }
  }

  async function submitBackfill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validBackfill(backfill)) {
      setBackfillError(true);
      return;
    }
    setBackfillError(false);
    const sourceMissionUpdatedAt = backfill.sourceMissionUpdatedAt
      ? new Date(backfill.sourceMissionUpdatedAt).toISOString()
      : null;
    await perform(
      () => onBackfill({
        pointsAmount: Number(backfill.pointsAmount),
        cashAmount: Number(backfill.cashAmount),
        currency: backfill.currency.trim().toUpperCase(),
        xpAmount: 0,
        sourceMissionUpdatedAt,
        confirmationEvidenceSource:
          backfill.confirmationEvidenceSource as BackfillInput["confirmationEvidenceSource"],
        confirmationReason: backfill.confirmationReason.trim(),
      }),
      t("app.admin.activeMission.completion.backfillSuccess"),
      false,
    );
  }

  async function approveCompletion() {
    if (!approvalActionValid) return;
    await perform(
      () => onApprove({
        expectedState: "proof_verified",
        expectedRevision: workflowRevision,
      }),
      t("app.admin.activeMission.completion.approveSuccess"),
      true,
    );
  }

  async function cancelHandoff() {
    if (!cancellationActionValid) return;
    const note = cancellationNote.trim();
    if (
      !CANCELLATION_REASONS.includes(cancellationCategory as RewardCancellationReason)
      || !note
      || note.length > 2_000
    ) {
      setCancellationError(true);
      return;
    }
    setCancellationError(false);
    await perform(
      () => onCancel({
        expectedState: "reward_pending",
        expectedRevision: workflowRevision,
        reasonCategory: cancellationCategory as RewardCancellationReason,
        reasonNote: note,
      }),
      t("app.admin.activeMission.completion.cancelSuccess"),
      true,
    );
  }

  return (
    <section
      ref={reviewRef}
      aria-labelledby={`completion-review-${workflowId}`}
      tabIndex={-1}
      className="min-w-0 space-y-5 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4 sm:p-5"
    >
      <header className="min-w-0 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">
          {workflowState === "reward_pending"
            ? t("app.admin.activeMission.completion.pendingState")
            : t("app.admin.activeMission.completion.verifiedState")}
        </p>
        <h2
          id={`completion-review-${workflowId}`}
          className="break-words font-display text-2xl font-bold"
        >
          {t("app.admin.activeMission.completion.title")}
        </h2>
        <p className="font-bold">
          {t("app.admin.activeMission.completion.proofProgress", {
            verified: eligibility.verifiedRequiredItemCount,
            required: eligibility.requiredItemCount,
          })}
        </p>
      </header>

      {eligibility.blockers.length ? (
        <div className="rounded-xl border-2 border-amber-800 bg-amber-50 p-3">
          <h3 className="font-heading font-bold">
            {t("app.admin.activeMission.completion.blockersTitle")}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {eligibility.blockers.map((blocker) => (
              <li key={blocker}>{t(BLOCKER_KEYS[blocker])}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {displayReward ? (
        <article className="min-w-0 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading text-lg font-bold">
            {t("app.admin.activeMission.completion.frozenReward")}
          </h3>
          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            <span className="rounded-full bg-[var(--color-acid)] px-3 py-1 font-bold">
              {t("app.admin.activeMission.completion.points", {
                amount: new Intl.NumberFormat(locale).format(displayReward.pointsAmount),
              })}
            </span>
            <span className="rounded-full bg-[var(--color-sun)] px-3 py-1 font-bold">
              {new Intl.NumberFormat(locale, {
                style: "currency",
                currency: displayReward.currency,
                currencyDisplay: "symbol",
              }).format(displayReward.cashAmount)}
            </span>
            {displayReward.xpAmount > 0 ? (
              <span className="rounded-full bg-[var(--color-sky)] px-3 py-1 font-bold">
                {t("app.admin.activeMission.completion.xp", {
                  amount: displayReward.xpAmount,
                })}
              </span>
            ) : null}
          </div>
        </article>
      ) : null}

      <p className="rounded-xl border border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
        {t("app.admin.activeMission.completion.noIssuance")}
      </p>

      {workflowState === "proof_verified" && !rewardContract ? (
        <form
          className="min-w-0 space-y-4 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4"
          onSubmit={(event) => void submitBackfill(event)}
        >
          <h3 className="font-heading text-lg font-bold">
            {t("app.admin.activeMission.completion.backfillTitle")}
          </h3>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 font-bold">
              {t("app.admin.activeMission.completion.pointsLabel")}
              <input
                className={FIELD}
                type="number"
                name="pointsAmount"
                autoComplete="off"
                min="0"
                step="1"
                value={backfill.pointsAmount}
                onChange={(event) => setBackfill((current) => ({
                  ...current,
                  pointsAmount: event.target.value,
                }))}
              />
            </label>
            <label className="grid min-w-0 gap-1 font-bold">
              {t("app.admin.activeMission.completion.cashLabel")}
              <input
                className={FIELD}
                type="number"
                name="cashAmount"
                autoComplete="off"
                min="0"
                step="0.01"
                value={backfill.cashAmount}
                onChange={(event) => setBackfill((current) => ({
                  ...current,
                  cashAmount: event.target.value,
                }))}
              />
            </label>
            <label className="grid min-w-0 gap-1 font-bold">
              {t("app.admin.activeMission.completion.currencyLabel")}
              <input
                className={FIELD}
                inputMode="text"
                name="currency"
                autoComplete="off"
                maxLength={3}
                value={backfill.currency}
                onChange={(event) => setBackfill((current) => ({
                  ...current,
                  currency: event.target.value,
                }))}
              />
            </label>
            <label className="grid min-w-0 gap-1 font-bold">
              {t("app.admin.activeMission.completion.sourceUpdatedLabel")}
              <input
                className={FIELD}
                type="datetime-local"
                name="sourceMissionUpdatedAt"
                autoComplete="off"
                value={backfill.sourceMissionUpdatedAt}
                onChange={(event) => setBackfill((current) => ({
                  ...current,
                  sourceMissionUpdatedAt: event.target.value,
                }))}
              />
            </label>
          </div>
          <label className="grid min-w-0 gap-1 font-bold">
            {t("app.admin.activeMission.completion.evidenceLabel")}
            <select
              className={FIELD}
              name="confirmationEvidenceSource"
              autoComplete="off"
              value={backfill.confirmationEvidenceSource}
              onChange={(event) => setBackfill((current) => ({
                ...current,
                confirmationEvidenceSource:
                  event.target.value as BackfillForm["confirmationEvidenceSource"],
              }))}
            >
              <option value="">
                {t("app.admin.activeMission.completion.chooseEvidence")}
              </option>
              {EVIDENCE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {t(`app.admin.activeMission.completion.evidence.${source}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 font-bold">
            {t("app.admin.activeMission.completion.reasonLabel")}
            <textarea
              className={FIELD}
              name="confirmationReason"
              autoComplete="off"
              maxLength={2_000}
              rows={3}
              value={backfill.confirmationReason}
              onChange={(event) => setBackfill((current) => ({
                ...current,
                confirmationReason: event.target.value,
              }))}
            />
          </label>
          <p className="text-sm text-[var(--color-soft-ink)]">
            {t("app.admin.activeMission.completion.zeroXp")}
          </p>
          {backfillError ? (
            <p role="alert" className="font-bold text-red-700">
              {t("app.admin.activeMission.completion.backfillInvalid")}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" aria-live="assertive" className="font-bold text-red-700">
              {actionError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isBusy}
            className={`${BUTTON} bg-[var(--color-acid)]`}
          >
            {t("app.admin.activeMission.completion.saveBackfill")}
          </button>
        </form>
      ) : null}

      <div className="flex min-w-0 flex-wrap gap-2">
        {workflowState === "proof_verified" ? (
          <button
            type="button"
            disabled={isBusy || !eligibility.eligible || !rewardContract}
            onClick={(event) => openDialog("approve", event.currentTarget)}
            className={`${BUTTON} bg-[var(--color-acid)]`}
          >
            {t("app.admin.activeMission.completion.approve")}
          </button>
        ) : null}
        {workflowState === "reward_pending" && pendingReward?.status === "pending" ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={(event) => openDialog("cancel", event.currentTarget)}
            className={`${BUTTON} bg-[var(--color-sun)]`}
          >
            {t("app.admin.activeMission.completion.cancel")}
          </button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="min-h-6 font-bold">
        {announcement}
      </p>

      {dialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3">
          <form
            onSubmit={(event) => event.preventDefault()}
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-busy={isBusy}
            aria-labelledby="completion-dialog-title"
            aria-describedby="completion-dialog-description"
            tabIndex={-1}
            className="max-h-[90vh] w-full min-w-0 max-w-lg overscroll-contain overflow-y-auto rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-xl sm:p-5"
          >
            <h2 id="completion-dialog-title" className="font-display text-xl font-bold">
              {dialog === "approve"
                ? t("app.admin.activeMission.completion.approveDialogTitle")
                : t("app.admin.activeMission.completion.cancelDialogTitle")}
            </h2>
            <p id="completion-dialog-description" className="mt-2">
              {dialog === "approve"
                ? t("app.admin.activeMission.completion.approveDialogBody")
                : t("app.admin.activeMission.completion.cancelDialogBody")}
            </p>

            {dialog === "cancel" ? (
              <div className="mt-4 space-y-3">
                <label className="grid min-w-0 gap-1 font-bold">
                  {t("app.admin.activeMission.completion.cancelCategory")}
                  <select
                    ref={cancellationCategoryRef}
                    className={FIELD}
                    name="cancellationCategory"
                    autoComplete="off"
                    value={cancellationCategory}
                    disabled={isBusy}
                    onChange={(event) => setCancellationCategory(
                      event.target.value as RewardCancellationReason | "",
                    )}
                  >
                    <option value="">
                      {t("app.admin.activeMission.completion.chooseCancelCategory")}
                    </option>
                    {CANCELLATION_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {t(`app.admin.activeMission.completion.cancelReason.${reason}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-0 gap-1 font-bold">
                  {t("app.admin.activeMission.completion.cancelNote")}
                  <textarea
                    className={FIELD}
                    name="cancellationReasonNote"
                    autoComplete="off"
                    rows={4}
                    maxLength={2_000}
                    disabled={isBusy}
                    value={cancellationNote}
                    onChange={(event) => setCancellationNote(event.target.value)}
                  />
                </label>
                {cancellationError ? (
                  <p role="alert" className="font-bold text-red-700">
                    {t("app.admin.activeMission.completion.cancelInvalid")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!dialogActionValid ? (
              <p role="alert" className="mt-4 font-bold text-red-700">
                {t("app.admin.activeMission.completion.staleAction")}
              </p>
            ) : actionError ? (
              <p role="alert" className="mt-4 font-bold text-red-700">
                {actionError}
              </p>
            ) : null}

            <div className="mt-5 flex min-w-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={closeDialog}
                className={`${BUTTON} bg-white`}
              >
                {t("app.admin.activeMission.completion.keepReviewing")}
              </button>
              {dialog === "approve" ? (
                <button
                  ref={approvalConfirmRef}
                  type="button"
                  disabled={isBusy || !dialogActionValid}
                  onClick={() => void approveCompletion()}
                  className={`${BUTTON} bg-[var(--color-acid)]`}
                >
                  {t("app.admin.activeMission.completion.confirmApprove")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy || !dialogActionValid}
                  onClick={() => void cancelHandoff()}
                  className={`${BUTTON} bg-[var(--color-sun)]`}
                >
                  {t("app.admin.activeMission.completion.confirmCancel")}
                </button>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
