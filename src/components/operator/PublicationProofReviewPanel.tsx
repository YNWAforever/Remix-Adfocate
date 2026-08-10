import type { CreatorCasePublicationProof } from "@/lib/creatorCase";

export type PublicationProofReviewPanelProps = {
  workspaceId: string;
  creatorId: string;
  publicationProofs?: CreatorCasePublicationProof[];
  onSuccess?: () => void;
};

export function PublicationProofReviewPanel({ publicationProofs = [] }: PublicationProofReviewPanelProps) {
  return (
    <section
      aria-labelledby="publication-proof-review-heading"
      className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
    >
      <h3 id="publication-proof-review-heading" className="font-heading font-bold">Publication proof review</h3>
      {publicationProofs.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">No publication proofs linked to this creator case.</p>
      ) : (
        <div className="space-y-3">
          {publicationProofs.map((publicationProof) => (
            <article
              key={`${publicationProof.submissionId}:${publicationProof.workItemId}`}
              className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">
                  Work item {publicationProof.workItemId}
                </span>
                <span className="text-xs font-bold">{publicationProof.currentAttempt?.state ?? "awaiting submission"}</span>
              </div>
              {publicationProof.currentAttempt ? (
                <>
                  <a
                    href={publicationProof.currentAttempt.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all text-sm font-bold underline"
                  >
                    {publicationProof.currentAttempt.publishedUrl}
                  </a>
                  <p className="text-sm text-[var(--color-soft-ink)]">
                    {publicationProof.currentAttempt.platform ?? "Platform unavailable"} attempt {publicationProof.currentAttempt.sequence}
                  </p>
                  {publicationProof.currentAttempt.state === "submitted" ? (
                    <button
                      type="button"
                      aria-label="Verify publication proof"
                      className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 text-sm font-heading font-bold"
                    >
                      Verify publication proof
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-[var(--color-soft-ink)]">Awaiting creator submission.</p>
              )}
              {publicationProof.history.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm font-bold">Attempt history</summary>
                  <ol className="mt-2 space-y-2 text-sm">
                    {publicationProof.history.map((historyAttempt) => (
                      <li key={historyAttempt.id} className="rounded border border-[var(--color-ink)] p-2">
                        Attempt {historyAttempt.sequence}: {historyAttempt.state}
                        {historyAttempt.operatorMessage ? <p>{historyAttempt.operatorMessage}</p> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
