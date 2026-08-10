import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AdminAuthError, AdminRequestError } from "@/lib/adminTransport";
import {
  postCreatorPublicationProofReview,
  type CreatorCasePublicationProof,
  type CreatorCasePublicationProofDecision,
} from "@/lib/creatorCase";

export type PublicationProofReviewPanelProps = {
  workspaceId: string;
  creatorId: string;
  publicationProofs?: CreatorCasePublicationProof[];
  onAuthError?: (error: unknown) => void;
  onSuccess?: () => void;
};

type ProofDecisionMutation = {
  proof: CreatorCasePublicationProof;
  attemptId: string;
  commandId: string;
  commandKey: string;
  decision: CreatorCasePublicationProofDecision;
  message: string | null;
};

type PendingProofReviewCommand = {
  commandId: string;
  signature: string;
};

function proofReviewErrorMessage(error: unknown): string {
  const code = error instanceof AdminRequestError ? error.code : undefined;
  if (code === "proof_attempt_not_submitted") {
    return "This attempt is no longer actionable. Reload the case.";
  }
  if (code === "proof_message_required") {
    return "Feedback is required before requesting changes.";
  }
  if (code === "command_conflict") {
    return "This review command conflicted with another attempt. Retry the action.";
  }
  if (code === "proof_attempt_not_found" || code === "proof_lineage_mismatch") {
    return "This proof is no longer available in the case. Reload the case.";
  }
  return "Proof review could not be completed. Retry or reload the case.";
}

export function PublicationProofReviewPanel({
  workspaceId,
  creatorId,
  publicationProofs = [],
  onAuthError,
  onSuccess,
}: PublicationProofReviewPanelProps) {
  const pendingCommandIds = useRef<Record<string, PendingProofReviewCommand>>({});
  const proofIdentity = publicationProofs
    .map((proof) => `${proof.submissionId}:${proof.workItemId}:${proof.currentAttempt?.id ?? "none"}`)
    .sort()
    .join("|");
  const previousProofIdentity = useRef(proofIdentity);
  const [feedbackAttemptId, setFeedbackAttemptId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (previousProofIdentity.current !== proofIdentity) {
      pendingCommandIds.current = {};
      previousProofIdentity.current = proofIdentity;
    }
  }, [proofIdentity]);

  const mutation = useMutation({
    mutationFn: ({ proof, attemptId, decision, message, commandId }: ProofDecisionMutation) => postCreatorPublicationProofReview(
      workspaceId,
      creatorId,
      {
        submissionId: proof.submissionId,
        workItemId: proof.workItemId,
        attemptId,
        decision,
        message,
      },
      commandId,
    ),
    onSuccess: (_result, variables) => {
      delete pendingCommandIds.current[variables.commandKey];
      setFeedbackAttemptId(null);
      setFeedback("");
      setErrorMessage(null);
      onSuccess?.();
    },
    onError: (error, variables) => {
      if (error instanceof AdminAuthError) {
        onAuthError?.(error);
        setErrorMessage("Your session has expired. Please sign in again.");
        return;
      }
      if (error instanceof AdminRequestError && error.code === "command_conflict") {
        delete pendingCommandIds.current[variables.commandKey];
      }
      setErrorMessage(proofReviewErrorMessage(error));
    },
  });

  const submitDecision = (proof: CreatorCasePublicationProof, decision: CreatorCasePublicationProofDecision) => {
    const currentAttempt = proof.currentAttempt;
    if (!currentAttempt || currentAttempt.state !== "submitted") return;

    const message = decision === "changes_requested" ? feedback.trim() : null;
    if (decision === "changes_requested" && !message) {
      setErrorMessage("Feedback is required before requesting changes.");
      return;
    }

    const commandKey = `${proof.submissionId}:${currentAttempt.id}:${decision}`;
    const signature = JSON.stringify({
      submissionId: proof.submissionId,
      workItemId: proof.workItemId,
      attemptId: currentAttempt.id,
      decision,
      message,
    });
    const pendingCommand = pendingCommandIds.current[commandKey];
    const commandId = pendingCommand?.signature === signature ? pendingCommand.commandId : crypto.randomUUID();
    pendingCommandIds.current[commandKey] = { commandId, signature };
    mutation.mutate({ proof, attemptId: currentAttempt.id, decision, message, commandId, commandKey });
  };

  return (
    <section
      aria-labelledby="publication-proof-review-heading"
      className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
    >
      <h3 id="publication-proof-review-heading" className="font-heading font-bold">Publication proof review</h3>
      {errorMessage ? <p role="alert" className="text-sm font-bold text-red-700">{errorMessage}</p> : null}
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
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label="Verify publication proof"
                          disabled={mutation.isPending}
                          onClick={() => submitDecision(publicationProof, "verified")}
                          className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 text-sm font-heading font-bold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Verify publication proof
                        </button>
                        {feedbackAttemptId === publicationProof.currentAttempt.id ? null : (
                          <button
                            type="button"
                            disabled={mutation.isPending}
                            onClick={() => {
                              mutation.reset();
                              setErrorMessage(null);
                              setFeedback("");
                              setFeedbackAttemptId(publicationProof.currentAttempt!.id);
                            }}
                            className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] px-4 text-sm font-heading font-bold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Request changes
                          </button>
                        )}
                      </div>
                      {feedbackAttemptId === publicationProof.currentAttempt.id ? (
                        <div className="space-y-2">
                          <label className="block text-sm font-bold" htmlFor={`proof-feedback-${publicationProof.currentAttempt.id}`}>
                            Proof review feedback
                          </label>
                          <textarea
                            id={`proof-feedback-${publicationProof.currentAttempt.id}`}
                            value={feedback}
                            onChange={(event) => setFeedback(event.target.value)}
                            className="min-h-24 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm"
                          />
                          <button
                            type="button"
                            disabled={mutation.isPending || !feedback.trim()}
                            onClick={() => submitDecision(publicationProof, "changes_requested")}
                            className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] px-4 text-sm font-heading font-bold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Send change request
                          </button>
                        </div>
                      ) : null}
                      {mutation.isError && mutation.variables?.attemptId === publicationProof.currentAttempt.id ? (
                        <button
                          type="button"
                          disabled={mutation.isPending}
                          onClick={() => submitDecision(publicationProof, mutation.variables!.decision)}
                          className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] px-4 text-sm font-heading font-bold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Retry proof review
                        </button>
                      ) : null}
                    </div>
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
