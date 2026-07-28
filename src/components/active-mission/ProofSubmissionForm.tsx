import { useEffect, useId, useRef, useState } from "react";
import { publicationEvidenceRequired, type MissionPublicationView } from "@/lib/activeMission";

const MAX_ADDITIONAL_URLS = 4;
const MAX_EVIDENCE_SIZE_BYTES = 20 * 1024 * 1024;
const EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export type ProofEvidenceAsset = Readonly<{
  id: string;
  name: string;
  status: "uploading" | "uploaded" | "failed";
  error?: string;
}>;

type ProofFormValue = {
  primaryUrl: string;
  additionalUrls: string[];
  evidenceAssetIds: string[];
};

type Props = {
  publication: MissionPublicationView;
  evidenceAssets?: readonly ProofEvidenceAsset[];
  isSubmitting?: boolean;
  onUploadFile?: (file: File) => Promise<void>;
  onStart?: () => void;
  onSubmit: (value: ProofFormValue) => Promise<unknown>;
};

function validPublicUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function ProofSubmissionForm({
  publication,
  evidenceAssets = [],
  isSubmitting = false,
  onUploadFile,
  onStart,
  onSubmit,
}: Props) {
  const headingId = useId();
  const additionalRefs = useRef<Array<HTMLInputElement | null>>([]);
  const evidenceGroupRef = useRef<HTMLFieldSetElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const scopeRef = useRef(publication.workItemId);
  const startedRef = useRef(false);
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [additionalUrls, setAdditionalUrls] = useState<string[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (scopeRef.current === publication.workItemId) return;
    scopeRef.current = publication.workItemId;
    startedRef.current = false;
    setPrimaryUrl("");
    setAdditionalUrls([]);
    setSelectedEvidence([]);
    setConfirmed(false);
    setError(null);
    setFileError(null);
    setSuccess(false);
    setSubmitting(false);
  }, [publication.workItemId]);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  function startInteraction() {
    if (startedRef.current) return;
    startedRef.current = true;
    onStart?.();
  }

  const busy = isSubmitting || submitting;
  const needsEvidence = publicationEvidenceRequired(publication.instructions.proofEvidencePolicy);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    const normalizedPrimary = primaryUrl.trim();
    const normalizedAdditional = additionalUrls.map((url) => url.trim()).filter(Boolean);
    if (!validPublicUrl(normalizedPrimary)) {
      setError(normalizedPrimary ? "Enter a valid HTTPS public URL." : "Enter the public URL for your published content.");
      primaryRef.current?.focus();
      return;
    }
    const invalidAdditional = normalizedAdditional.findIndex((url) => !validPublicUrl(url));
    if (invalidAdditional >= 0) {
      setError(`Additional public URL ${invalidAdditional + 1} must be a valid HTTPS URL.`);
      additionalRefs.current[invalidAdditional]?.focus();
      return;
    }
    if (needsEvidence && selectedEvidence.length === 0) {
      setError("Select at least one evidence file.");
      evidenceGroupRef.current?.focus();
      return;
    }
    if (!confirmed) {
      setError("Confirm that this is the published content before submitting.");
      confirmationRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        primaryUrl: normalizedPrimary,
        additionalUrls: normalizedAdditional,
        evidenceAssetIds: selectedEvidence,
      });
      setSuccess(true);
    } catch {
      setError("Couldn’t submit proof. Your entries are still here.");
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseFiles(files: readonly File[]) {
    setFileError(null);
    for (const file of files) {
      if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
        setFileError(`${file.name} must be an accepted image or video.`);
        continue;
      }
      if (file.size > MAX_EVIDENCE_SIZE_BYTES) {
        setFileError(`${file.name} must be 20 MB or smaller.`);
        continue;
      }
      try {
        await onUploadFile?.(file);
      } catch {
        setFileError(`Couldn’t upload ${file.name}. Try again.`);
      }
    }
  }

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 id={headingId} className="font-heading text-xl font-bold">Submit publication proof</h2>
      <p className="mt-2 text-sm text-[var(--color-soft-ink)]">Add the public link for the exact approved version you published.</p>

      <form className="mt-5 space-y-5" noValidate onFocusCapture={startInteraction} onChangeCapture={startInteraction} onSubmit={submit}>
        <div>
          <label htmlFor={`${headingId}-primary`} className="font-heading text-sm font-bold">Primary public URL</label>
          <input
            ref={primaryRef}
            id={`${headingId}-primary`}
            type="url"
            inputMode="url"
            autoComplete="url"
            required
            value={primaryUrl}
            onChange={(event) => setPrimaryUrl(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border-2 border-[var(--color-ink)] px-3 py-2"
          />
        </div>

        <div className="space-y-3">
          {additionalUrls.map((value, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label htmlFor={`${headingId}-additional-${index}`} className="font-heading text-sm font-bold">
                  Additional public URL {index + 1}
                </label>
                <input
                  ref={(node) => { additionalRefs.current[index] = node; }}
                  id={`${headingId}-additional-${index}`}
                  type="url"
                  inputMode="url"
                  value={value}
                  onChange={(event) => setAdditionalUrls((current) =>
                    current.map((url, candidate) => candidate === index ? event.target.value : url))}
                  className="mt-2 min-h-11 w-full rounded-xl border-2 border-[var(--color-ink)] px-3 py-2"
                />
              </div>
              <button
                type="button"
                aria-label={`Remove additional URL ${index + 1}`}
                onClick={() => setAdditionalUrls((current) => current.filter((_, candidate) => candidate !== index))}
                className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold"
              >
                Remove
              </button>
            </div>
          ))}
          {additionalUrls.length < MAX_ADDITIONAL_URLS ? (
            <button
              type="button"
              onClick={() => setAdditionalUrls((current) => [...current, ""])}
              className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold"
            >
              Add another URL
            </button>
          ) : null}
        </div>

        <fieldset ref={evidenceGroupRef} tabIndex={-1} className="rounded-2xl border border-[var(--color-ink)] p-4">
          <legend className="px-1 font-heading text-sm font-bold">
            Private evidence · {needsEvidence ? "required" : "optional"}
          </legend>
          {onUploadFile ? (
            <>
              <label htmlFor={`${headingId}-evidence`} className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold">
                Add evidence files
              </label>
              <input
                id={`${headingId}-evidence`}
                type="file"
                multiple
                accept={EVIDENCE_MIME_TYPES.join(",")}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void chooseFiles(files);
                }}
                className="sr-only"
              />
            </>
          ) : null}
          {evidenceAssets.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {evidenceAssets.map((asset) => (
                <li key={asset.id} className="flex min-w-0 items-start gap-3 text-sm">
                  <input
                    id={`${headingId}-asset-${asset.id}`}
                    type="checkbox"
                    checked={selectedEvidence.includes(asset.id)}
                    aria-label={`Use ${asset.name} as evidence`}
                    disabled={asset.status !== "uploaded"}
                    onChange={(event) => setSelectedEvidence((current) =>
                      event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))}
                    className="mt-1 size-4"
                  />
                  <label htmlFor={`${headingId}-asset-${asset.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">Use {asset.name} as evidence</span>
                    <span className="text-[var(--color-soft-ink)]">{asset.status === "uploading" ? "Uploading…" : asset.status === "uploaded" ? "Ready" : asset.error ?? "Upload failed"}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-[var(--color-soft-ink)]">No evidence files added.</p>}
          {fileError ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{fileError}</p> : null}
        </fieldset>

        <div className="rounded-2xl bg-[var(--color-paper)] p-4">
          <p className="font-heading text-sm font-bold">Proof validation does not issue rewards.</p>
          <label className="mt-3 flex items-start gap-3 text-sm">
            <input ref={confirmationRef} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4" />
            <span>I confirm this is the published content and understand rewards are handled later.</span>
          </label>
        </div>

        {error ? <p role="alert" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
        <div role="status" aria-live="polite" aria-atomic="true">
          {success ? <h3 ref={successRef} tabIndex={-1} className="font-heading font-bold">Proof submitted for review.</h3> : null}
        </div>

        <div className="sticky bottom-3 z-10 -mx-2 rounded-2xl border-2 border-[var(--color-ink)] bg-white/95 p-2 shadow-[var(--shadow-sm)] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <button type="submit" disabled={busy} className="min-h-11 w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-5 py-2 font-heading font-bold disabled:opacity-50 sm:w-auto">
            {busy ? "Submitting proof..." : "Publish and submit proof"}
          </button>
        </div>
      </form>
    </section>
  );
}
