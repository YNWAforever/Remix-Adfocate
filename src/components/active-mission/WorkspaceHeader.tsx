import type { ActiveMissionNextAction, ActiveMissionWorkspace } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";
import { creatorRewardExperience } from "@/lib/rewardHandoff";
import { formatHongKongDateTime } from "@/lib/creatorFormatting";

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
  proof_verified: "app.activeMission.workspace.state.proofVerified",
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
  return formatHongKongDateTime(value, locale);
}

export function WorkspaceHeader({ workspace, nextAction, onPrimaryAction }: WorkspaceHeaderProps) {
  const { lang, t } = useI18n();
  const rewardExperience = creatorRewardExperience(workspace.workflow.state, workspace.pendingReward);
  const rewardReview = rewardExperience === "reward_pending";
  const rewardReassessment = rewardExperience === "reward_reassessment";
  const actionKey = rewardReview
    ? "app.activeMission.workspace.action.rewardPending"
    : rewardReassessment
      ? "app.activeMission.workspace.action.rewardReassessment"
      : ACTION_KEYS[nextAction.kind];
  const stateKey = rewardReassessment
    ? "app.activeMission.workspace.state.proofVerified"
    : WORKFLOW_KEYS[workspace.workflow.state];
  const responsibleKey = rewardExperience
    ? "app.activeMission.workspace.responsible.rewardReview"
    : RESPONSIBLE_KEYS[nextAction.kind];
  const blockedReason = rewardExperience ? null : nextAction.blockedReason;
  const reasonKey = blockedReason ? BLOCK_REASON_KEYS[blockedReason] : null;
  const reasonFallback = blockedReason?.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()) ?? "";
  return (
    <header className="s-card s-stack">
      <div className="s-between" style={{ alignItems: "flex-start" }}>
        <div className="s-stack" style={{ gap: 10 }}>
          <span className="s-eyebrow">{t("app.activeMission.workspace.label")}</span>
          <h1 className="min-w-0 break-words text-pretty">{workspace.mission.title}</h1>
          <div className="s-row">
            <span className="s-tag">{t(stateKey)}</span>
          </div>
        </div>
        <button type="button" onClick={() => onPrimaryAction(nextAction)} className="s-btn s-primary shrink-0 touch-manipulation">
          {t(actionKey)}
        </button>
      </div>

      <dl className="s-row" style={{ gap: "12px 32px", alignItems: "flex-start", margin: 0 }}>
        <div>
          <dt className="s-eyebrow" style={{ fontSize: 11 }}>{t("app.activeMission.workspace.deadline")}</dt>
          <dd style={{ margin: 0 }}>
            {rewardExperience ? t("app.activeMission.workspace.rewardReviewTiming") : nextAction.deadline ? <time dateTime={nextAction.deadline}>{formatDate(nextAction.deadline, lang === "zh" ? "zh-HK" : "en-US")}</time> : t("app.activeMission.workspace.noDeadline")}
          </dd>
        </div>
        <div>
          <dt className="s-eyebrow" style={{ fontSize: 11 }}>{t("app.activeMission.workspace.responsible")}</dt>
          <dd style={{ margin: 0 }}>{t(responsibleKey)}</dd>
        </div>
      </dl>

      {blockedReason ? (
        <p className="s-note" role="status">
          {reasonKey ? t(reasonKey) : t("app.activeMission.workspace.unknownReason", { reason: reasonFallback })}
        </p>
      ) : null}    </header>
  );
}
