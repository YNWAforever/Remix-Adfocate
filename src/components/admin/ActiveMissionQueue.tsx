import type { ActiveMissionQueueItem, ActiveMissionRiskBucket, ActiveMissionReviewState } from "@/lib/admin";

export type ActiveMissionQueueUiFilters = {
  risk?: ActiveMissionRiskBucket;
  state?: ActiveMissionReviewState;
  reviewer?: string;
  mission?: string;
};

type Props = {
  items: ActiveMissionQueueItem[];
  filters?: ActiveMissionQueueUiFilters;
  onFiltersChange?: (filters: ActiveMissionQueueUiFilters) => void;
  now?: Date;
};

const FIELD = "h-10 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm";

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dueLabel(value: string | null, now: Date) {
  if (!value) return "No SLA deadline";
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "No SLA deadline";
  if (isoDay(due) === isoDay(now)) return "Due today";
  if (due.getTime() < now.getTime()) return "Overdue";
  return `Due ${due.toLocaleDateString()}`;
}

function submittedLabel(value: string | null, now: Date) {
  if (!value) return "Submission time unavailable";
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Submitted less than an hour ago";
  if (hours < 24) return `Submitted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Submitted ${days} day${days === 1 ? "" : "s"} ago`;
}

export function ActiveMissionQueue({ items, filters = {}, onFiltersChange, now = new Date() }: Props) {
  const update = (patch: Partial<ActiveMissionQueueUiFilters>) => {
    const next = { ...filters, ...patch };
    for (const key of Object.keys(next) as Array<keyof ActiveMissionQueueUiFilters>) {
      if (!next[key]) delete next[key];
    }
    onFiltersChange?.(next);
  };

  return (
    <section aria-labelledby="active-mission-queue-heading" className="space-y-4">
      <div>
        <h2 id="active-mission-queue-heading" className="font-display text-2xl font-bold">Active mission review</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">Review submitted deliverables in SLA order.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm font-bold">
          SLA risk
          <select className={FIELD} value={filters.risk ?? ""} onChange={(event) => update({ risk: event.target.value as ActiveMissionRiskBucket || undefined })}>
            <option value="">All SLA risk</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">Due soon</option>
            <option value="on_track">On track</option>
            <option value="no_sla">No SLA</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          State
          <select className={FIELD} value={filters.state ?? ""} onChange={(event) => update({ state: event.target.value as ActiveMissionReviewState || undefined })}>
            <option value="">All states</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          Reviewer
          <input className={FIELD} value={filters.reviewer ?? ""} onChange={(event) => update({ reviewer: event.target.value || undefined })} placeholder="Reviewer ID" />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          Mission
          <input className={FIELD} value={filters.mission ?? ""} onChange={(event) => update({ mission: event.target.value || undefined })} placeholder="Mission ID" />
        </label>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-sm">No active mission reviews match these filters.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item) => (
            <li key={item.workItemId} data-testid="queue-item" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[3px_3px_0_var(--color-ink)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-heading text-lg font-bold">{item.deliverableTitle}</p>
                  <p className="text-sm text-[var(--color-soft-ink)]">
                    <span>{item.missionTitle}</span>
                    <span> · </span>
                    <span>{item.creatorDisplayName}</span>
                  </p>
                </div>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-1 text-xs font-bold">{dueLabel(item.reviewDueAt, now)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="font-bold">SLA</dt><dd>{item.riskBucket.replace("_", " ")}</dd></div>
                <div><dt className="font-bold">Submitted</dt><dd>{submittedLabel(item.submittedAt, now).replace("Submitted ", "")}</dd></div>
                <div><dt className="font-bold">Creator deadline</dt><dd>{item.creatorDeadline ? new Date(item.creatorDeadline).toLocaleString() : "None"}</dd></div>
                <div><dt className="font-bold">Review owner</dt><dd>{item.reviewerId ?? "Unassigned"}</dd></div>
              </dl>
              <p className="mt-2 text-sm font-medium">{submittedLabel(item.submittedAt, now)}</p>
              <a href={`/admin/active-missions/${item.workflowId}?workItemId=${encodeURIComponent(item.workItemId)}`} className="mt-3 inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-4 py-2 font-heading text-sm font-bold">
                Review deliverable
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
