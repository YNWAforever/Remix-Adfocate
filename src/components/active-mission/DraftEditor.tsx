import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MissionDraft, MissionWorkItemView } from "@/lib/activeMission";
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

type DraftSaveResult = void | MissionDraft | { draft: MissionDraft };

type DraftEditorProps = {
  item: MissionWorkItemView;
  requiredChanges?: readonly RequiredChangeView[];
  conflict?: MissionDraftConflict | null;
  onSave: (input: SaveMissionDraftInput) => Promise<DraftSaveResult> | DraftSaveResult;
  onSubmit: (input: SubmitMissionWorkItemInput) => Promise<unknown> | unknown;
  onUploadFile?: (file: File) => Promise<unknown> | unknown;
  acceptedMimeTypes?: readonly string[];
  maxFileSizeBytes?: number;
  existingAssetCount?: number;
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

const DEFAULT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"] as const;
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_COUNT = 5;

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME.format(parsed);
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

function fileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function DraftEditor({
  item,
  requiredChanges = [],
  conflict = null,
  onSave,
  onSubmit,
  onUploadFile,
  acceptedMimeTypes = DEFAULT_MIME_TYPES,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
  existingAssetCount = 0,
}: DraftEditorProps) {
  const captionId = useId();
  const urlId = useId();
  const fileInputId = useId();
  const headingId = useId();
  const [caption, setCaption] = useState(item.draft?.caption ?? "");
  const [externalUrl, setExternalUrl] = useState(item.draft?.externalUrl ?? "");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(item.draft?.checklist ?? {});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editSequence, setEditSequence] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const revisionRef = useRef(item.draft?.revision ?? 0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeRef = useRef({ itemId: item.id, generation: 0 });
  const saveQueueRef = useRef<{ generation: number; promise: Promise<unknown> }>({ generation: 0, promise: Promise.resolve() });
  const activeSaveRef = useRef<{ generation: number; promise: Promise<DraftSaveResult> } | null>(null);
  const uploadAttemptsRef = useRef(new Map<string, number>());
  if (scopeRef.current.itemId !== item.id) {
    scopeRef.current = { itemId: item.id, generation: scopeRef.current.generation + 1 };
    saveQueueRef.current = { generation: scopeRef.current.generation, promise: Promise.resolve() };
    activeSaveRef.current = null;
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
  }, [item.draft, item.id, stateItemId]);

  const isCurrentScope = useCallback((generation: number, workItemId: string): boolean => {
    return scopeRef.current.generation === generation && scopeRef.current.itemId === workItemId;
  }, []);

  const queueSave = useCallback((input: SaveMissionDraftInput, generation: number): Promise<DraftSaveResult> => {
    const previous = saveQueueRef.current.generation === generation ? saveQueueRef.current.promise : Promise.resolve();
    const promise = previous.catch(() => undefined).then(async () => {
      const result = await onSave(input);
      if (isCurrentScope(generation, input.workItemId)) revisionRef.current = revisionFrom(result, revisionRef.current);
      return result;
    });
    saveQueueRef.current = { generation, promise };
    activeSaveRef.current = { generation, promise };
    return promise;
  }, [isCurrentScope, onSave]);

  useEffect(() => {
    if (editSequence === 0 || !canEdit || stateItemId !== item.id) return;
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
  }, [canEdit, caption, checklist, editSequence, externalUrl, isCurrentScope, item.id, queueSave, renderGeneration, stateItemId]);

  function markEdited() {
    setSaveStatus("saving");
    setEditSequence((current) => current + 1);
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
      await onSubmit({
        workItemId,
        expectedRevision: revisionRef.current,
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${workItemId}-${revisionRef.current}-${Date.now()}`,
      });
    } catch (error) {
      if (isCurrentScope(generation, workItemId)) {
        if (isStaleError(error)) setSaveStatus("conflict");
        setSubmitError("Couldn’t submit this version. Your draft is still here. Try again.");
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
    let occupiedCount = existingAssetCount + uploads.filter(({ status }) => status === "uploading" || status === "uploaded").length;
    for (const file of files) {
      if (!acceptedMimeTypes.includes(file.type)) {
        setFileError(`${file.name} must be an accepted file type.`);
        continue;
      }
      if (file.size > maxFileSizeBytes) {
        setFileError(`${file.name} must be ${Math.floor(maxFileSizeBytes / (1024 * 1024)) || maxFileSizeBytes} ${maxFileSizeBytes >= 1024 * 1024 ? "MB" : "bytes"} or smaller.`);
        continue;
      }
      const id = fileId(file);
      const replacingOccupied = uploads.some((entry) => entry.id === id && (entry.status === "uploading" || entry.status === "uploaded"));
      if (!replacingOccupied && occupiedCount >= MAX_ASSET_COUNT) {
        setFileError("A draft can contain at most five assets.");
        continue;
      }
      if (!replacingOccupied) occupiedCount += 1;
      const entry = { id, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, file, status: "uploading" as const, attempt: 0 };
      setUploads((current) => [...current.filter(({ id }) => id !== entry.id), entry]);
      void upload(entry, file);
    }
  }

  const statusMessage = effectiveSaveStatus === "saving" ? "Saving…"
    : effectiveSaveStatus === "saved" ? "Saved"
      : effectiveSaveStatus === "conflict" ? "Save conflict. Your local changes are still here; compare them with the server draft."
        : effectiveSaveStatus === "error" ? "Couldn’t save. Your changes are still here. Try again."
          : "Draft ready";

  return (
    <section aria-labelledby={headingId} className="space-y-5 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{item.platform}</p>
          <h2 id={headingId} className="break-words font-heading text-xl font-bold text-pretty">{item.title}</h2>
          {item.state === "revision_requested" && item.deadline ? (
            <p className="mt-1 text-sm text-[var(--color-soft-ink)]">
              <span className="font-semibold text-[var(--color-ink)]">Revision deadline</span>{" "}
              <time dateTime={item.deadline}>{displayTime(item.deadline)}</time>
            </p>
          ) : null}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-[var(--color-soft-ink)]">{statusMessage}</p>
      </div>

      <div className="grid gap-2">
        <label htmlFor={captionId} className="font-heading text-sm font-bold">Caption or copy</label>
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
        <label htmlFor={urlId} className="font-heading text-sm font-bold">External draft URL</label>
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
          <legend className="font-heading text-sm font-bold">Requirement checklist</legend>
          {requiredChanges.length > 0 ? <h3 className="font-heading text-lg font-bold">Changes requested</h3> : null}
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
                      {requirement.label}{requirement.required ? <span className="ml-1 text-[var(--color-magenta)]">(required)</span> : null}
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
            Upload draft files
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
                  {entry.status === "uploading" ? <span aria-live="polite">Uploading…</span> : null}
                  {entry.status === "uploaded" ? <span aria-live="polite">Uploaded</span> : null}
                  {entry.status === "failed" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-live="polite" className="text-[var(--color-magenta)]">Upload failed. Your file is still selected.</span>
                      <button
                        type="button"
                        aria-label={`Retry ${entry.name}`}
                        disabled={!canEdit || !entry.file}
                        onClick={() => { if (entry.file) void upload(entry, entry.file); }}
                        className="min-h-11 touch-manipulation rounded-full border-2 border-[var(--color-ink)] px-3 py-2 font-bold hover:bg-[var(--color-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Retry
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
        {!allRequiredChecked ? <p className="text-sm text-[var(--color-soft-ink)]">Complete every required checklist item before submitting.</p> : null}
        <button
          type="button"
          disabled={!canEdit || !allRequiredChecked || isSubmitting}
          onClick={() => void submitVersion()}
          className="min-h-11 w-full touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-3 font-heading font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isSubmitting ? "Submitting…" : "Submit version"}
        </button>
        {submitError ? <p role="alert" className="text-sm font-semibold text-[var(--color-magenta)]">{submitError}</p> : null}
      </div>
    </section>
  );
}
