// src/routes/admin.insights.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminKeys, fetchInsights, type Insights, type InsightsMetric } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { TrendChart } from "@/components/admin/TrendChart";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/admin/insights")({ component: InsightsPage });

type Win = 7 | 30 | 90;

function fmtNumber(n: number): string {
  return n.toLocaleString();
}
function fmtPct(n: number): string {
  return `${n}%`;
}
function fmtCash(n: number): string {
  return `HKD ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DeltaBadge({ metric }: { metric: InsightsMetric }) {
  const { t } = useI18n();
  if (metric.deltaPct === null) {
    return <span className="text-xs text-[var(--color-soft-ink)]">{t("app.insights.deltaNone")}</span>;
  }
  const up = metric.deltaPct > 0;
  const flat = metric.deltaPct === 0;
  const cls = flat ? "metric-badge" : up ? "metric-badge metric-up" : "metric-badge metric-down";
  const sign = up ? "+" : "";
  return <span className={cls}>{`${sign}${metric.deltaPct}%`}</span>;
}

function KpiCard({
  label,
  metric,
  format,
  primary = false,
}: {
  label: string;
  metric: InsightsMetric;
  format: (n: number) => string;
  primary?: boolean;
}) {
  if (primary) {
    return (
      <div className="wallet-card p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-paper)] opacity-80">{label}</p>
        <p className="mt-1 font-display text-4xl font-bold text-[var(--color-acid)]">{format(metric.value)}</p>
        <div className="mt-2">
          <DeltaBadge metric={metric} />
        </div>
      </div>
    );
  }
  return (
    <div className="pastel-card p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{format(metric.value)}</p>
      <div className="mt-2">
        <DeltaBadge metric={metric} />
      </div>
    </div>
  );
}

function FunnelView({ funnel }: { funnel: Insights["funnel"] }) {
  const { t } = useI18n();
  const stages = [
    { label: t("app.insights.funnelJoined"), value: funnel.joined },
    { label: t("app.insights.funnelSubmitted"), value: funnel.submitted },
    { label: t("app.insights.funnelApproved"), value: funnel.approved },
  ];
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.insights.funnelTitle")}</h2>
      <div className="mt-3 flex items-end gap-3">
        {stages.map((s) => (
          <div key={s.label} className="flex-1 text-center">
            <p className="font-display text-2xl font-bold">{fmtNumber(s.value)}</p>
            <p className="text-xs text-[var(--color-soft-ink)]">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-xs text-[var(--color-soft-ink)]">
        {`${t("app.insights.funnelJoined")} → ${t("app.insights.funnelSubmitted")}: ${fmtPct(funnel.joinToSubmit)} · ${t(
          "app.insights.funnelSubmitted",
        )} → ${t("app.insights.funnelApproved")}: ${fmtPct(funnel.submitToApprove)}`}
      </p>
    </div>
  );
}

function LevelBars({ levels }: { levels: Insights["levels"] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...levels.map((l) => l.count));
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.insights.levelsTitle")}</h2>
      <div className="mt-3 space-y-2">
        {levels.map((l) => (
          <div key={l.level} className="flex items-center gap-3">
            <span className={`level-pill level-pill-${l.level.toLowerCase()} w-14 justify-center`}>{l.level}</span>
            <div className="xp-bar flex-1">
              <div className="xp-bar-fill" style={{ width: `${(l.count / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right font-mono text-xs">{l.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WindowSelector({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const { t } = useI18n();
  const opts: Array<{ w: Win; label: string }> = [
    { w: 7, label: t("app.insights.window7") },
    { w: 30, label: t("app.insights.window30") },
    { w: 90, label: t("app.insights.window90") },
  ];
  return (
    <div className="flex gap-2">
      {opts.map((o) => (
        <button
          key={o.w}
          type="button"
          onClick={() => onChange(o.w)}
          aria-pressed={value === o.w}
          className={value === o.w ? "filter-pill filter-pill-active" : "filter-pill"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-acid skeleton-card" />
      ))}
    </div>
  );
}

function InsightsPage() {
  const { t, lang } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const [win, setWin] = useState<Win>(30);

  const q = useQuery({
    queryKey: adminKeys.insights(workspace, win),
    queryFn: () => fetchInsights(workspace, win),
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = useCanShowPreviousData(q, adminKeys.insights(workspace, win)) ? q.data?.insights : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t("app.insights.heading")}</h1>
        <WindowSelector value={win} onChange={setWin} />
      </div>

      <RequestFeedback error={q.error} retry={() => void q.refetch()} stale={Boolean(data)} />
      {!data ? (
        q.isError && !(q.error instanceof AdminAuthError) ? (
          null
        ) : (
          <InsightsSkeleton />
        )
      ) : (
        <>
          {data.window.timezone && <p className="text-sm [overflow-wrap:anywhere]">Asia/Hong_Kong · {new Intl.DateTimeFormat(lang === "en" ? "en-HK" : "zh-HK", {timeZone:"Asia/Hong_Kong",dateStyle:"medium"}).format(new Date(data.window.from))} ≤ day &lt; {new Intl.DateTimeFormat(lang === "en" ? "en-HK" : "zh-HK", {timeZone:"Asia/Hong_Kong",dateStyle:"medium"}).format(new Date(data.window.to))} · Complete calendar days / 完整香港曆日</p>}
          <p className="text-sm">Net posted ledger credits, including corrections. Pending reward is not credited cash or a payout. / 淨入帳含沖銷；待發獎勵不等於現金入帳或付款。</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.insights.kpiActiveCreators")} metric={data.kpis.activeCreators} format={fmtNumber} primary />
            <KpiCard label={t("app.insights.kpiCompletions")} metric={data.kpis.completions} format={fmtNumber} />
            <KpiCard label={t("app.insights.kpiSubmitToApprove")} metric={data.kpis.submitToApprove} format={fmtPct} />
            <KpiCard label={t("app.insights.kpiPointsIssued")} metric={data.kpis.pointsIssued} format={fmtNumber} />
            <KpiCard label={t("app.insights.kpiCashPaid")} metric={data.kpis.cashPaid} format={fmtCash} />
            <KpiCard label={t("app.insights.kpiMissionFillRate")} metric={data.kpis.missionFillRate} format={fmtPct} />
          </div>

          <div className="pastel-card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold">{t("app.insights.trendTitle")}</h2>
              <p className="font-mono text-[11px] text-[var(--color-soft-ink)]">
                {`${t("app.insights.trendJoined")} · ${t("app.insights.trendSubmitted")} · ${t("app.insights.trendApproved")}`}
              </p>
            </div>
            <TrendChart data={data.trend} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <FunnelView funnel={data.funnel} />
            <LevelBars levels={data.levels} />
          </div>
          {data.denominators && <p className="text-sm">Submitted-cohort approvals: {data.denominators.submitToApprove.numerator} / {data.denominators.submitToApprove.denominator}; joined-cohort submissions: {data.denominators.joinToSubmit.numerator} / {data.denominators.joinToSubmit.denominator}. Cancelled work is excluded. / 分母按同一批次，排除取消記錄。</p>}
          {data.outcomes && <section aria-label="Pilot outcomes" className="pastel-card space-y-3 p-5">
            <h2 className="font-heading text-lg font-bold">Pilot outcomes / 試行結果</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt>Join → first valid submission / 首次有效交稿</dt><dd>{data.outcomes.timeToFirstSubmissionMs.median === null ? "Not measured" : `${data.outcomes.timeToFirstSubmissionMs.median / 60000} min`} · n={data.outcomes.timeToFirstSubmissionMs.samples}</dd></div>
              <div><dt>First review accepted / 首次審稿接受</dt><dd>{data.outcomes.firstReviewAcceptance.numerator} / {data.outcomes.firstReviewAcceptance.denominator}</dd></div>
              <div><dt>Revision rounds / 修稿輪數</dt><dd>{data.outcomes.revisionRounds.mean ?? "Not measured"} · n={data.outcomes.revisionRounds.samples}</dd></div>
              <div><dt>Overdue required work / 必要交付逾期</dt><dd>{data.outcomes.overdue.numerator} / {data.outcomes.overdue.denominator}</dd></div>
              <div><dt>Operator handling / 營運處理時間</dt><dd>{data.outcomes.operatorHandlingMs === null ? "Not measured" : `${data.outcomes.operatorHandlingMs.median! / 60000} min · n=${data.outcomes.operatorHandlingMs.samples}`}</dd></div>
              <div><dt>Help due to unclear state / 狀態不明求助</dt><dd>Not measured: no saved support-request source / 尚無已保存的求助來源</dd></div>
            </dl>
          </section>}
        </>
      )}
    </div>
  );
}
