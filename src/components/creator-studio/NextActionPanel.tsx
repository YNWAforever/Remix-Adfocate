import type { NextAction, WorkItem } from "@/lib/queries/creatorStudio";

function actionLabel(action: NextAction, target: WorkItem) {
  if (action.state === "not_started") return "Start drafting";
  if (action.state === "drafting") return target.requiresAsset && !target.validation.assets ? "Upload proof" : "Finish draft";
  if (action.state === "ready_to_submit") return "Submit deliverable";
  if (action.state === "changes_requested") return target.validation.caption && target.validation.externalUrl && target.validation.checklist && target.validation.assets ? "Resubmit deliverable" : "Review requested changes";
  if (action.state === "submitted") return "View submission status";
  if (action.state === "resubmitted") return "View resubmission status";
  return "Approved";
}

export function NextActionPanel({ nextAction, workItems, activeWorkItem, submitting, onNavigate, onSubmit, onFocusEditor, onFocusSave, onFocusAsset, onFocusReview }: { nextAction: NextAction | null; workItems: WorkItem[]; activeWorkItem: WorkItem | undefined; submitting: boolean; onNavigate: (workItemId: string) => void; onSubmit: () => void; onFocusEditor: () => void; onFocusSave: () => void; onFocusAsset: () => void; onFocusReview: () => void }) {
  if (!nextAction) return <section aria-label="Next action" className="rounded-[var(--radius)] border border-[var(--color-ink)] bg-white p-3"><h2 className="font-heading font-bold">Next action</h2><p className="mt-2 text-sm">All deliverables are complete.</p></section>;
  const target = workItems.find((item) => item.id === nextAction.workItemId); if (!target) return null;
  const ready = target.validation.caption && target.validation.externalUrl && target.validation.checklist && target.validation.assets;
  const label = actionLabel(nextAction, target);
  const isElsewhere = target.id !== activeWorkItem?.id;
  const isSubmit = label === "Submit deliverable" || label === "Resubmit deliverable";
  const terminal = label === "Approved" || label.startsWith("View");
  const disabled = terminal || submitting || (isSubmit && !ready);
  const activate = () => {
    if (isElsewhere) { onNavigate(target.id); return; }
    if (isSubmit) { onSubmit(); return; }
    if (label === "Start drafting") { onFocusEditor(); return; }
    if (label === "Finish draft") { onFocusSave(); return; }
    if (label === "Upload proof") { onFocusAsset(); return; }
    if (label === "Review requested changes") onFocusReview();
  };
  return <section aria-label="Next action" className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"><h2 className="font-heading font-bold">Next action</h2>{isElsewhere ? <p className="mt-2 text-sm">Next deliverable: {target.title}</p> : null}{nextAction.state === "approved" ? <p className="mt-2 text-sm">All deliverables are approved.</p> : null}{!ready && isSubmit ? <p className="mt-2 text-sm text-[var(--color-soft-ink)]">Complete the required draft fields and assets before submitting.</p> : null}<button type="button" disabled={disabled} onClick={activate} className="mt-3 w-full rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow,#FFE66D)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">{isElsewhere ? `Open ${target.title}` : label}</button></section>;
}
