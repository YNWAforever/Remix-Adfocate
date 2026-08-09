import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SubmissionWorkspace, type WorkingDraft, useSubmitWorkItem } from "@/lib/queries/creatorStudio";
import { AssetUploadPanel } from "./AssetUploadPanel";
import { DeliverableNavigator } from "./DeliverableNavigator";
import { DraftEditor, draftFormValue, type DraftFormValue } from "./DraftEditor";
import { NextActionPanel } from "./NextActionPanel";
import { PublicationProofPanel } from "./PublicationProofPanel";
import { ReviewFeedback } from "./ReviewFeedback";
import { WorkspaceHeader, type WorkspaceSaveStatus } from "./WorkspaceHeader";

const commandId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
const draftFingerprint = (value: DraftFormValue) => JSON.stringify({
  caption: value.caption,
  externalUrl: value.externalUrl,
  checklist: Object.entries(value.checklist).sort(([left], [right]) => left.localeCompare(right)),
  version: value.version,
});
const sameDraft = (left: DraftFormValue, right: DraftFormValue) => draftFingerprint(left) === draftFingerprint(right);

export type CreatorStudioWorkbenchProps = { submissionId: string; workspace: SubmissionWorkspace; onReloadWorkspace?: () => Promise<SubmissionWorkspace | undefined> };

