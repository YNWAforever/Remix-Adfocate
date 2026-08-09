import { useEffect, useRef, useState } from "react";
import {
  type PublicationProofAttempt,
  type UploadGrant,
  type WorkItem,
  uploadPublicationProofEvidence,
  useCancelProofEvidence,
  useCreateProofEvidenceGrant,
  useCreatePublicationProofAttempt,
  useFinalizeProofEvidence,
  useRefreshProofMetadata,
  useSubmitPublicationProof,
} from "@/lib/queries/creatorStudio";

const commandId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const fileIdentity = (file: File) => `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
const acceptedMimeTypes = "image/jpeg,image/png,image/webp,application/pdf";
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : undefined;

type UploadPhase = "idle" | "grant" | "upload" | "ready-to-finalize" | "finalize" | "finalized" | "error";
type ProofUploadAttempt = { file: File; identity: string; grant?: UploadGrant };

function attemptStateMessage(attempt: PublicationProofAttempt | null) {
  if (!attempt) return "Start a proof attempt with the public URL for this deliverable.";
  if (attempt.state === "changes_requested") return attempt.operatorMessage ?? "The review team requested a correction.";
  if (attempt.state === "submitted") return "Proof submitted for review.";
  if (attempt.state === "verified") return "Proof verified by the review team.";
  return "Draft proof is editable until you submit it.";
}

export function PublicationProofPanel({ submissionId, workItem }: { submissionId: string; workItem: WorkItem }) {
  const requirement = workItem.proofRequirement;
  const currentAttempt = workItem.publicationProof.currentAttempt;
  const [publishedUrl, setPublishedUrl] = useState(currentAttempt?.publishedUrl ?? "");
  const [platform, setPlatform] = useState(currentAttempt?.platform ?? requirement?.allowedPlatforms[0] ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploadAttempt, setUploadAttempt] = useState<ProofUploadAttempt | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
  const [cancellationFailure, setCancellationFailure] = useState<string | null>(null);
  const commandIds = useRef<{ save?: string; grant?: string; finalize?: string; submit?: string; refresh?: string; cancel?: string }>({});
  const proofKeyRef = useRef<string | null>(null);

  const createAttempt = useCreatePublicationProofAttempt(submissionId, workItem.id);
  const attemptId = currentAttempt?.id ?? "pending-attempt";
  const createGrant = useCreateProofEvidenceGrant(submissionId, workItem.id, attemptId);
  const evidenceId = uploadAttempt?.grant?.assetId ?? "pending-evidence";
  const finalizeEvidence = useFinalizeProofEvidence(submissionId, workItem.id, attemptId, evidenceId);
  const pendingEvidence = currentAttempt?.evidence.find((evidence) => evidence.status === "pending") ?? null;
  const reservedEvidenceId = pendingEvidence?.id ?? uploadAttempt?.grant?.assetId ?? null;
  const evidenceStateKey = currentAttempt?.evidence.map((evidence) => `${evidence.id}:${evidence.status}`).join("|") ?? "none";
  const cancelEvidence = useCancelProofEvidence(submissionId, workItem.id, attemptId, reservedEvidenceId ?? "pending-evidence");
  const submitProof = useSubmitPublicationProof(submissionId, workItem.id, attemptId);
  const refreshMetadata = useRefreshProofMetadata(submissionId, workItem.id, attemptId);

  useEffect(() => {
    if (!requirement) return;
    const proofKey = `${submissionId}:${workItem.id}:${currentAttempt?.id ?? "none"}`;
    if (proofKeyRef.current === proofKey) return;
    proofKeyRef.current = proofKey;
    setPublishedUrl(currentAttempt?.publishedUrl ?? "");
    setPlatform(currentAttempt?.platform ?? requirement.allowedPlatforms[0] ?? "");
    setSaveStatus("idle");
    setUploadAttempt(null);
    setUploadPhase("idle");
    setUploadFailure(null);
    setCancellationFailure(null);
    commandIds.current = {};
  }, [currentAttempt?.id, currentAttempt?.platform, currentAttempt?.publishedUrl, requirement, submissionId, workItem.id]);

  useEffect(() => {
    setCancellationFailure(null);
  }, [currentAttempt?.id, currentAttempt?.metadataState, currentAttempt?.state, evidenceStateKey]);

  useEffect(() => {
    if (uploadPhase !== "ready-to-finalize" || !uploadAttempt?.grant) return;
    let cancelled = false;
    const finalize = async () => {
      setUploadPhase("finalize");
      try {
        const id = commandIds.current.finalize ?? commandId("creator-proof-evidence-finalize");
        commandIds.current.finalize = id;
        await finalizeEvidence.mutateAsync({
          commandId: id,
          byteSize: uploadAttempt.file.size,
          mimeType: uploadAttempt.file.type,
          checksumSha256: null,
        });
        if (!cancelled) {
          setUploadPhase("finalized");
          setUploadFailure(null);
          commandIds.current = {};
        }
      } catch (error) {
        if (!cancelled) {
          setUploadPhase("error");
          setUploadFailure(errorCode(error) ?? "proof_evidence_invalid");
        }
      }
    };
    void finalize();
    return () => { cancelled = true; };
  }, [finalizeEvidence, uploadAttempt, uploadPhase]);

  if (!requirement) return null;

  const canEdit = !currentAttempt || currentAttempt.state === "draft" || currentAttempt.state === "changes_requested";
  const canSubmit = currentAttempt?.state === "draft"
    && !currentAttempt.evidence.some((evidence) => evidence.status === "pending")
    && uploadPhase !== "grant" && uploadPhase !== "upload" && uploadPhase !== "ready-to-finalize" && uploadPhase !== "finalize";
  const proofPending = createAttempt.isPending || submitProof.isPending || refreshMetadata.isPending;
  const saveLabel = currentAttempt?.state === "changes_requested"
    ? "Start correction"
    : currentAttempt?.state === "draft" ? "Save proof details" : "Create proof attempt";

  const saveProof = async () => {
    if (!publishedUrl.trim() || !platform.trim()) return;
    setSaveStatus("saving");
    try {
      const id = commandIds.current.save ?? commandId("creator-proof-attempt");
      commandIds.current.save = id;
      await createAttempt.mutateAsync({ commandId: id, publishedUrl, platform });
      setSaveStatus("saved");
      commandIds.current.save = undefined;
    } catch {
      setSaveStatus("error");
    }
  };

  const requestEvidenceGrant = async (file: File) => {
    if (!currentAttempt || currentAttempt.state !== "draft") return;
    const identity = fileIdentity(file);
    setUploadAttempt({ file, identity });
    setUploadPhase("grant");
    setUploadFailure(null);
    try {
      const id = commandIds.current.grant ?? commandId("creator-proof-evidence-grant");
      commandIds.current.grant = id;
      const grant = await createGrant.mutateAsync({ commandId: id, fileName: file.name, mimeType: file.type, byteSize: file.size });
      setUploadAttempt({ file, identity, grant });
      setUploadPhase("upload");
      await uploadPublicationProofEvidence(grant, file);
      setUploadPhase("ready-to-finalize");
    } catch (error) {
      setUploadPhase("error");
      setUploadFailure(errorCode(error) ?? "proof_evidence_invalid");
    }
  };

  const retryEvidence = async () => {
    if (!uploadAttempt) return;
    if (uploadFailure === "storage_error" && uploadAttempt.grant) {
      setUploadPhase("upload");
      try {
        await uploadPublicationProofEvidence(uploadAttempt.grant, uploadAttempt.file);
        setUploadPhase("ready-to-finalize");
        setUploadFailure(null);
      } catch (error) {
        setUploadPhase("error");
        setUploadFailure(errorCode(error) ?? "storage_error");
      }
    } else {
      await requestEvidenceGrant(uploadAttempt.file);
    }
  };

  const submit = async () => {
    if (!currentAttempt || !canSubmit) return;
    try {
      const id = commandIds.current.submit ?? commandId("creator-proof-submit");
      commandIds.current.submit = id;
      await submitProof.mutateAsync({ commandId: id });
      commandIds.current.submit = undefined;
    } catch {
      setSaveStatus("error");
    }
  };

  const refresh = async () => {
    if (!currentAttempt || currentAttempt.state !== "draft") return;
    try {
      const id = commandIds.current.refresh ?? commandId("creator-proof-metadata");
      commandIds.current.refresh = id;
      await refreshMetadata.mutateAsync({ commandId: id });
      commandIds.current.refresh = undefined;
    } catch {
      setSaveStatus("error");
    }
  };

  const discardEvidence = async () => {
    if (!reservedEvidenceId || uploadPending || cancelEvidence.isPending) return;
    setCancellationFailure(null);
    try {
      const id = commandIds.current.cancel ?? commandId("creator-proof-evidence-cancel");
      commandIds.current.cancel = id;
      await cancelEvidence.mutateAsync({ commandId: id });
      setUploadAttempt(null);
      setUploadPhase("idle");
      setUploadFailure(null);
      setCancellationFailure(null);
      commandIds.current.grant = undefined;
      commandIds.current.finalize = undefined;
      commandIds.current.cancel = undefined;
    } catch (error) {
      setCancellationFailure(errorCode(error) ?? "proof_evidence_invalid");
    }
  };

  const uploadPending = uploadPhase === "grant" || uploadPhase === "upload" || uploadPhase === "ready-to-finalize" || uploadPhase === "finalize" || createGrant.isPending || finalizeEvidence.isPending || cancelEvidence.isPending;
  return (
    <section aria-labelledby={`publication-proof-${workItem.id}`} tabIndex={-1} className="pastel-card space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-ink)]">
      <div>
        <h2 id={`publication-proof-${workItem.id}`} className="font-heading text-lg font-bold">Publication proof</h2>
        <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{attemptStateMessage(currentAttempt)}</p>
      </div>

      {canEdit ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Published URL
            <input aria-label="Published URL" type="url" value={publishedUrl} onChange={(event) => { setPublishedUrl(event.target.value); setSaveStatus("idle"); }} className="mt-1 w-full rounded-lg border border-[var(--color-ink)] p-2" placeholder="https://example.com/published-post" />
          </label>
          <label className="block text-sm font-medium">Platform
            <select aria-label="Publication platform" value={platform} onChange={(event) => { setPlatform(event.target.value); setSaveStatus("idle"); }} className="mt-1 w-full rounded-lg border border-[var(--color-ink)] bg-white p-2">
              {requirement.allowedPlatforms.map((allowedPlatform) => <option key={allowedPlatform} value={allowedPlatform}>{allowedPlatform}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void saveProof()} disabled={proofPending || !publishedUrl.trim() || !platform.trim()} className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow,#FFE66D)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">{saveLabel}</button>
          {saveStatus === "saved" ? <p className="text-sm text-[var(--color-soft-ink)]" role="status">Proof details saved.</p> : null}
          {saveStatus === "error" ? <p className="text-sm text-[var(--color-magenta)]" role="alert">Proof command could not be completed. Retry or reload the workspace.</p> : null}
        </div>
      ) : null}

      {currentAttempt ? (
        <div className="space-y-3 rounded-lg border border-[var(--color-ink)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Attempt {currentAttempt.sequence}: {currentAttempt.state}</span>
            <span>Metadata: {currentAttempt.metadataState}</span>
          </div>
          {currentAttempt.metadataState !== "available" && currentAttempt.state === "draft" ? <button type="button" onClick={() => void refresh()} disabled={refreshMetadata.isPending} className="text-sm font-semibold underline disabled:opacity-60">Refresh metadata</button> : null}
          {currentAttempt.metadataState === "available" ? <p className="text-sm">Metadata is available, but manual review is still required.</p> : null}
          {currentAttempt.metadataState === "unavailable" ? <p className="text-sm">Metadata is unavailable; manual review is required.</p> : null}
          {currentAttempt.metadataState === "failed" ? <p className="text-sm">Metadata refresh failed; manual review is required.</p> : null}
          {currentAttempt.operatorMessage ? <p className="text-sm text-[var(--color-magenta)]">{currentAttempt.operatorMessage}</p> : null}
        </div>
      ) : null}

      {currentAttempt?.state === "draft" ? (
        <div className="space-y-3 rounded-lg border border-[var(--color-ink)] p-3">
          <h3 className="font-heading font-bold">Optional evidence</h3>
          <label className="block text-sm font-medium">Evidence file
            <input aria-label="Publication proof evidence" type="file" accept={acceptedMimeTypes} disabled={uploadPending || Boolean(pendingEvidence)} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (uploadAttempt && uploadAttempt.identity !== fileIdentity(file)) commandIds.current = {}; void requestEvidenceGrant(file); }} className="mt-1 block w-full text-sm" />
          </label>
          <ul aria-label="Publication proof evidence status" className="space-y-1 text-sm">
            {uploadPhase === "grant" ? <li>Requesting evidence authorization</li> : null}
            {uploadPhase === "upload" ? <li>Uploading evidence</li> : null}
            {uploadPhase === "ready-to-finalize" || uploadPhase === "finalize" ? <li>Finalizing evidence</li> : null}
            {currentAttempt.evidence.map((evidence) => <li key={evidence.id}>{evidence.id}: {evidence.status}</li>)}
            {uploadPhase === "finalized" ? <li>Evidence finalized.</li> : null}
          </ul>
          {uploadPhase === "error" ? <div role="alert" className="space-y-2 text-sm text-[var(--color-magenta)]"><p>Evidence upload failed. Retry without losing the proof attempt.</p><button type="button" onClick={() => void retryEvidence()} className="underline">Retry evidence upload</button></div> : null}
          {cancellationFailure ? <p role="alert" className="text-sm text-[var(--color-magenta)]">Pending evidence could not be discarded. Retry the discard action or reload the workspace.</p> : null}
          {reservedEvidenceId ? <div className="space-y-2 text-sm"><p>Evidence is reserved but not finalized. Discard it to try another file or submit the proof without evidence.</p><button type="button" onClick={() => void discardEvidence()} disabled={uploadPending || cancelEvidence.isPending} className="underline disabled:opacity-60">Discard pending evidence</button></div> : null}
          <button type="button" onClick={() => void submit()} disabled={!canSubmit || submitProof.isPending} className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow,#FFE66D)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">Submit publication proof</button>
        </div>
      ) : null}
    </section>
  );
}
