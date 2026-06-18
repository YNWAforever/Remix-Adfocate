import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import { CreatorReviewRow } from "@/components/operator/CreatorReviewRow";
import {
  fetchCreatorReviewQueue,
  getAdminSecret,
  type AdminReviewStatus,
  type AdminRiskLevel,
  type CreatorReviewQueueFilters,
} from "@/lib/admin";

export const Route = createFileRoute("/operator/creators")({
  component: OperatorCreatorsRoute,
});

function OperatorCreatorsRoute() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AdminReviewStatus | "all">("all");
  const [risk, setRisk] = useState<AdminRiskLevel | "all">("all");
  const [sort, setSort] = useState<CreatorReviewQueueFilters["sort"]>("last_activity");
  const routeSearch = Route.useSearch();
  const missionSearch = routeSearch as { mission_id?: unknown };
  const missionId = typeof missionSearch.mission_id === "string" ? missionSearch.mission_id : undefined;

  const creators = useQuery({
    queryKey: ["admin-creators-review", { q, status, risk, sort, missionId }],
    enabled: !!secret,
    retry: false,
    queryFn: () =>
      fetchCreatorReviewQueue({
        q,
        status: status === "all" ? undefined : status,
        riskLevel: risk === "all" ? undefined : risk,
        sort,
        missionId,
        page: 1,
        pageSize: 25,
      }),
  });

  const missionContext = useMemo(() => {
    if (!missionId) {
      return null;
    }
    return (
      <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">
        mission_id: {missionId}
      </span>
    );
  }, [missionId]);

  return (
    <OperatorAuthGate error={creators.error} onSecretChange={setSecret}>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold">創作者審核佇列</h1>
              {missionContext}
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">掃描同步狀態、風險與快速審批動作。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/operator"
              className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold"
            >
              <ListFilter className="h-4 w-4" />
              申請首頁
            </Link>
          </div>
        </div>

        <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)]">
            <label className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3">
              <Search className="h-4 w-4 shrink-0" />
              <input
                aria-label="Search creators"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search creators"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Status</span>
              <select
                aria-label="Status filter"
                value={status}
                onChange={(event) => setStatus(event.target.value as AdminReviewStatus | "all")}
                className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]"
              >
                <option value="all">all</option>
                <option value="needs_review">Needs review</option>
                <option value="approved">Approved</option>
                <option value="flagged">Flagged</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Risk</span>
              <select
                aria-label="Risk filter"
                value={risk}
                onChange={(event) => setRisk(event.target.value as AdminRiskLevel | "all")}
                className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]"
              >
                <option value="all">all</option>
                <option value="unknown">unknown</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Sort</span>
              <select
                aria-label="Sort creators"
                value={sort}
                onChange={(event) => setSort(event.target.value as CreatorReviewQueueFilters["sort"])}
                className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]"
              >
                <option value="last_activity">last_activity</option>
                <option value="trust_score">trust_score</option>
                <option value="level">level</option>
                <option value="social_freshness">social_freshness</option>
              </select>
            </label>
            <div className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
              <span>Queue</span>
              <div className="flex h-9 items-center rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 text-sm font-medium text-[var(--color-ink)]">
                {creators.data?.total ?? 0} creators
              </div>
            </div>
          </div>
        </section>

        {creators.isLoading && <p className="text-sm">載入中…</p>}
        {!creators.isLoading && creators.data?.creators.length === 0 && (
          <p className="text-sm text-[var(--color-soft-ink)]">暫無待審核創作者</p>
        )}

        <div className="space-y-3">
          {creators.data?.creators.map((creator) => (
            <CreatorReviewRow key={creator.id} creator={creator} missionId={missionId} />
          ))}
        </div>
      </div>
    </OperatorAuthGate>
  );
}
