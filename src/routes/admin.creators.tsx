import { creatorQueueUrl, parseCreatorQueueSearch } from "@/lib/creatorQueueSearch";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { CreatorReviewRow } from "@/components/operator/CreatorReviewRow";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import {
  AdminAuthError,
  fetchCreatorReviewQueue,
  type AdminReviewStatus,
  type AdminRiskLevel,
  type CreatorReviewQueueFilters,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/admin/creators")({
  component: CreatorsTab,
  validateSearch: parseCreatorQueueSearch,
});

function CreatorsTab() {
  const { t, lang } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const initial = parseCreatorQueueSearch({ ...Object.fromEntries(new URLSearchParams(window.location.search)), ...Route.useSearch() });
  const qc = useQueryClient();
  const [page, setPage] = useState(initial.page);
  const previousWorkspace = useRef(workspace);
  const [q, setQ] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { if (previousWorkspace.current !== workspace) {
    previousWorkspace.current = workspace; setPage(1);
    qc.removeQueries({ predicate: (query) => query.queryKey[0] === "admin-creator-detail" || (query.queryKey[0] === "admin-creators-review" && (query.queryKey[1] as { workspace?: string })?.workspace !== workspace) });
  } }, [workspace, qc]);
  const [status, setStatus] = useState<AdminReviewStatus | "all">(initial.status);
  const [risk, setRisk] = useState<AdminRiskLevel | "all">(initial.risk);
  const [sort, setSort] = useState<CreatorReviewQueueFilters["sort"]>(initial.sort);
  const missionId = initial.mission_id;
  useEffect(() => {
    const url = creatorQueueUrl({ ws: workspace, q, status, risk, sort: sort ?? "last_activity", page, mission_id: missionId });
    window.history.replaceState(window.history.state, "", url);
  }, [workspace, q, status, risk, sort, page, missionId]);

  const creators = useQuery({
    queryKey: ["admin-creators-review", { q: debouncedQ, status, risk, sort, missionId, workspace, page }],
    enabled: authed,
    retry: false,
    queryFn: () =>
      fetchCreatorReviewQueue({
        q: debouncedQ,
        status: status === "all" ? undefined : status,
        riskLevel: risk === "all" ? undefined : risk,
        sort,
        missionId,
        workspace: workspace || undefined,
        page,
        pageSize: 25,
      }),
  });
  const visibleCreators = useCanShowPreviousData(creators, ["admin-creators-review", { q: debouncedQ, status, risk, sort, missionId, workspace, page }]) ? creators.data : undefined;
  useEffect(() => {
    if (!visibleCreators || creators.isFetching || creators.isError) return;
    const selectedId = sessionStorage.getItem("adfocate-queue-focus");
    if (!selectedId || !visibleCreators.creators.some((creator) => creator.id === selectedId)) return;
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-creator-id]"))
      .find((element) => element.dataset.creatorId === selectedId);
    if (!link) return;
    link.focus({ preventScroll: true });
    const top = Number(sessionStorage.getItem("adfocate-queue-scroll"));
    if (Number.isFinite(top) && top >= 0) window.scrollTo({ top, behavior: "instant" });
    sessionStorage.removeItem("adfocate-queue-focus");
    sessionStorage.removeItem("adfocate-queue-scroll");
  }, [visibleCreators, creators.isFetching, creators.isError]);
  useEffect(() => {
    if (creators.error instanceof AdminAuthError) reportAuthError(creators.error);
  }, [creators.error, reportAuthError]);

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-bold">{lang === "en" ? "Creator queue" : "作者審核列表"}</h1>
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        {missionId ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">mission_id: {missionId}</span>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)]">
          <label className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3">
            <Search className="h-4 w-4 shrink-0" />
            <input aria-label="Search creators" value={q} onChange={(e) => { setQ([...e.target.value].slice(0, 200).join("")); setPage(1); }} placeholder="Search creators" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Status</span>
            <select aria-label="Status filter" value={status} onChange={(e) => { setStatus(e.target.value as AdminReviewStatus | "all"); setPage(1); }} className="h-11 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="flagged">Flagged</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Risk</span>
            <select aria-label="Risk filter" value={risk} onChange={(e) => { setRisk(e.target.value as AdminRiskLevel | "all"); setPage(1); }} className="h-11 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="unknown">unknown</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Sort</span>
            <select aria-label="Sort creators" value={sort} onChange={(e) => { setSort(e.target.value as CreatorReviewQueueFilters["sort"]); setPage(1); }} className="h-11 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="last_activity">last_activity</option>
              <option value="trust_score">trust_score</option>
              <option value="level">level</option>
              <option value="social_freshness">social_freshness</option>
            </select>
          </label>
          <div className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Queue</span>
            <div className="flex h-9 items-center rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 text-sm font-medium text-[var(--color-ink)]">{visibleCreators?.total ?? 0} creators</div>
          </div>
        </div>
      </section>

      {creators.isLoading && <p className="text-sm">{t("common.loading")}</p>}
      <RequestFeedback error={creators.error} stale={Boolean(visibleCreators)} retry={() => void creators.refetch()} />
      {!creators.isLoading && !creators.isError && visibleCreators?.creators.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.creatorsEmpty")}</p>
      )}

      <nav aria-label="Creator queue pages" className="flex items-center gap-3">
        <button type="button" disabled={page <= 1 || creators.isFetching} className="min-h-11 px-2" onClick={() => setPage((value) => value - 1)}>上一頁 / Previous</button>
        <span aria-live="polite">{page} / {Math.max(1, Math.ceil((visibleCreators?.total ?? 0) / 25))}</span>
        <button type="button" disabled={!visibleCreators || page * 25 >= visibleCreators.total || creators.isFetching} className="min-h-11 px-2" onClick={() => setPage((value) => value + 1)}>下一頁 / Next</button>
      </nav>
      <div className="space-y-3">
        {visibleCreators?.creators.map((creator) => (
          <CreatorReviewRow key={creator.id} creator={creator} missionId={missionId} />
        ))}
      </div>
    </div>
  );
}
