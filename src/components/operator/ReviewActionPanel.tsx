import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flag } from "lucide-react";
import {
  postCreatorReview,
  type AdminCreatorReviewRow,
  type AdminRiskLevel,
  type AdminReviewStatus,
} from "@/lib/admin";

export function ReviewActionPanel({ creator }: { creator: AdminCreatorReviewRow }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: {
      status: AdminReviewStatus;
      riskLevel: AdminRiskLevel;
      summary: string;
      note?: string;
    }) => postCreatorReview(creator.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-creators-review"] }),
  });

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
