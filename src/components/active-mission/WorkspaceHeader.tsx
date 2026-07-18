import type { ActiveMissionNextAction, ActiveMissionWorkspace } from "@/lib/activeMission";

type WorkspaceHeaderProps = {
  workspace: ActiveMissionWorkspace;
  nextAction: ActiveMissionNextAction;
  onPrimaryAction: (action: ActiveMissionNextAction) => void;
};

const WORKFLOW_LABELS: Record<ActiveMissionWorkspace["workflow"]["state"], string> = {
  accepted: "Accepted",
  fulfillment_pending: "Fulfillment pending",
  drafting: "Drafting",
  in_review: "In review",
  revision_requested: "Revision requested",
  approved_to_publish: "Approved to publish",
  cancelled: "Cancelled",
  expired: "Expired",
};

const ACTION_LABELS: Record<ActiveMissionNextAction["kind"], string> = {
  wait_for_setup: "View mission details",
  wait_for_shipment: "View delivery status",
  confirm_receipt: "Confirm receipt",
  draft: "Continue draft",
  revise: "Revise draft",
  await_review: "View submitted version",
  await_publication: "View publishing instructions",
  contact_support: "Contact support",
};

const RESPONSIBLE_LABELS: Record<ActiveMissionNextAction["kind"], string> = {
  wait_for_setup: "Adfocate is responsible for setting up your deliverables.",
  wait_for_shipment: "Adfocate is responsible for shipping the product.",
  confirm_receipt: "You are responsible for confirming receipt.",
  draft: "You are responsible for preparing the next draft.",
  revise: "You are responsible for addressing the requested changes.",
  await_review: "Adfocate is responsible for reviewing your submission.",
  await_publication: "You are responsible for publishing only when instructed.",
  contact_support: "Adfocate support is responsible for resolving this blocker.",
};

const BLOCK_REASON_LABELS: Record<string, string> = {
  feedback_requires_changes: "Feedback requires changes.",
  fulfillment_not_shipped: "The product has not shipped yet.",
  fulfillment_receipt_required: "Confirm receipt before drafting.",
  operator_review: "The operator is reviewing your submission.",
  approval_is_not_completion: "Approval to publish does not issue rewards.",
  work_items_not_ready: "Deliverables are still being prepared.",
  workflow_cancelled: "This mission was cancelled.",
  workflow_expired: "This mission expired.",
  workflow_has_no_work_items: "No deliverables are available. Contact support.",
  workflow_state_inconsistent: "The mission needs support before you can continue.",
  fulfillment_state_inconsistent: "The delivery status needs support.",
};

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME.format(parsed);
}

function blockingReason(reason: string): string {
  return BLOCK_REASON_LABELS[reason]
    ?? `${reason.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase())}.`;
}

export function WorkspaceHeader({ workspace, nextAction, onPrimaryAction }: WorkspaceHeaderProps) {
  return (
    <header className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">Active mission</p>
          <h1 className="break-words font-heading text-2xl font-black text-pretty">{workspace.mission.title}</h1>
          <span className="inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
            {WORKFLOW_LABELS[workspace.workflow.state]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onPrimaryAction(nextAction)}
          className="min-h-11 shrink-0 touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {ACTION_LABELS[nextAction.kind]}
        </button>
      </div>

      <dl className="mt-5 grid gap-4 border-t-2 border-[var(--color-ink)] pt-4 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">Responsible</dt>
          <dd className="mt-1 text-sm font-medium">{RESPONSIBLE_LABELS[nextAction.kind]}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">Deadline</dt>
          <dd className="mt-1 text-sm font-medium">
            {nextAction.deadline ? <time dateTime={nextAction.deadline}>{formatDate(nextAction.deadline)}</time> : "No deadline set"}
          </dd>
        </div>
        {nextAction.blockedReason ? (
          <div className="sm:col-span-2">
            <dt className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">Why this is blocked</dt>
            <dd className="mt-1 break-words text-sm font-medium">{blockingReason(nextAction.blockedReason)}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