export function CreatorStudioWorkbench({ submissionId, workspace, onReloadWorkspace }: CreatorStudioWorkbenchProps) {
  const workItems = useMemo(() => [...workspace.workItems].sort((left, right) => left.position - right.position), [workspace.workItems]);
  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(() => workspace.nextAction?.workItemId ?? workItems[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, DraftFormValue>>({});
  const [persistedDrafts, setPersistedDrafts] = useState<Record<string, DraftFormValue>>({});
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const previousSubmissionId = useRef(submissionId);
  const submitCommand = useRef({ submissionId, workItemId: null as string | null, expectedVersion: null as number | null, id: null as string | null });
  const resetSubmitCommand = useCallback(() => { submitCommand.current = { submissionId, workItemId: null, expectedVersion: null, id: null }; }, [submissionId]);

  useEffect(() => {
    const contextChanged = previousSubmissionId.current !== submissionId;
    previousSubmissionId.current = submissionId;
    setActiveWorkItemId((current) => workItems.some((item) => item.id === current) ? current : (workspace.nextAction?.workItemId ?? workItems[0]?.id ?? null));
    setDrafts((current) => {
      const next = contextChanged ? {} : { ...current };
      workItems.forEach((item) => { next[item.id] ??= draftFormValue(item); });
      return next;
    });
    setPersistedDrafts((current) => {
      const next = contextChanged ? {} : { ...current };
      workItems.forEach((item) => { next[item.id] ??= draftFormValue(item); });
      return next;
    });
    if (contextChanged) { resetSubmitCommand(); setSaveStatus("idle"); setSubmitError(null); }
  }, [resetSubmitCommand, submissionId, workItems, workspace.nextAction?.workItemId]);

  const activeWorkItem = workItems.find((item) => item.id === activeWorkItemId) ?? workItems[0];
  const activeDraft = activeWorkItem ? drafts[activeWorkItem.id] ?? draftFormValue(activeWorkItem) : undefined;
  const persistedActiveDraft = activeWorkItem ? persistedDrafts[activeWorkItem.id] ?? draftFormValue(activeWorkItem) : undefined;
  const activeDraftDirty = Boolean(activeDraft && persistedActiveDraft && !sameDraft(activeDraft, persistedActiveDraft));
  const activeServerReady = Boolean(activeWorkItem && activeWorkItem.validation.caption && activeWorkItem.validation.externalUrl && activeWorkItem.validation.checklist && activeWorkItem.validation.assets && activeWorkItem.validation.publicationProof);
  const submitWorkItem = useSubmitWorkItem(submissionId, activeWorkItem?.id ?? "");

  useEffect(() => { if (submitCommand.current.workItemId !== activeWorkItem?.id) resetSubmitCommand(); }, [activeWorkItem?.id, resetSubmitCommand, submissionId]);

  const updateDraft = (value: DraftFormValue) => {
    if (activeWorkItem) setDrafts((current) => ({ ...current, [activeWorkItem.id]: value }));
  };
  const applySavedDraft = (draft: WorkingDraft) => {
    if (!activeWorkItem) return;
    const persisted = { caption: draft.caption ?? "", externalUrl: draft.externalUrl ?? "", checklist: { ...draft.checklist }, version: draft.version };
    setDrafts((current) => ({ ...current, [activeWorkItem.id]: persisted }));
    setPersistedDrafts((current) => ({ ...current, [activeWorkItem.id]: persisted }));
    resetSubmitCommand();
    setSubmitError(null);
  };
  const reloadLatestDraft = async () => {
    if (!activeWorkItem || !onReloadWorkspace) return null;
    const latestWorkspace = await onReloadWorkspace();
    const latestWorkItem = latestWorkspace?.workItems.find((item) => item.id === activeWorkItem.id);
    if (!latestWorkItem) return null;
    const latestDraft = draftFormValue(latestWorkItem);
    setDrafts((current) => ({ ...current, [latestWorkItem.id]: latestDraft }));
    setPersistedDrafts((current) => ({ ...current, [latestWorkItem.id]: latestDraft }));
    resetSubmitCommand();
    setSaveStatus("idle");
    setSubmitError(null);
    return latestDraft;
  };
  const focus = (id: string) => document.getElementById(id)?.focus();
  const focusSaveDraft = () => { if (activeWorkItem) focus(`creator-save-draft-${activeWorkItem.id}`); };
  const submit = async () => {
    if (!activeWorkItem || !activeDraft || activeDraftDirty || !activeServerReady) { if (activeDraftDirty) focusSaveDraft(); return; }
    const current = submitCommand.current;
    const id = current.submissionId === submissionId && current.workItemId === activeWorkItem.id && current.expectedVersion === activeDraft.version && current.id
      ? current.id
      : commandId("creator-submit");
    const command = { submissionId, workItemId: activeWorkItem.id, expectedVersion: activeDraft.version, id };
    submitCommand.current = command;
    try {
      await submitWorkItem.mutateAsync({ commandId: command.id, expectedVersion: activeDraft.version });
      resetSubmitCommand();
      setSubmitError(null);
    } catch (error) {
      setSubmitError(errorCode(error) ?? "submit_failed");
    }
  };

  const submitErrorMessage = submitError === "version_conflict"
    ? "This submission changed elsewhere. Reload the latest draft before retrying."
    : "Submission could not be completed. Retry or reload the latest draft.";
  return <main className="mx-auto w-full max-w-7xl space-y-4 p-4"><WorkspaceHeader workspace={workspace} saveStatus={saveStatus} />{submitError ? <div role="alert" className="space-y-2 rounded-lg border-2 border-[var(--color-magenta)] bg-white p-3 text-sm text-[var(--color-magenta)]"><p>{submitErrorMessage}</p>{onReloadWorkspace ? <button type="button" onClick={() => void reloadLatestDraft()} className="underline">Reload latest draft</button> : null}</div> : null}{activeWorkItem && activeDraft ? <div className="grid gap-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(0,2fr)_minmax(14rem,0.9fr)]"><DeliverableNavigator workItems={workItems} activeWorkItemId={activeWorkItem.id} onSelect={(id) => { resetSubmitCommand(); setSubmitError(null); setActiveWorkItemId(id); setSaveStatus("idle"); }} /><div className="space-y-4"><DraftEditor key={activeWorkItem.id} submissionId={submissionId} workItem={activeWorkItem} value={activeDraft} onChange={updateDraft} onSaved={applySavedDraft} onSaveStatus={setSaveStatus} onReloadLatestDraft={reloadLatestDraft} /><AssetUploadPanel key={activeWorkItem.id} submissionId={submissionId} workItem={activeWorkItem} /><PublicationProofPanel key={activeWorkItem.id} submissionId={submissionId} workItem={activeWorkItem} /></div><aside className="space-y-4"><NextActionPanel nextAction={workspace.nextAction} workItems={workItems} activeWorkItem={activeWorkItem} submitting={submitWorkItem.isPending} hasUnsavedDraft={activeDraftDirty} onNavigate={(id) => { resetSubmitCommand(); setSubmitError(null); setActiveWorkItemId(id); }} onSubmit={() => void submit()} onFocusEditor={() => focus(`creator-draft-editor-${activeWorkItem.id}`)} onFocusSave={focusSaveDraft} onFocusAsset={() => focus(`creator-proof-asset-${activeWorkItem.id}`)} onFocusProof={() => focus(`publication-proof-${activeWorkItem.id}`)} onFocusReview={() => focus(`creator-review-feedback-${activeWorkItem.id}`)} /><ReviewFeedback workItem={activeWorkItem} /></aside></div> : <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"><h2 className="font-heading font-bold">No deliverables are available.</h2></section>}</main>;
}
