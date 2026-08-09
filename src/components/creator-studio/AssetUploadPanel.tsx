import { useEffect, useRef, useState } from "react";
import { type UploadGrant, type WorkItem, uploadDraftAsset, useCreateDraftAssetGrant, useFinalizeDraftAsset } from "@/lib/queries/creatorStudio";

type UploadFailurePhase = "grant" | "upload" | "finalize";
type UploadAttempt = { file: File; identity: string; grant?: UploadGrant };
type UploadPhase = "idle" | "grant" | "upload" | "ready-to-finalize" | "finalize" | "finalized" | "error";

const commandId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const fileIdentity = (file: File) => `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
const acceptedMimeTypes = "image/jpeg,image/png,image/webp,video/mp4,application/pdf";

export function AssetUploadPanel({ submissionId, workItem }: { submissionId: string; workItem: WorkItem }) {
  const createGrant = useCreateDraftAssetGrant(submissionId, workItem.id);
  const [attempt, setAttempt] = useState<UploadAttempt | null>(null);
  const finalizeAsset = useFinalizeDraftAsset(submissionId, workItem.id, attempt?.grant?.assetId ?? "pending-asset");
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [failure, setFailure] = useState<UploadFailurePhase | null>(null);
  const commandIds = useRef<{ grant?: string; finalize?: string }>({});

  useEffect(() => {
    setAttempt(null);
    setPhase("idle");
    setFailure(null);
    commandIds.current = {};
  }, [submissionId, workItem.id]);

  useEffect(() => {
    if (phase !== "ready-to-finalize" || !attempt?.grant) return;
    let cancelled = false;
    const finalize = async () => {
      setPhase("finalize");
      try {
        const id = commandIds.current.finalize ?? commandId("creator-asset-finalize");
        commandIds.current.finalize = id;
        await finalizeAsset.mutateAsync({ commandId: id, byteSize: attempt.file.size, mimeType: attempt.file.type, checksumSha256: null });
        if (!cancelled) {
          setPhase("finalized");
          setFailure(null);
          commandIds.current = {};
        }
      } catch {
        if (!cancelled) {
          setPhase("error");
          setFailure("finalize");
        }
      }
    };
    void finalize();
    return () => { cancelled = true; };
  }, [attempt, finalizeAsset, phase]);

  if (!workItem.requiresAsset) return null;

  const upload = async (grant: UploadGrant, file: File) => {
    setPhase("upload");
    try {
      await uploadDraftAsset(grant, file);
      setPhase("ready-to-finalize");
    } catch {
      setPhase("error");
      setFailure("upload");
    }
  };

  const requestGrant = async (file: File) => {
    const identity = fileIdentity(file);
    setAttempt({ file, identity });
    setPhase("grant");
    setFailure(null);
    try {
      const id = commandIds.current.grant ?? commandId("creator-asset-grant");
      commandIds.current.grant = id;
      const grant = await createGrant.mutateAsync({ commandId: id, fileName: file.name, mimeType: file.type, byteSize: file.size });
      setAttempt({ file, identity, grant });
      await upload(grant, file);
    } catch {
      setPhase("error");
      setFailure("grant");
    }
  };

  const retry = async () => {
    if (!attempt) return;
    if (failure === "finalize" && attempt.grant) setPhase("ready-to-finalize");
    else if (attempt.grant) await upload(attempt.grant, attempt.file);
    else await requestGrant(attempt.file);
  };

  const pending = phase === "grant" || phase === "upload" || phase === "ready-to-finalize" || phase === "finalize" || createGrant.isPending || finalizeAsset.isPending;
  return (
    <section aria-labelledby={`proof-asset-${workItem.id}`} className="space-y-3 rounded-[var(--radius)] border border-[var(--color-ink)] p-3">
      <h3 id={`proof-asset-${workItem.id}`} className="font-heading font-bold">Proof asset</h3>
      <label className="block text-sm font-medium">Proof asset<input id={`creator-proof-asset-${workItem.id}`} aria-label="Proof asset" type="file" accept={acceptedMimeTypes} disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (attempt && attempt.identity !== fileIdentity(file)) commandIds.current = {}; void requestGrant(file); }} className="mt-1 block w-full text-sm" /></label>
      <ul className="text-sm" aria-label="Asset status">
        {workItem.assets.map((asset) => <li key={asset.id}>{asset.fileName}: {asset.state}</li>)}
        {phase === "grant" ? <li>Requesting upload authorization…</li> : null}
        {phase === "upload" ? <li>Uploading proof asset…</li> : null}
        {phase === "ready-to-finalize" || phase === "finalize" ? <li>Finalizing proof asset…</li> : null}
        {phase === "finalized" ? <li>Proof asset finalized.</li> : null}
      </ul>
      {phase === "error" ? <div role="alert" className="space-y-2 text-sm text-[var(--color-magenta)]"><p>Upload failed. Retry without losing your draft.</p><button type="button" onClick={() => void retry()} className="underline">Retry upload</button></div> : null}
    </section>
  );
}
