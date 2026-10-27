// src/routes/admin.radar.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AdminAuthError,
  adminKeys,
  fetchRadar,
  type Radar,
  type RadarAtRiskRow,
  type RadarOverdueRow,
  type RadarRisingRow,
  type RadarNewCreatorRow,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/radar")({ component: RadarPage });

// --- Sub-components -----------------------------------------------------------

function MoreIndicator({ queue }: { queue: { items: unknown[]; total: number } }) {
  const { t } = useI18n();
  const remaining = queue.total - queue.items.length;
  if (remaining <= 0) return null;
  return (
    <p className="mt-2 text-center font-mono text-xs text-[var(--color-soft-ink)]">
      {t("app.radar.moreItems", { n: remaining })}
    </p>
  );
}

function QueueCard({
  titleKey,
  emptyKey,
  total,
  children,
}: {
  titleKey: string;
  emptyKey: string;
  total: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="pastel-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-heading text-base font-bold">{t(titleKey)}</h2>
        <span className="rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-xs">
          {total}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t(emptyKey)}</p>
      ) : (
        children
      )}
    </div>
  );
}

function AtRiskList({ queue }: { queue: Radar["atRisk"] }) {
  const { t } = useI18n();
  return (
    <QueueCard titleKey="app.radar.atRiskTitle" emptyKey="app.radar.atRiskEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarAtRiskRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold">{row.display_name ?? row.phone ?? row.creator_id}</p>
            </div>
            <span className="font-mono text-xs text-[var(--color-soft-ink)]">
              {t("app.radar.daysIdle", { n: row.days_idle })}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function SlaList({ queue }: { queue: Radar["slaBreaching"] }) {
  const { t } = useI18n();
  const { workspace } = useAdminWorkspace();
  return (
    <QueueCard titleKey="app.radar.slaTitle" emptyKey="app.radar.slaEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarOverdueRow) => (
          <li key={row.submission_id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold">{row.display_name ?? row.creator_id}</p>
              <a href={`/admin/submissions?submission_id=${encodeURIComponent(row.submission_id)}&ws=${encodeURIComponent(workspace)}`} className="text-xs font-bold underline">{row.mission_title} · 處理 / Review</a>
            </div>
            <span
              className={`font-mono text-xs ${
                row.urgency === "overdue" ? "metric-badge metric-down" : "text-[var(--color-soft-ink)]"
              }`}
            >
              {row.urgency === "overdue"
                ? t("app.radar.hoursOverdue", { n: row.hours_overdue })
                : t("app.radar.dueSoon")}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function RisingList({ queue }: { queue: Radar["rising"] }) {
  return (
    <QueueCard titleKey="app.radar.risingTitle" emptyKey="app.radar.risingEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarRisingRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className={`level-pill level-pill-${row.level.toLowerCase()}`}>{row.level}</span>
              <p className="text-sm font-semibold">{row.display_name ?? row.creator_id}</p>
            </div>
            <span className="font-mono text-xs text-[var(--color-ink)]">
              {row.recent_approvals}✓ {row.avg_quality !== null ? `★${row.avg_quality}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function NewList({ queue }: { queue: Radar["newUnactivated"] }) {
  const { t } = useI18n();
  return (
    <QueueCard titleKey="app.radar.newTitle" emptyKey="app.radar.newEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarNewCreatorRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <p className="text-sm font-semibold">{row.display_name ?? row.phone ?? row.creator_id}</p>
            <span className="font-mono text-xs text-[var(--color-soft-ink)]">
              {t("app.radar.daysSinceJoin", { n: row.days_since_join })}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function RadarSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton-acid skeleton-card h-48" />
      ))}
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

function RadarPage() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();

  const q = useQuery({
    queryKey: adminKeys.radar(workspace, 30),
    queryFn: () => fetchRadar(workspace, 30),
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = q.data?.radar;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("app.radar.heading")}</h1>

      {!data ? (
        q.isError && !(q.error instanceof AdminAuthError) ? (
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.radar.loadError")}</p>
        ) : (
          <RadarSkeleton />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AtRiskList queue={data.atRisk} />
          <SlaList queue={data.slaBreaching} />
          <RisingList queue={data.rising} />
          <NewList queue={data.newUnactivated} />
        </div>
      )}
    </div>
  );
}
