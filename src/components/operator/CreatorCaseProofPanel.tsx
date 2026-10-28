import { Link } from "@tanstack/react-router";
import { ExternalLink, FileCheck2 } from "lucide-react";
import type { CreatorCaseEnrichment, CreatorCaseProofItem, CreatorCaseProofReviewState } from "@/lib/admin";

const stateTone: Record<CreatorCaseProofReviewState, string> = {
  awaiting_review: "bg-[var(--color-magenta)] text-white",
  correction_requested: "bg-[var(--color-sky)]",
  in_review: "bg-white",
  verified: "bg-[var(--color-acid)]",
};

const stateLabel: Record<CreatorCaseProofReviewState, string> = {
  awaiting_review: "awaiting review",
  correction_requested: "correction requested",
  in_review: "in review",
  verified: "verified",
};

const PENDING_STATES: CreatorCaseProofReviewState[] = ["awaiting_review", "correction_requested", "in_review"];

function formatDateTime(value: string | null) {
  if (!value) return "No record";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProofRow({ proof }: { proof: CreatorCaseProofItem }) {
  return (
    <div className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">{proof.missionTitle ?? "Untitled mission"}</span>
        <span
          className={`rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold ${stateTone[proof.reviewState]}`}
        >
          {stateLabel[proof.reviewState]}
        </span>
      </div>

      <p className="text-xs text-[var(--color-soft-ink)]">
        {proof.workItemTitle} · {proof.platform} · attempt {proof.attemptNumber}{proof.isCurrentAttempt ? "" : " · historical attempt"}
      </p>

      <div className="flex flex-wrap gap-2">
        {proof.submittedLate ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-2 py-0.5 text-xs font-bold text-white">
            late
          </span>
        ) : null}
        {proof.metadataStatus === "unsafe" ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-2 py-0.5 text-xs font-bold text-white">
            unsafe metadata
          </span>
        ) : null}
        {proof.metadataStatus === "unavailable" ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
            metadata unavailable
          </span>
        ) : null}
      </div>

      {proof.reviewSummary ? <p className="text-sm">{proof.reviewSummary}</p> : null}

      <p className="text-xs text-[var(--color-soft-ink)]">Submitted {formatDateTime(proof.submittedAt)}</p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={proof.primaryUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-bold underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open published post
        </a>
        {/* Review actions live on the active-mission surface; deep-link rather than duplicate them. */}
        <Link
          to="/admin/active-missions/$workflowId"
          params={{ workflowId: proof.workflowId }}
          search={{ workItemId: proof.workItemId, ws: proof.workspaceId }}
          className="inline-flex h-8 items-center rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-xs font-heading font-bold"
        >
          Review proof
        </Link>
      </div>
    </div>
  );
}

export type CreatorCaseProofPanelProps = {
  proofs?: CreatorCaseEnrichment<CreatorCaseProofItem[]>;
  isLoading?: boolean;
};

export function CreatorCaseProofPanel({ proofs, isLoading }: CreatorCaseProofPanelProps) {
  const pendingCount =
    proofs?.status === "available" ? proofs.value.filter((p) => p.isCurrentAttempt && PENDING_STATES.includes(p.reviewState)).length : 0;

  return (
    <section
      aria-labelledby="creator-case-proofs-heading"
      className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4" />
          <h3 id="creator-case-proofs-heading" className="font-heading font-bold">
            Publication proofs
          </h3>
        </div>
        {pendingCount > 0 ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-2 py-0.5 text-xs font-bold text-white">
            {pendingCount} pending
          </span>
        ) : null}
      </div>

      {isLoading ? <p className="text-sm text-[var(--color-soft-ink)]">Loading publication proofs…</p> : null}

      {!isLoading && proofs?.status === "unavailable" ? (
        <p className="text-sm text-[var(--color-soft-ink)]">
          {proofs.reason === "not_configured"
            ? "Publication proofs are not enabled in this environment."
            : "Publication proofs could not be loaded. The rest of this case file is unaffected."}
        </p>
      ) : null}

      {!isLoading && proofs?.status === "available" ? (
        proofs.value.length > 0 ? (
          <div className="space-y-2">
            {proofs.value.map((proof) => (
              <ProofRow key={proof.attemptId} proof={proof} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-soft-ink)]">No publication proofs submitted</p>
        )
      ) : null}
    </section>
  );
}
