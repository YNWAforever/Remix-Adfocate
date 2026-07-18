import { useEffect, useId, useRef, useState } from "react";
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
};

type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";
type UploadStatus = "uploading" | "uploaded" | "failed";
type UploadEntry = { id: string; file: File; status: UploadStatus };

const DEFAULT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4"] as const;
const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

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
}: DraftEditorProps) {
  const captionId = useId();
  const urlId = useId();
  const fileInputId = useId();
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
  const itemIdentityRef = useRef(`${item.id}:${item.draft?.id ?? "new"}`);
  const requirements = normalizeRequirements(item.requirements);
  const requiredRequirements = requirements.filter(({ required }) => required);
  const allRequiredChecked = requiredRequirements.every(({ id }) => checklist[id] === true);
  const canEdit = item.state === "drafting" || item.state === "revision_requested";
  const effectiveSaveStatus = conflict ? "conflict" : saveStatus;

  useEffect(() => {
    const identity = `${item.id}:${item.draft?.id ?? "new"}`;
    if (itemIdentityRef.current === identity) return;
    itemIdentityRef.current = identity;
    setCaption(item.draft?.caption ?? "");
    setExternalUrl(item.draft?.externalUrl ?? "");
    setChecklist(item.draft?.checklist ?? {});
    revisionRef.current = item.draft?.revision ?? 0;
    setSaveStatus("idle");
    setEditSequence(0);
    setUploads([]);
    setFileError(null);
    setSubmitError(null);
  }, [item.draft, item.id]);

  useEffect(() => {
    if (editSequence === 0 || !canEdit) return;
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
      void Promise.resolve(onSave(input))
        .then((result) => {
          revisionRef.current = revisionFrom(result, revisionRef.current);
          setSaveStatus("saved");
        })
        .catch((error: unknown) => setSaveStatus(isStaleError(error) ? "conflict" : "error"));
    }, 800);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [canEdit, caption, checklist, editSequence, externalUrl, item.id, onSave]);

  function markEdited() {
    setSaveStatus("saving");
    setEditSequence((current) => current + 1);
  }

  async function submitVersion() {
    if (!canEdit || !allRequiredChecked || isSubmitting) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const saved = await onSave({
        workItemId: item.id,
        revision: revisionRef.current,
        caption,
        externalUrl: externalUrl.trim() || null,
        checklist,
      });
      revisionRef.current = revisionFrom(saved, revisionRef.current);
      setSaveStatus("saved");
      await onSubmit({
        workItemId: item.id,
        expectedRevision: revisionRef.current,
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${item.id}-${revisionRef.current}-${Date.now()}`,
      });
    } catch (error) {
      if (isStaleError(error)) setSaveStatus("conflict");
      setSubmitError("Couldn’t submit this version. Your draft is still here. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function upload(entry: UploadEntry) {
    if (!onUploadFile) return;
    setUploads((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "uploading" } : candidate));
    try {
      await onUploadFile(entry.file);
      setUploads((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "uploaded" } : candidate));
    } catch {
      setUploads((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "failed" } : candidate));
    }
  }

  function chooseFiles(files: FileList | null) {
    setFileError(null);
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!acceptedMimeTypes.includes(file.type)) {
        setFileError(`${file.name} must be an accepted file type.`);
        continue;
      }
      if (file.size > maxFileSizeBytes) {
        setFileError(`${file.name} must be ${Math.floor(maxFileSizeBytes / (1024 * 1024)) || maxFileSizeBytes} ${maxFileSizeBytes >= 1024 * 1024 ? "MB" : "bytes"} or smaller.`);
        continue;
      }
      const entry = { id: fileId(file), file, status: "uploading" as const };
      setUploads((current) => [...current.filter(({ id }) => id !== entry.id), entry]);
      void upload(entry);
    }
  }

  const statusMessage = effectiveSaveStatus === "saving" ? "Saving…"
    : effectiveSaveStatus === "saved" ? "Saved"
      : effectiveSaveStatus === "conflict" ? "Save conflict. Your local changes are still here; compare them with the server draft."
        : effectiveSaveStatus === "error" ? "Couldn’t save. Your changes are still here. Try again."
          : "Draft ready";

  return (
    <section aria-labelledby={`draft-heading-${item.id}`} className="space-y-5 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-soft-ink)]">{item.platform}</p>
          <h2 id={`draft-heading-${item.id}`} className="break-words font-heading text-xl font-bold text-pretty">{item.title}</h2>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-[var(--color-soft-ink)]">{statusMessage}</p>
      </div>

      {requiredChanges.length > 0 ? <ReviewFeedback requirements={item.requirements} changes={requiredChanges} /> : null}

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
          {requirements.map((requirement) => (
            <label key={requirement.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-ink)] p-3 hover:bg-[var(--color-paper)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
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
          ))}
        </fieldset>
      ) : null}

      {onUploadFile ? (
        <div className="space-y-3">
          <label htmlFor={fileInputId} className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-heading text-sm font-bold hover:bg-[var(--color-paper)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
            Upload draft files
          </label>
          <input
            id={fileInputId}
            name="draft-files"
            disabled={!canEdit}
            type="file"
            multiple
            accept={acceptedMimeTypes.join(",")}
            onChange={(event) => chooseFiles(event.currentTarget.files)}
            className="sr-only"
          />
          {fileError ? <p role="alert" className="break-words text-sm font-semibold text-[var(--color-magenta)]">{fileError}</p> : null}
          {uploads.length > 0 ? (
            <ul className="space-y-2">
              {uploads.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-ink)] p-3 text-sm">
                  <span className="min-w-0 break-words font-medium">{entry.file.name}</span>
                  {entry.status === "uploading" ? <span aria-live="polite">Uploading…</span> : null}
                  {entry.status === "uploaded" ? <span aria-live="polite">Uploaded</span> : null}
                  {entry.status === "failed" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-live="polite" className="text-[var(--color-magenta)]">Upload failed. Your file is still selected.</span>
                      <button
                        type="button"
                        aria-label={`Retry ${entry.file.name}`}
                        onClick={() => void upload(entry)}
                        className="min-h-11 touch-manipulation rounded-full border-2 border-[var(--color-ink)] px-3 py-2 font-bold hover:bg-[var(--color-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
