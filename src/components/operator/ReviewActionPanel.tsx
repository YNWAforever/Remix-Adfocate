import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "@/components/RequestFeedback";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flag } from "lucide-react";
import { useStaffAccess } from "@/components/admin/StaffAccessContext";
import {
  postCreatorReview,
  fetchCreatorDetail,
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
  workspace?: string;
  onSuccess?: () => void;
};

export function ReviewActionPanel({ creator, variant = "compact", workspace, onSuccess }: ReviewActionPanelProps) {
  const access=useStaffAccess();
  const requestWorkspace = workspace ?? access?.access?.workspace?.id ?? "";
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminReviewStatus>(creator.review.status);
  const [riskLevel, setRiskLevel] = useState<AdminRiskLevel>(creator.review.riskLevel);
  const [summary, setSummary] = useState(creator.review.summary ?? "");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState("");
  const [flagging, setFlagging] = useState(false);
  type ReviewBody = { status: AdminReviewStatus; riskLevel: AdminRiskLevel; summary: string; note?: string };
  const command = useRef<{ id: string; revision: number; body: ReviewBody } | null>(null);
  const baseline = useRef(creator.review);
  const dirty = status !== baseline.current.status || riskLevel !== baseline.current.riskLevel
    || summary !== (baseline.current.summary ?? "") || note.length > 0;
  const revision = useRef(creator.review.revision ?? 0);
  const lastCreator = useRef(creator.id);

  useEffect(() => {
    if (lastCreator.current === creator.id) {
      if (!command.current && !dirty && (creator.review.revision ?? 0) >= revision.current) {
        revision.current = creator.review.revision ?? 0;
        baseline.current = creator.review;
        setStatus(creator.review.status); setRiskLevel(creator.review.riskLevel); setSummary(creator.review.summary ?? "");
      }
      return;
    }
    lastCreator.current = creator.id;
    command.current = null;
    baseline.current = creator.review;
    revision.current = creator.review.revision ?? 0;
    setStatus(creator.review.status);
    setRiskLevel(creator.review.riskLevel);
    setSummary(creator.review.summary ?? "");
    setNote("");
    setValidationError("");
  }, [creator.id, creator.review, dirty]);

  const mutation = useMutation({
    mutationFn: (body: ReviewBody) => {
      command.current ??= { id: crypto.randomUUID(), revision: revision.current, body };
      const pending = command.current;
      return postCreatorReview(creator.id, { ...pending.body, requestId: pending.id, expectedRevision: pending.revision }, requestWorkspace);
    },
    onSuccess: async (response, body) => {
      command.current = null;
      comparison.reset();
      revision.current = response?.review?.revision ?? revision.current + 1;
      baseline.current = { ...creator.review, ...body, revision: revision.current };
      setNote(""); setFlagging(false);
      await queryClient.invalidateQueries({ queryKey: ["admin-creators-review"] });
      onSuccess?.();
    },
  });

  const comparison = useMutation({ mutationFn: () => fetchCreatorDetail(creator.id, requestWorkspace) });
  const conflict = mutation.error && "status" in mutation.error && mutation.error.status === 409;
  const unknown = Boolean(mutation.error && !conflict && command.current);
  const recovery = <>
    <RequestFeedback error={mutation.error} />
    {conflict && <div className="space-y-2 text-sm">
      <button type="button" disabled={comparison.isPending} onClick={() => { comparison.reset(); comparison.mutate(); }}>Compare latest review</button>
      <RequestFeedback error={comparison.error} />
      {comparison.isSuccess && <>
        <p>Latest review revision {comparison.data.review.revision ?? 0}</p>
        <p>{comparison.data.review.status} · {comparison.data.review.riskLevel}</p>
        <p>{comparison.data.review.summary}</p>
        <button type="button" onClick={() => {
          revision.current = comparison.data.review.revision ?? 0;
          command.current = null;
          baseline.current = comparison.data.review;
          mutation.reset(); comparison.reset();
          setValidationError("已保留輸入，請核對後再儲存。 / Input retained; compare before saving.");
        }}>Keep review on latest revision</button>
      </>}
    </div>}
    {unknown && <button type="button" disabled={mutation.isPending} onClick={() => command.current && mutation.mutate(command.current.body)}>Retry same review request</button>}
  </>;
  if(access&&!access.can("creator.review"))return <p className="text-xs">Read only / 只供檢視；如有未儲存輸入會保留至職責恢復。</p>;
  if (variant === "full" || flagging) {
    return (
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        {flagging && <p>Flag 會影響一般邀請資格，請填寫具體原因。 / A flag affects invitation eligibility. Give a specific reason.</p>}
        {recovery}
        <fieldset disabled={mutation.isPending || unknown} className="space-y-3">
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

        {validationError ? <p role="alert" className="text-sm font-medium text-[var(--color-magenta)]">{validationError}</p> : null}
        {flagging && <button type="button" disabled={mutation.isPending || Boolean(conflict) || unknown} onClick={() => { setFlagging(false); setNote(""); setValidationError(""); }}>取消 / Cancel</button>}

        <button
          type="button"
          aria-label="Save review action"
          disabled={mutation.isPending || Boolean(conflict) || unknown}
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
        </fieldset>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {recovery}
      <button
        type="button"
        aria-label={`Approve ${creator.displayName}`}
        title="Approve creator"
        disabled={mutation.isPending || Boolean(conflict) || unknown}
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
        disabled={mutation.isPending || Boolean(conflict) || unknown}
        onClick={() => { setStatus("flagged"); setFlagging(true); }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-white disabled:opacity-50"
      >
        <Flag className="h-4 w-4" />
      </button>
    </div>
  );
}
