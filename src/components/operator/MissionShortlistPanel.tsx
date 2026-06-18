import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react";
import {
  patchMissionShortlist,
  type AdminShortlistSource,
  type AdminShortlistStatus,
} from "@/lib/admin";
import { ShortlistBadge } from "./OperatorBadges";
import { formatAdminErrorMessage } from "./CreatorReviewRow";

type MissionShortlistRow = {
  creator_id: string;
  status: AdminShortlistStatus;
  source: AdminShortlistSource;
  notes: string | null;
  creators?: { display_name?: string | null };
};

export function MissionShortlistPanel({ missionId, rows }: { missionId: string; rows: MissionShortlistRow[] }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ creatorId, status }: { creatorId: string; status: AdminShortlistStatus }) =>
      patchMissionShortlist(missionId, creatorId, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-mission-shortlist", missionId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-creators-review"] });
    },
  });

  return (
    <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-bold">Shortlist</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">
          {rows.length} creators
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">No shortlisted creators yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const name = row.creators?.display_name ?? row.creator_id;
            return (
              <div
                key={row.creator_id}
                className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-heading font-bold">{name}</p>
                    <ShortlistBadge status={row.status} />
                  </div>
                  <p className="text-xs text-[var(--color-soft-ink)]">{row.source}</p>
                  {row.notes ? <p className="text-sm text-[var(--color-soft-ink)]">{row.notes}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Invite ${name}`}
                    title="Invite"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ creatorId: row.creator_id, status: "invited" })}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Dismiss ${name}`}
                    title="Dismiss"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ creatorId: row.creator_id, status: "dismissed" })}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-white disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mutation.error ? (
        <p className="text-sm font-medium text-[var(--color-magenta)]">{formatAdminErrorMessage(mutation.error)}</p>
      ) : null}
    </section>
  );
}
