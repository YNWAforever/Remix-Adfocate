import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { CreatorReviewRow } from "@/components/operator/CreatorReviewRow";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { AdminAuthError } from "@/lib/adminTransport";
import {
  fetchCreatorReviewQueue,
  type CreatorReviewStatus,
  type CreatorRiskLevel,
  type CreatorReviewQueueFilters,
} from "@/lib/creatorCase";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/creators")({
  component: CreatorsTab,
  validateSearch: (s: Record<string, unknown>): { mission_id?: string } =>
    typeof s.mission_id === "string" ? { mission_id: s.mission_id } : {},
});

function CreatorsTab() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CreatorReviewStatus | "all">("all");
  const [risk, setRisk] = useState<CreatorRiskLevel | "all">("all");
  const [sort, setSort] = useState<CreatorReviewQueueFilters["sort"]>("last_activity");
  const { mission_id: missionId } = Route.useSearch();

  const creators = useQuery({
    queryKey: ["admin-creators-review", { q, status, risk, sort, missionId, workspace }],
    enabled: authed && Boolean(workspace),
    retry: false,
    queryFn: () =>
      fetchCreatorReviewQueue(workspace, {
        q,
        status: status === "all" ? undefined : status,
        riskLevel: risk === "all" ? undefined : risk,
        sort,
        missionId,
        page: 1,
        pageSize: 25,
      }),
  });
  useEffect(() => {
    if (creators.error instanceof AdminAuthError) reportAuthError(creators.error);
  }, [creators.error, reportAuthError]);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        {missionId ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">mission_id: {missionId}</span>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)]">
          <label className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3">
            <Search className="h-4 w-4 shrink-0" />
            <input aria-label="Search creators" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creators" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Status</span>
            <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value as CreatorReviewStatus | "all")} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="flagged">Flagged</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Risk</span>
            <select aria-label="Risk filter" value={risk} onChange={(e) => setRisk(e.target.value as CreatorRiskLevel | "all")} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="unknown">unknown</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Sort</span>
            <select aria-label="Sort creators" value={sort} onChange={(e) => setSort(e.target.value as CreatorReviewQueueFilters["sort"])} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="last_activity">last_activity</option>
              <option value="trust_score">trust_score</option>
              <option value="level">level</option>
              <option value="social_freshness">social_freshness</option>
            </select>
          </label>
          <div className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Queue</span>
            <div className="flex h-9 items-center rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 text-sm font-medium text-[var(--color-ink)]">{creators.data?.total ?? 0} creators</div>
          </div>
        </div>
      </section>

      {!workspace ? <p className="text-sm text-[var(--color-soft-ink)]">Select a workspace to review creators.</p> : null}
      {creators.isLoading && <p className="text-sm">{t("common.loading")}</p>}
      {!creators.isLoading && creators.data?.creators.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.creatorsEmpty")}</p>
      )}

      <div className="space-y-3">
        {creators.data?.creators.map((creator) => (
          <CreatorReviewRow key={creator.id} workspaceId={workspace} creator={creator} missionId={missionId} />
        ))}
      </div>
    </div>
  );
}
