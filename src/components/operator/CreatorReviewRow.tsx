import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flag, UserRound } from "lucide-react";
import { ReviewActionPanel } from "@/components/operator/ReviewActionPanel";
import {
  RiskBadge,
  ReviewBadge,
  ShortlistBadge,
  SocialSyncBadge,
} from "@/components/operator/OperatorBadges";
import {
  postMissionShortlist,
  type AdminCreatorReviewRow,
} from "@/lib/admin";

type CreatorReviewRowProps = {
  creator: AdminCreatorReviewRow;
  missionId?: string;
  onShortlistSuccess?: () => void;
};

export function formatAdminErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "flagged_note_required") {
      return "Flagged creators need a shortlist note";
    }
    if (error.message === "flagged_invite_blocked") {
      return "Flagged creators cannot be invited";
    }
    return error.message;
  }
  return "Something went wrong";
}

function formatTrustSummary(scores: AdminCreatorReviewRow["scores"]) {
  const entries = Object.entries(scores).filter(([, value]) => typeof value === "number") as Array<[string, number]>;
  if (entries.length === 0) {
    return "No trust scores";
  }
  const average = Math.round(entries.reduce((sum, [, value]) => sum + value, 0) / entries.length);
  return `Trust ${average} · ${entries.map(([key, value]) => `${key} ${value}`).join(" · ")}`;
}

function formatLastActivity(lastActivityAt: string | null) {
  if (!lastActivityAt) {
    return "No recent activity";
  }
  return new Date(lastActivityAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CreatorReviewRow({ creator, missionId, onShortlistSuccess }: CreatorReviewRowProps) {
  const queryClient = useQueryClient();
  const [showShortlistNote, setShowShortlistNote] = useState(false);
  const [shortlistNote, setShortlistNote] = useState("");
  const [shortlistError, setShortlistError] = useState("");

  useEffect(() => {
    setShowShortlistNote(false);
    setShortlistNote("");
    setShortlistError("");
  }, [creator.id, creator.review.status, missionId]);

  const shortlistMutation = useMutation({
    mutationFn: (notes?: string) => {
      if (!missionId) {
        throw new Error("Missing mission context");
      }
      return postMissionShortlist(missionId, {
        creatorId: creator.id,
        source: "review_queue",
        notes,
      });
    },
    onSuccess: async () => {
      setShowShortlistNote(false);
      setShortlistNote("");
      setShortlistError("");
      await queryClient.invalidateQueries({ queryKey: ["admin-creators-review"] });
      onShortlistSuccess?.();
    },
    onError: (error) => {
      setShortlistError(formatAdminErrorMessage(error));
    },
  });

  return (
    <div className="grid min-h-[88px] gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(220px,auto)]">
      <div className="flex min-w-0 gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)]">
          {creator.avatarUrl ? (
            <img src={creator.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserRound className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/operator/creators/$creatorId" params={{ creatorId: creator.id }} className="truncate font-heading font-bold underline">
              {creator.displayName}
            </Link>
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
              {creator.level}
            </span>
          </div>
          <p className="truncate text-sm text-[var(--color-soft-ink)]">{creator.categories.join(", ") || "No categories"}</p>
          <p className="text-xs text-[var(--color-soft-ink)]">{formatTrustSummary(creator.scores)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <SocialSyncBadge label={creator.social.label} />
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
            {creator.social.ownershipLabel}
          </span>
        </div>
        <p className="text-xs text-[var(--color-soft-ink)]">
          {creator.social.platforms.join(", ") || "No platforms"} · {creator.social.followerCount?.toLocaleString() ?? "0"}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <ReviewBadge status={creator.review.status} />
          <RiskBadge risk={creator.review.riskLevel} />
          {creator.shortlist ? <ShortlistBadge status={creator.shortlist.status} /> : null}
        </div>
        <p className="text-xs text-[var(--color-soft-ink)]">Last activity: {formatLastActivity(creator.lastActivityAt)}</p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {missionId ? (
            <button
              type="button"
              aria-label={`Shortlist ${creator.displayName}`}
              disabled={shortlistMutation.isPending}
              onClick={() => {
                setShortlistError("");
                if (creator.review.status === "flagged") {
                  setShowShortlistNote(true);
                  return;
                }
                shortlistMutation.mutate(undefined);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
            >
              <Flag className="h-4 w-4" />
              Shortlist
            </button>
          ) : null}
          <ReviewActionPanel creator={creator} />
        </div>

        {missionId && showShortlistNote ? (
          <div className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] p-2">
            <label className="block space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Shortlist note</span>
              <textarea
                aria-label={`Shortlist note for ${creator.displayName}`}
                value={shortlistNote}
                onChange={(event) => {
                  setShortlistNote(event.target.value);
                  setShortlistError("");
                }}
                rows={2}
                className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm outline-none"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowShortlistNote(false);
                  setShortlistError("");
                }}
                className="inline-flex h-9 items-center rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label={`Save shortlist ${creator.displayName}`}
                disabled={shortlistMutation.isPending}
                onClick={() => shortlistMutation.mutate(shortlistNote.trim() || undefined)}
                className="inline-flex h-9 items-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 text-sm font-heading font-bold disabled:opacity-50"
              >
                Save shortlist
              </button>
            </div>
          </div>
        ) : null}

        {shortlistError ? <p className="text-sm font-medium text-[var(--color-magenta)]">{shortlistError}</p> : null}
      </div>
    </div>
  );
}
