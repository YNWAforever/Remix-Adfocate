import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flag } from "lucide-react";
import {
  postCreatorReview,
  type AdminRiskLevel,
  type AdminReviewProjection,
  type AdminReviewStatus,
} from "@/lib/admin";

type ReviewActionPanelProps = {
  creator: {
    id: string;
    displayName: string;
    review: AdminReviewProjection;
  };
  variant?: "compact" | "full";
  onSuccess?: () => void;
};

export function ReviewActionPanel({ creator, variant = "compact", onSuccess }: ReviewActionPanelProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminReviewStatus>(creator.review.status);
  const [riskLevel, setRiskLevel] = useState<AdminRiskLevel>(creator.review.riskLevel);
  const [summary, setSummary] = useState(creator.review.summary ?? "");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setStatus(creator.review.status);
    setRiskLevel(creator.review.riskLevel);
    setSummary(creator.review.summary ?? "");
    setNote("");
    setValidationError("");
  }, [creator.review]);

  const mutation = useMutation({
    mutationFn: (body: {
      status: AdminReviewStatus;
      riskLevel: AdminRiskLevel;
      summary: string;
      note?: string;
    }) => postCreatorReview(creator.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-creators-review"] });
      onSuccess?.();
    },
  });

  if (variant === "full") {
    return (
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Review status</span>
            <select
              aria-label="Review status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as AdminReviewStatus);
                setValidationError("");
              }}
              className="h-10 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-medium text-[var(--color-ink)]"
            >
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="flagged">Flagged</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Risk level</span>
            <select
              aria-label="Risk level"
              value={riskLevel}
              onChange={(event) => setRiskLevel(event.target.value as AdminRiskLevel)}
              className="h-10 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-medium text-[var(--color-ink)]"
            >
              <option value="unknown">Unknown</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
          <span>Review summary</span>
          <textarea
            aria-label="Review summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 text-sm outline-none"
          />
        </label>

        <label className="block space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
          <span>Review note</span>
          <textarea
            aria-label="Review note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setValidationError("");
            }}
            rows={3}
            className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 text-sm outline-none"
          />
        </label>

        {validationError ? <p className="text-sm font-medium text-[var(--color-magenta)]">{validationError}</p> : null}

        <button
          type="button"
          aria-label="Save review action"
          disabled={mutation.isPending}
          onClick={() => {
            const trimmedNote = note.trim();
            if (status === "flagged" && !trimmedNote) {
              setValidationError("Flagged reviews require a note");
              return;
            }
            mutation.mutate({
              status,
              riskLevel,
              summary: summary.trim(),
              note: trimmedNote || undefined,
            });
          }}
          className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 text-sm font-heading font-bold disabled:opacity-50"
        >
          Save review
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-label={`Approve ${creator.displayName}`}
        title="Approve creator"
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({
            status: "approved",
            riskLevel: "low",
            summary: "Approved from creator review queue.",
          })
        }
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Flag ${creator.displayName}`}
        title="Flag creator"
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({
            status: "flagged",
            riskLevel: "high",
            summary: "Flagged from creator review queue.",
            note: "Flagged from queue for operator review.",
          })
        }
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-white disabled:opacity-50"
      >
        <Flag className="h-4 w-4" />
      </button>
    </div>
  );
}
