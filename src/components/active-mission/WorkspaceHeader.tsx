import type { ActiveMissionNextAction, ActiveMissionWorkspace } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";

type WorkspaceHeaderProps = {
  workspace: ActiveMissionWorkspace;
  nextAction: ActiveMissionNextAction;
  onPrimaryAction: (action: ActiveMissionNextAction) => void;
};

const WORKFLOW_KEYS: Record<ActiveMissionWorkspace["workflow"]["state"], string> = {
  accepted: "app.activeMission.workspace.state.accepted",
  fulfillment_pending: "app.activeMission.workspace.state.fulfillmentPending",
  drafting: "app.activeMission.workspace.state.drafting",
  in_review: "app.activeMission.workspace.state.inReview",
  revision_requested: "app.activeMission.workspace.state.revisionRequested",
  approved_to_publish: "app.activeMission.workspace.state.approvedToPublish",
  publication_in_progress: "app.activeMission.workspace.state.inReview",
  proof_verified: "app.activeMission.workspace.state.approvedToPublish",
  reward_pending: "app.activeMission.workspace.state.rewardPending",
  cancelled: "app.activeMission.workspace.state.cancelled",
  expired: "app.activeMission.workspace.state.expired",
};

const ACTION_KEYS: Record<ActiveMissionNextAction["kind"], string> = {
  wait_for_setup: "app.activeMission.workspace.action.waitForSetup",
  wait_for_shipment: "app.activeMission.workspace.action.waitForShipment",
  confirm_receipt: "app.activeMission.workspace.action.confirmReceipt",
  draft: "app.activeMission.workspace.action.draft",
  revise: "app.activeMission.workspace.action.revise",
  await_review: "app.activeMission.workspace.action.awaitReview",
  await_publication: "app.activeMission.workspace.action.awaitPublication",
  publish_and_submit_proof: "app.activeMission.workspace.action.awaitPublication",
  await_proof_review: "app.activeMission.workspace.action.awaitReview",
  revise_publication_proof: "app.activeMission.workspace.action.revise",
  proof_verified: "app.activeMission.workspace.action.awaitPublication",
  contact_support: "app.activeMission.workspace.action.contactSupport",
};

const RESPONSIBLE_KEYS: Record<ActiveMissionNextAction["kind"], string> = {
  wait_for_setup: "app.activeMission.workspace.responsible.waitForSetup",
  wait_for_shipment: "app.activeMission.workspace.responsible.waitForShipment",
  confirm_receipt: "app.activeMission.workspace.responsible.confirmReceipt",
  draft: "app.activeMission.workspace.responsible.draft",
  revise: "app.activeMission.workspace.responsible.revise",
  await_review: "app.activeMission.workspace.responsible.awaitReview",
  await_publication: "app.activeMission.workspace.responsible.awaitPublication",
  publish_and_submit_proof: "app.activeMission.workspace.responsible.awaitPublication",
  await_proof_review: "app.activeMission.workspace.responsible.awaitReview",
  revise_publication_proof: "app.activeMission.workspace.responsible.revise",
  proof_verified: "app.activeMission.workspace.responsible.awaitPublication",
  contact_support: "app.activeMission.workspace.responsible.contactSupport",
};

const BLOCK_REASON_KEYS: Record<string, string> = {
  feedback_requires_changes: "app.activeMission.workspace.blocked.feedbackRequiresChanges",
  fulfillment_not_shipped: "app.activeMission.workspace.blocked.fulfillmentNotShipped",
  fulfillment_receipt_required: "app.activeMission.workspace.blocked.fulfillmentReceiptRequired",
  operator_review: "app.activeMission.workspace.blocked.operatorReview",
  approval_is_not_completion: "app.activeMission.workspace.blocked.approvalIsNotCompletion",
  work_items_not_ready: "app.activeMission.workspace.blocked.workItemsNotReady",
  workflow_cancelled: "app.activeMission.workspace.blocked.workflowCancelled",
  workflow_expired: "app.activeMission.workspace.blocked.workflowExpired",
  workflow_has_no_work_items: "app.activeMission.workspace.blocked.noWorkItems",
  workflow_state_inconsistent: "app.activeMission.workspace.blocked.workflowInconsistent",
  fulfillment_state_inconsistent: "app.activeMission.workspace.blocked.fulfillmentInconsistent",
};

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(parsed);
}

export function WorkspaceHeader({ workspace, nextAction, onPrimaryAction }: WorkspaceHeaderProps) {
  const { lang, t } = useI18n();
  const reasonKey = nextAction.blockedReason ? BLOCK_REASON_KEYS[nextAction.blockedReason] : null;
  const reasonFallback = nextAction.blockedReason?.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()) ?? "";
  return (
    <header className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{t("app.activeMission.workspace.label")}</p>
          <h1 className="break-words font-heading text-2xl font-black text-pretty">{workspace.mission.title}</h1>
          <span className="inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
            {t(WORKFLOW_KEYS[workspace.workflow.state])}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onPrimaryAction(nextAction)}
          className="min-h-11 shrink-0 touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t(ACTION_KEYS[nextAction.kind])}
        </button>
      </div>

      <dl className="mt-5 grid gap-4 border-t-2 border-[var(--color-ink)] pt-4 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{t("app.activeMission.workspace.responsible")}</dt>
          <dd className="mt-1 text-sm font-medium">{t(RESPONSIBLE_KEYS[nextAction.kind])}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{t("app.activeMission.workspace.deadline")}</dt>
          <dd className="mt-1 text-sm font-medium">
            {nextAction.deadline ? <time dateTime={nextAction.deadline}>{formatDate(nextAction.deadline, lang === "zh" ? "zh-HK" : "en-US")}</time> : t("app.activeMission.workspace.noDeadline")}
          </dd>
        </div>
        {nextAction.blockedReason ? (
          <div className="sm:col-span-2">
            <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{t("app.activeMission.workspace.blockedWhy")}</dt>
            <dd className="mt-1 break-words text-sm font-medium">{reasonKey ? t(reasonKey) : t("app.activeMission.workspace.unknownReason", { reason: reasonFallback })}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
