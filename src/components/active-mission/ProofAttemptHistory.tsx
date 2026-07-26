import { useEffect, useId, useRef } from "react";
import type { MissionPublicationView, PublicationProofAttemptView } from "@/lib/activeMission";

type Props = {
  publication: MissionPublicationView;
  correctionResponseDeadline?: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  access: "Access",
  platform: "Platform",
  account: "Account",
  content: "Content",
  timing: "Timing",
  disclosure: "Disclosure",
  evidence: "Evidence",
  other: "Other",
};

function Metadata({ attempt }: { attempt: PublicationProofAttemptView }) {
  if (attempt.metadataStatus !== "available") {
    return (
      <p className="rounded-xl border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950">
        Automatic preview is unavailable. Your proof is still ready for manual review.
      </p>
    );
  }
  const title = typeof attempt.metadataSnapshot.pageTitle === "string"
    ? attempt.metadataSnapshot.pageTitle
    : null;
  return title ? <p className="text-sm"><span className="font-bold">Preview title:</span> {title}</p> : null;
}

function AttemptCard({
  attempt,
  accepted,
  correctionResponseDeadline,
}: {
  attempt: PublicationProofAttemptView;
  accepted: boolean;
  correctionResponseDeadline?: string | null;
}) {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border-2 border-[var(--color-ink)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-heading text-lg font-bold">Proof attempt {attempt.attemptNumber}</h3>
        <div className="flex gap-2">
          {accepted ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">Accepted attempt {attempt.attemptNumber}</span> : null}
          {attempt.submittedLate ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-950">Submitted late</span> : null}
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--color-soft-ink)]">
        Submitted <time dateTime={attempt.submittedAt}>{new Date(attempt.submittedAt).toLocaleString()}</time>
      </p>

      <ul className="mt-4 space-y-2">
        <li>
          <a href={attempt.primaryUrl} target="_blank" rel="noreferrer" className="font-bold underline">
            Primary published URL
          </a>
        </li>
        {attempt.additionalUrls.map((url, index) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className="font-bold underline">
              Additional published URL {index + 1}
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-4"><Metadata attempt={attempt} /></div>

      {attempt.evidence.length > 0 ? (
        <div className="mt-4">
          <h4 className="font-heading text-sm font-bold">Private evidence</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {attempt.evidence.map((asset) => (
              <li key={asset.id}>
                <a href={asset.signedUrl} target="_blank" rel="noreferrer" className="font-semibold underline">{asset.originalFilename}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {attempt.corrections.length > 0 ? (
        <div className="mt-4 rounded-xl bg-[var(--color-paper)] p-4">
          <h4 className="font-heading text-sm font-bold">Required corrections</h4>
          {correctionResponseDeadline ? (
            <dl className="mt-2 text-sm">
              <dt className="font-bold">Response deadline</dt>
              <dd><time dateTime={correctionResponseDeadline}>{new Date(correctionResponseDeadline).toLocaleString()}</time></dd>
            </dl>
          ) : null}
          <ol className="mt-3 space-y-3">
            {attempt.corrections.map((correction) => (
              <li key={correction.id}>
                <span className="rounded-full border border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{CATEGORY_LABELS[correction.category] ?? CATEGORY_LABELS.other}</span>
                <p className="mt-1 text-sm">{correction.text}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  );
}

export function ProofAttemptHistory({ publication, correctionResponseDeadline = null }: Props) {
  const headingId = useId();
  const attempts = [...publication.attempts].sort((left, right) => right.attemptNumber - left.attemptNumber);
  const verifiedHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (publication.state === "proof_verified") {
      verifiedHeadingRef.current?.focus();
    }
  }, [publication.state, publication.acceptedAttempt?.id]);

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      {publication.state === "proof_verified" ? (
        <div className="rounded-[var(--radius)] border-2 border-emerald-800 bg-emerald-50 p-5">
          <h2 ref={verifiedHeadingRef} id={headingId} tabIndex={-1} className="font-heading text-xl font-bold text-emerald-950">Proof verified</h2>
          <p className="mt-2 text-sm text-emerald-950">Proof verified; reward processing is a later step.</p>
        </div>
      ) : <h2 id={headingId} className="font-heading text-xl font-bold">Proof attempt history</h2>}

      {attempts.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">No proof attempts yet.</p> : (
        attempts.map((attempt) => (
          <AttemptCard
            key={attempt.id}
            attempt={attempt}
            accepted={attempt.id === publication.acceptedAttempt?.id}
            correctionResponseDeadline={attempt.id === publication.currentAttempt?.id ? correctionResponseDeadline : null}
          />
        ))
      )}
    </section>
  );
}
