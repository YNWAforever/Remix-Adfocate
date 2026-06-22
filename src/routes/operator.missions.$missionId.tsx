import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { MissionShortlistPanel } from "@/components/operator/MissionShortlistPanel";
import { CreatorReviewRow } from "@/components/operator/CreatorReviewRow";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import {
  AdminAuthError,
  fetchCreatorReviewQueue,
  fetchMissionShortlist,
  type AdminReviewStatus,
} from "@/lib/admin";

export const Route = createFileRoute("/operator/missions/$missionId")({
  component: OperatorMissionShortlistRoute,
});

function OperatorMissionShortlistRoute() {
  const { t } = useI18n();
  const { missionId } = Route.useParams();
  const { authed, reportAuthError } = useAdminAuth();
  const [status, setStatus] = useState<AdminReviewStatus | "all">("all");
  const queryClient = useQueryClient();
  const selectedStatus = status === "all" ? undefined : status;

  const shortlist = useQuery({
    queryKey: ["admin-mission-shortlist", missionId],
    enabled: authed,
    retry: false,
    queryFn: () => fetchMissionShortlist(missionId),
  });

  const queue = useQuery({
    queryKey: ["admin-creators-review", { missionId, status: selectedStatus }],
    enabled: authed,
    retry: false,
    queryFn: () =>
      fetchCreatorReviewQueue({
        missionId,
        status: selectedStatus,
        page: 1,
        pageSize: 25,
        sort: "last_activity",
      }),
  });

  // Route auth errors through the shared operator context so StaffAuthGate can re-prompt.
  // Must run in an effect (not during render) to avoid updating the parent layout mid-render.
  useEffect(() => {
    if (shortlist.error instanceof AdminAuthError) reportAuthError(shortlist.error);
  }, [shortlist.error, reportAuthError]);
  useEffect(() => {
    if (queue.error instanceof AdminAuthError) reportAuthError(queue.error);
  }, [queue.error, reportAuthError]);

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="space-y-1">
            <h1 className="font-display text-xl font-bold">{shortlist.data?.mission.title ?? "Mission shortlist"}</h1>
            <p className="text-sm text-[var(--color-soft-ink)]">Mission-scoped creator selection with shortlist and invite actions.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/applications"
              className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold"
            >
              <ArrowLeft className="h-4 w-4" />
              Applications
            </Link>
            <Link
              to="/admin/creators"
              search={{ mission_id: missionId } as never}
              className="inline-flex h-9 items-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 text-sm font-heading font-bold"
            >
              Full queue
            </Link>
          </div>
        </div>

        {shortlist.isLoading ? <p className="text-sm">{t("common.loading")}</p> : null}

        <MissionShortlistPanel missionId={missionId} rows={shortlist.data?.shortlists ?? []} />

        <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold">Mission queue</h2>
              <p className="text-sm text-[var(--color-soft-ink)]">Approved creators stay on top; flagged creators stay hidden until selected.</p>
            </div>
            <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Status</span>
              <select
                aria-label="Status filter"
                value={status}
                onChange={(event) => setStatus(event.target.value as AdminReviewStatus | "all")}
                className="h-9 min-w-[140px] rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]"
              >
                <option value="all">all</option>
                <option value="approved">Approved</option>
                <option value="needs_review">Needs review</option>
                <option value="flagged">Flagged</option>
              </select>
            </label>
          </div>

          {queue.isLoading ? <p className="text-sm">{t("common.loading")}</p> : null}
          {!queue.isLoading && (queue.data?.creators.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--color-soft-ink)]">No creators match this mission queue view.</p>
          ) : null}

          <div className="space-y-3">
            {queue.data?.creators.map((creator) => (
              <CreatorReviewRow
                key={creator.id}
                creator={creator}
                missionId={missionId}
                onShortlistSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-mission-shortlist", missionId] })}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
