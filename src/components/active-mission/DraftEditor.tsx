import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MissionDraft, MissionWorkItemView } from "@/lib/activeMission";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AssistContext } from "@/lib/missionAssist";
import { MissionAssistLauncher } from "../assistant/MissionAssistLauncher";
import type {
  MissionDraftConflict,
  SaveMissionDraftInput,
  SubmitMissionWorkItemInput,
} from "@/lib/queries/activeMission";
import {
  normalizeRequirements,
  ReviewFeedback,
  type RequiredChangeView,
} from "./ReviewFeedback";
import { formatHongKongDateTime } from "@/lib/creatorFormatting";

type DraftSaveResult = void | MissionDraft | { draft: MissionDraft };

type DraftEditorProps = {
  item: MissionWorkItemView;
  requiredChanges?: readonly RequiredChangeView[];
  revisionDeadline?: string | null;
  conflict?: MissionDraftConflict | null;
  onSave: (input: SaveMissionDraftInput) => Promise<DraftSaveResult> | DraftSaveResult;
  onSubmit: (input: SubmitMissionWorkItemInput) => Promise<unknown> | unknown;
  onReconcileSubmit?: () => Promise<unknown> | unknown;
  onUploadFile?: (file: File) => Promise<unknown> | unknown;
  acceptedMimeTypes?: readonly string[];
  maxFileSizeBytes?: number;
  existingAssetCount?: number;
  assistContext?: AssistContext;
};

type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";
type UploadStatus = "uploading" | "uploaded" | "failed";
type UploadEntry = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  file?: File;
  status: UploadStatus;
  attempt: number;
};
type SubmitAttempt = {
  workItemId: string;
  revision: number;
  key: string;
};

const DEFAULT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"] as const;
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_COUNT = 5;

function displayTime(value: string, locale: string): string {
  return formatHongKongDateTime(value, locale);
}

function revisionFrom(result: DraftSaveResult, fallback: number): number {
  if (!result) return fallback;
  if ("revision" in result && typeof result.revision === "number") return result.revision;
  if ("draft" in result && typeof result.draft.revision === "number") return result.draft.revision;
  return fallback;
}

function isStaleError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "WORKFLOW_STALE";
}

const DEFINITIVE_SUBMIT_CODES = new Set([
  "VALIDATION_FAILED", "WORKFLOW_STALE", "WRONG_STATE", "DEADLINE_PASSED",
  "REVISION_LIMIT_REACHED", "NOT_AUTHORIZED", "WORKFLOW_NOT_FOUND",
]);

function isDefinitiveSubmitError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 400 && error.status < 500;
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && DEFINITIVE_SUBMIT_CODES.has(error.code);
}

function fileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function DraftEditor({
  item,
  requiredChanges = [],
  revisionDeadline = null,
  conflict = null,
  onSave,
  onSubmit,
  onReconcileSubmit,
  onUploadFile,
  acceptedMimeTypes = DEFAULT_MIME_TYPES,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
  existingAssetCount = 0,
  assistContext,
}: DraftEditorProps) {
  const captionId = useId();
  const { lang, t } = useI18n();
  const urlId = useId();
  const fileInputId = useId();
  const headingId = useId();
  const [caption, setCaption] = useState(item.draft?.caption ?? "");
  const [externalUrl, setExternalUrl] = useState(item.draft?.externalUrl ?? "");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(item.draft?.checklist ?? {});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editSequence, setEditSequence] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitErrorRef = useRef<HTMLParagraphElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const revisionRef = useRef(item.draft?.revision ?? 0);
  const saveHandlerRef = useRef(onSave);
  saveHandlerRef.current = onSave;
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptedEditRef = useRef({ generation: 0, sequence: 0 });
  const scopeRef = useRef({ itemId: item.id, generation: 0 });
  const saveQueueRef = useRef<{ generation: number; promise: Promise<unknown> }>({ generation: 0, promise: Promise.resolve() });
  const activeSaveRef = useRef<{ generation: number; promise: Promise<DraftSaveResult> } | null>(null);
  const submitAttemptRef = useRef<SubmitAttempt | null>(null);
  const uploadAttemptsRef = useRef(new Map<string, number>());
  if (scopeRef.current.itemId !== item.id) {
    scopeRef.current = { itemId: item.id, generation: scopeRef.current.generation + 1 };
    saveQueueRef.current = { generation: scopeRef.current.generation, promise: Promise.resolve() };
    activeSaveRef.current = null;
    submitAttemptRef.current = null;
    uploadAttemptsRef.current = new Map();
  }
  const renderGeneration = scopeRef.current.generation;
  const [stateItemId, setStateItemId] = useState(item.id);
  const requirements = normalizeRequirements(item.requirements);
  const requiredRequirements = requirements.filter(({ required }) => required);
  const allRequiredChecked = requiredRequirements.every(({ id }) => checklist[id] === true);
  const canEdit = item.state === "drafting" || item.state === "revision_requested";
  const effectiveSaveStatus = conflict ? "conflict" : saveStatus;

  useEffect(() => {
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);

  useEffect(() => {
    if (stateItemId === item.id) return;
    setStateItemId(item.id);
    setCaption(item.draft?.caption ?? "");
    setExternalUrl(item.draft?.externalUrl ?? "");
    setChecklist(item.draft?.checklist ?? {});
    revisionRef.current = item.draft?.revision ?? 0;
    setSaveStatus("idle");
    setEditSequence(0);
    setUploads([]);
    setFileError(null);
    setSubmitError(null);
    setIsSubmitting(false);
    setIsRecovering(false);
    submitAttemptRef.current = null;
  }, [item.draft, item.id, stateItemId]);

  const isCurrentScope = useCallback((generation: number, workItemId: string): boolean => {
    return scopeRef.current.generation === generation && scopeRef.current.itemId === workItemId;
  }, []);

  const queueSave = useCallback((input: SaveMissionDraftInput, generation: number): Promise<DraftSaveResult> => {
    // Owner mutation renders can replace onSave without creating another authored edit.
    // Bind the handler now so already queued work retains its original scope.
    const save = saveHandlerRef.current;
    const previous = saveQueueRef.current.generation === generation ? saveQueueRef.current.promise : Promise.resolve();
    const promise = previous.catch(() => undefined).then(async () => {
      const executionInput = isCurrentScope(generation, input.workItemId)
        ? { ...input, revision: revisionRef.current }
        : input;
      const result = await save(executionInput);
      if (isCurrentScope(generation, input.workItemId)) {
        const nextRevision = revisionFrom(result, revisionRef.current);
        revisionRef.current = nextRevision;
        const attempt = submitAttemptRef.current;
        if (attempt && (attempt.workItemId !== input.workItemId || attempt.revision !== nextRevision)) {
          submitAttemptRef.current = null;
        }
      }
      return result;
    });
    saveQueueRef.current = { generation, promise };
    activeSaveRef.current = { generation, promise };
    return promise;
  }, [isCurrentScope]);

  useEffect(() => {
    if (editSequence === 0 || !canEdit || stateItemId !== item.id || conflict) return;
    if (attemptedEditRef.current.generation === renderGeneration && attemptedEditRef.current.sequence === editSequence) return;
    setSaveStatus("saving");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const input: SaveMissionDraftInput = {
        workItemId: item.id,
        revision: revisionRef.current,
        caption,
        externalUrl: externalUrl.trim() || null,
        checklist,
      };
      autosaveTimerRef.current = null;
      const generation = renderGeneration;
      attemptedEditRef.current = { generation, sequence: editSequence };
      void queueSave(input, generation)
        .then(() => {
          if (isCurrentScope(generation, input.workItemId)) setSaveStatus("saved");
        })
        .catch((error: unknown) => {
          if (isCurrentScope(generation, input.workItemId)) setSaveStatus(isStaleError(error) ? "conflict" : "error");
        });
    }, 800);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [canEdit, caption, checklist, conflict, editSequence, externalUrl, isCurrentScope, item.id, queueSave, renderGeneration, stateItemId]);

  function markEdited() {
    setSaveStatus("saving");
    setEditSequence((current) => current + 1);
  }

  async function retryRetainedDraft() {
    if (!canEdit || isRecovering || isSubmitting) return;
    if (effectiveSaveStatus === "conflict" && !conflict?.currentDraft) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    // The user has compared the server draft and explicitly chosen to save local input.
    if (conflict?.currentDraft) revisionRef.current = conflict.currentDraft.revision;
    const generation = renderGeneration, workItemId = item.id;
    attemptedEditRef.current = { generation, sequence: editSequence };
    setIsRecovering(true); setSaveStatus("saving");
    try {
      await queueSave({workItemId, revision:revisionRef.current, caption, externalUrl:externalUrl.trim() || null, checklist}, generation);
      if (isCurrentScope(generation, workItemId)) setSaveStatus("saved");
    } catch (error) {
      if (isCurrentScope(generation, workItemId)) setSaveStatus(isStaleError(error) ? "conflict" : "error");
    } finally {
      if (isCurrentScope(generation, workItemId)) setIsRecovering(false);
    }
  }

  async function submitVersion() {
    if (!canEdit || !allRequiredChecked || isSubmitting) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSubmitError(null);
    setIsSubmitting(true);
    const generation = renderGeneration;
    const workItemId = item.id;
    try {
      const activeSave = activeSaveRef.current;
      if (activeSave?.generation === generation) await activeSave.promise;
      if (!isCurrentScope(generation, workItemId)) return;
      const saved = await queueSave({
        workItemId,
        revision: revisionRef.current,
        caption,
        externalUrl: externalUrl.trim() || null,
        checklist,
      }, generation);
      if (!isCurrentScope(generation, workItemId)) return;
      revisionRef.current = revisionFrom(saved, revisionRef.current);
      setSaveStatus("saved");
      const expectedRevision = revisionRef.current;
      const existingAttempt = submitAttemptRef.current;
      const attempt = existingAttempt?.workItemId === workItemId
        && existingAttempt.revision === expectedRevision
        ? existingAttempt
        : {
            workItemId,
            revision: expectedRevision,
            key: globalThis.crypto?.randomUUID?.() ?? `${workItemId}-${expectedRevision}-${Date.now()}`,
          };
      submitAttemptRef.current = attempt;
      const submission = {
        workItemId,
        expectedRevision,
        idempotencyKey: attempt.key,
      };
      const clearAttempt = () => {
        if (submitAttemptRef.current?.key === attempt.key) submitAttemptRef.current = null;
      };
      try {
        await onSubmit(submission);
        clearAttempt();
      } catch (initialError) {
        let finalError: unknown = initialError;
        if (!isDefinitiveSubmitError(initialError) && onReconcileSubmit) {
          try {
            await onReconcileSubmit();
            if (!isCurrentScope(generation, workItemId)) return;
            await onSubmit(submission);
            clearAttempt();
            return;
          } catch (retryError) {
            finalError = retryError;
          }
        }
        if (isDefinitiveSubmitError(finalError)) clearAttempt();
        throw finalError;
      }
    } catch (error) {
      if (isCurrentScope(generation, workItemId)) {
        if (isStaleError(error)) setSaveStatus("conflict");
        setSubmitError(t("app.activeMission.editor.submitError"));
      }
    } finally {
      if (isCurrentScope(generation, workItemId)) setIsSubmitting(false);
    }
  }

  async function upload(entry: UploadEntry, file: File) {
    if (!onUploadFile || !canEdit) return;
    const generation = renderGeneration;
    const workItemId = item.id;
    const attempt = (uploadAttemptsRef.current.get(entry.id) ?? 0) + 1;
    uploadAttemptsRef.current.set(entry.id, attempt);
    setUploads((current) => current.map((candidate) => candidate.id === entry.id ? { ...entry, file, status: "uploading", attempt } : candidate));
    try {
      await onUploadFile(file);
      if (!isCurrentScope(generation, workItemId) || uploadAttemptsRef.current.get(entry.id) !== attempt) return;
      setUploads((current) => current.map((candidate) => candidate.id === entry.id && candidate.attempt === attempt
        ? { ...candidate, file: undefined, status: "uploaded" }
        : candidate));
    } catch {
      if (!isCurrentScope(generation, workItemId) || uploadAttemptsRef.current.get(entry.id) !== attempt) return;
      setUploads((current) => current.map((candidate) => candidate.id === entry.id && candidate.attempt === attempt
        ? { ...candidate, file, status: "failed" }
        : candidate));
    }
  }

  function chooseFiles(files: readonly File[]) {
    setFileError(null);
    if (files.length === 0 || !canEdit) return;
    let occupiedCount = existingAssetCount + uploads.length;
    for (const file of files) {
      if (!acceptedMimeTypes.includes(file.type)) {
        setFileError(t("app.activeMission.editor.invalidType", { name: file.name }));
        continue;
      }
      if (file.size > maxFileSizeBytes) {
        setFileError(t("app.activeMission.editor.fileTooLarge", {
          name: file.name,
          limit: Math.floor(maxFileSizeBytes / (1024 * 1024)) || maxFileSizeBytes,
          unit: maxFileSizeBytes >= 1024 * 1024 ? "MB" : "bytes",
        }));
        continue;
      }
      const id = fileId(file);
      const replacingOccupied = uploads.some((entry) => entry.id === id);
      if (!replacingOccupied && occupiedCount >= MAX_ASSET_COUNT) {
        setFileError(t("app.activeMission.editor.tooManyAssets"));
        continue;
      }
      if (!replacingOccupied) occupiedCount += 1;
      const entry = { id, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, file, status: "uploading" as const, attempt: 0 };
      setUploads((current) => [...current.filter(({ id }) => id !== entry.id), entry]);
      void upload(entry, file);
    }
  }

  const statusMessage = effectiveSaveStatus === "saving" ? t("app.activeMission.editor.status.saving")
    : effectiveSaveStatus === "saved" ? t("app.activeMission.editor.status.saved")
      : effectiveSaveStatus === "conflict" ? t("app.activeMission.editor.status.conflict")
        : effectiveSaveStatus === "error" ? t("app.activeMission.editor.status.error")
          : t("app.activeMission.editor.status.ready");

  return (
    <section aria-labelledby={headingId} className="space-y-5 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{item.platform}</p>
          <h2 id={headingId} className="break-words font-heading text-xl font-bold text-pretty">{item.title}</h2>
          {item.state === "revision_requested" && revisionDeadline ? (
            <p className="mt-1 text-sm text-[var(--color-soft-ink)]">
              <span className="font-semibold text-[var(--color-ink)]">{t("app.activeMission.editor.revisionDeadline")}</span>{" "}
              <time dateTime={revisionDeadline}>{displayTime(revisionDeadline, lang === "zh" ? "zh-HK" : "en-US")}</time>
            </p>
          ) : null}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-[var(--color-soft-ink)]">{statusMessage}</p>
      </div>

      {canEdit && (effectiveSaveStatus === "error" || conflict?.currentDraft) ? (
        <div className="space-y-2 rounded-xl border-2 border-[var(--color-ink)] p-3">
          {conflict?.currentDraft ? <><p className="font-bold">{t("app.activeMission.editor.currentServerDraft")}</p><p className="whitespace-pre-wrap break-words">{conflict.currentDraft.caption}</p></> : null}
          <button type="button" disabled={isRecovering || isSubmitting} onClick={() => void retryRetainedDraft()} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold disabled:opacity-50">
            {t(conflict?.currentDraft ? "app.activeMission.editor.retryRetained" : "app.activeMission.editor.retrySave")}
          </button>
        </div>
      ) : null}

      {assistContext && <MissionAssistLauncher context={assistContext} checklist={requirements.map(r => ({ id: r.id, text: r.label, complete: checklist[r.id] === true }))} />}

      <div className="grid gap-2">
        <label htmlFor={captionId} className="font-heading text-sm font-bold">{t("app.activeMission.editor.caption")}</label>
        <textarea
          id={captionId}
          name="caption"
          rows={6}
          value={caption}
          disabled={!canEdit}
          onChange={(event) => { setCaption(event.target.value); markEdited(); }}
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:bg-[var(--color-paper)]"
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor={urlId} className="font-heading text-sm font-bold">{t("app.activeMission.editor.externalUrl")}</label>
        <input
          id={urlId}
          name="external-draft-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={externalUrl}
          disabled={!canEdit}
          placeholder="https://example.com/draft…"
          onChange={(event) => { setExternalUrl(event.target.value); markEdited(); }}
          className="min-h-11 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:bg-[var(--color-paper)]"
        />
      </div>

      {requirements.length > 0 ? (
        <fieldset disabled={!canEdit} className="space-y-3">
          <legend className="font-heading text-sm font-bold">{t("app.activeMission.editor.checklist")}</legend>
          {requiredChanges.length > 0 ? <h3 className="font-heading text-lg font-bold">{t("app.activeMission.editor.changesRequested")}</h3> : null}
          <ul className="space-y-3">
            {requirements.map((requirement) => {
              const matchingChanges = requiredChanges.filter(({ requirementId }) => requirementId === requirement.id);
              return (
                <li key={requirement.id} className="rounded-xl border border-[var(--color-ink)] p-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 hover:bg-[var(--color-paper)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
                    <input
                      type="checkbox"
                      name={`requirement-${requirement.id}`}
                      checked={checklist[requirement.id] === true}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setChecklist((current) => ({ ...current, [requirement.id]: checked }));
                        markEdited();
                      }}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-ink)]"
                    />
                    <span className="break-words text-sm font-medium">
                    {requirement.label}{requirement.required ? <span className="ml-1 text-[var(--color-magenta)]">{t("app.activeMission.editor.required")}</span> : null}
                    </span>
                  </label>
                  {matchingChanges.length > 0 ? (
                    <ul className="ml-8 mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-magenta)]">
                      {matchingChanges.map((change) => <li key={change.id} className="break-words">{change.text}</li>)}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {requiredChanges.some(({ requirementId }) => !requirementId || !requirements.some(({ id }) => id === requirementId))
            ? <ReviewFeedback requirements={[]} changes={requiredChanges.filter(({ requirementId }) => !requirementId || !requirements.some(({ id }) => id === requirementId))} />
            : null}
        </fieldset>
      ) : null}

      {onUploadFile ? (
        <div className="space-y-3">
          <label
            htmlFor={fileInputId}
            aria-disabled={!canEdit}
            className={`inline-flex min-h-11 touch-manipulation items-center rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-heading text-sm font-bold ${canEdit ? "cursor-pointer hover:bg-[var(--color-paper)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2" : "pointer-events-none cursor-not-allowed opacity-50"}`}
          >
            {t("app.activeMission.editor.uploadFiles")}
          </label>
          <input
            id={fileInputId}
            name="draft-files"
            disabled={!canEdit}
            type="file"
            multiple
            accept={acceptedMimeTypes.join(",")}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              chooseFiles(files);
            }}
            className="sr-only"
          />
          {fileError ? <p role="alert" className="break-words text-sm font-semibold text-[var(--color-magenta)]">{fileError}</p> : null}
          {uploads.length > 0 ? (
            <ul className="space-y-2">
              {uploads.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-ink)] p-3 text-sm">
                  <span className="min-w-0 break-words font-medium">{entry.name}</span>
                {entry.status === "uploading" ? <span aria-live="polite">{t("app.activeMission.editor.uploading")}</span> : null}
                {entry.status === "uploaded" ? <span aria-live="polite">{t("app.activeMission.editor.uploaded")}</span> : null}
                  {entry.status === "failed" ? (
                    <div className="flex flex-wrap items-center gap-2">
                    <span aria-live="polite" className="text-[var(--color-magenta)]">{t("app.activeMission.editor.uploadFailed")}</span>
                      <button
                        type="button"
                      aria-label={t("app.activeMission.editor.retry", { name: entry.name })}
                        disabled={!canEdit || !entry.file}
                        onClick={() => { if (entry.file) void upload(entry, entry.file); }}
                        className="min-h-11 touch-manipulation rounded-full border-2 border-[var(--color-ink)] px-3 py-2 font-bold hover:bg-[var(--color-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("app.activeMission.editor.retryButton")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 border-t-2 border-[var(--color-ink)] pt-4">
        {!allRequiredChecked ? <p className="text-sm text-[var(--color-soft-ink)]">{t("app.activeMission.editor.completeChecklist")}</p> : null}
        <button
          type="button"
          disabled={!canEdit || !allRequiredChecked || isSubmitting || isRecovering || effectiveSaveStatus === "conflict"}
          onClick={() => void submitVersion()}
          className="min-h-11 w-full touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-3 font-heading font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isSubmitting ? t("app.activeMission.editor.submitting") : t("app.activeMission.editor.submitVersion")}
        </button>
        {submitError ? <p ref={submitErrorRef} tabIndex={-1} role="alert" className="text-sm font-semibold text-[var(--color-magenta)]">{submitError}</p> : null}
      </div>
    </section>
  );
}
