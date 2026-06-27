import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandInsights, type BrandInsights, type BrandMetric } from "@/lib/brand";
import { TrendChart } from "@/components/admin/TrendChart";

export const Route = createFileRoute("/brand/insights")({ component: BrandInsightsPage });

type Win = 7 | 30 | 90;
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n}%`;
const fmtCash = (n: number) => `HK$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DeltaBadge({ metric }: { metric: BrandMetric }) {
  if (metric.deltaPct === null) return null;
  const up = metric.deltaPct > 0;
  const flat = metric.deltaPct === 0;
  const cls = flat ? "metric-badge" : up ? "metric-badge metric-up" : "metric-badge metric-down";
  return <span className={cls}>{`${up ? "+" : ""}${metric.deltaPct}%`}</span>;
}

function KpiCard({ label, metric, format }: { label: string; metric: BrandMetric; format: (n: number) => string }) {
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

function WindowSelector({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const { t } = useI18n();
  const opts: Array<{ w: Win; label: string }> = [
    { w: 7, label: t("app.brand.insights.window7") },
    { w: 30, label: t("app.brand.insights.window30") },
    { w: 90, label: t("app.brand.insights.window90") },
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

function TopCreators({ rows }: { rows: BrandInsights["topCreators"] }) {
  const { t } = useI18n();
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.brand.insights.topCreators")}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{t("app.brand.insights.topCreatorsEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.creatorId} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{r.name}</span>
              <span className="font-mono text-xs text-[var(--color-soft-ink)]">
                {r.approved} · {r.avgQuality}★
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrandInsightsPage() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const [win, setWin] = useState<Win>(30);
  const q = useQuery({ queryKey: brandKeys.insights(win), queryFn: () => fetchBrandInsights(win), retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = q.data?.insights;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t("app.brand.insights.heading")}</h1>
        <WindowSelector value={win} onChange={setWin} />
      </div>

      {!data ? (
        q.isError && !(q.error instanceof BrandAuthError) ? (
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.insights.loadError")}</p>
        ) : (
          <p className="text-sm">載入中…</p>
        )
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t("app.brand.insights.groupPerformance")}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.brand.insights.liveMissions")} metric={data.kpis.liveMissions} format={fmtNum} />
            <KpiCard label={t("app.brand.insights.fillRate")} metric={data.kpis.missionFillRate} format={fmtPct} />
            <KpiCard label={t("app.brand.insights.submissions")} metric={data.kpis.submissionsReceived} format={fmtNum} />
            <KpiCard label={t("app.brand.insights.approvalRate")} metric={data.kpis.approvalRate} format={fmtPct} />
            <KpiCard label={t("app.brand.insights.completions")} metric={data.kpis.completions} format={fmtNum} />
          </div>

          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t("app.brand.insights.groupSpend")}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.brand.insights.cashPaid")} metric={data.kpis.cashPaid} format={fmtCash} />
            <KpiCard label={t("app.brand.insights.costPerDeliverable")} metric={data.kpis.costPerDeliverable} format={fmtCash} />
            <KpiCard label={t("app.brand.insights.pointsDistributed")} metric={data.kpis.pointsDistributed} format={fmtNum} />
          </div>

          <div className="pastel-card p-5">
            <h2 className="mb-2 font-heading text-base font-bold">{t("app.brand.insights.trendTitle")}</h2>
            <TrendChart data={data.trend} />
          </div>

          <TopCreators rows={data.topCreators} />
        </>
      )}
    </div>
  );
}
