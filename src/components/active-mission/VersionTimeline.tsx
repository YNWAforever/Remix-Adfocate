import type { MissionWorkflowEvent } from "@/lib/activeMission";

export type MissionVersionView = {
  id: string;
  versionNumber: number;
  state: "submitted" | "under_review" | "revision_requested" | "approved_to_publish";
  submittedAt: string;
  decisionAt: string | null;
};

type VersionTimelineProps = {
  versions: readonly MissionVersionView[];
  events: readonly MissionWorkflowEvent[];
};

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

const VERSION_LABELS: Record<MissionVersionView["state"], string> = {
  submitted: "Submitted",
  under_review: "Under review",
  revision_requested: "Changes requested",
  approved_to_publish: "Approved to publish — rewards are not issued yet",
};

const EVENT_LABELS: Record<string, string> = {
  review_started: "Review started",
  revision_requested: "Changes requested",
  draft_saved: "Draft saved",
  version_submitted: "Version submitted",
  fulfillment_received: "Delivery receipt confirmed",
  approved_to_publish: "Approved to publish — rewards are not issued yet",
};

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME.format(parsed);
}

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType]
    ?? eventType.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function VersionTimeline({ versions, events }: VersionTimelineProps) {
  const entries = [
    ...versions.map((version) => ({ kind: "version" as const, timestamp: version.decisionAt ?? version.submittedAt, value: version })),
    ...events.map((event) => ({ kind: "event" as const, timestamp: event.createdAt, value: event })),
  ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  return (
    <section aria-labelledby="version-history-heading" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h2 id="version-history-heading" className="font-heading text-lg font-bold">Version history</h2>
      {entries.length === 0 ? <p className="mt-3 text-sm text-[var(--color-soft-ink)]">No versions or activity yet.</p> : (
        <ol className="mt-4 space-y-3">
          {entries.map((entry) => entry.kind === "version" ? (
            <li key={`version-${entry.value.id}`} className="rounded-xl border border-[var(--color-ink)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-heading font-bold">Version {entry.value.versionNumber}</h3>
                <span className="rounded-full border border-[var(--color-ink)] px-2 py-1 text-xs font-semibold">{VERSION_LABELS[entry.value.state]}</span>
              </div>
              <div className="mt-2 grid gap-1 text-sm text-[var(--color-soft-ink)]">
                <p><span className="font-semibold text-[var(--color-ink)]">Submitted</span>{" "}<time dateTime={entry.value.submittedAt}>{displayTime(entry.value.submittedAt)}</time></p>
                {entry.value.decisionAt ? <p><span className="font-semibold text-[var(--color-ink)]">Decision time</span><time className="ml-1" dateTime={entry.value.decisionAt}>{displayTime(entry.value.decisionAt)}</time></p> : null}
              </div>
            </li>
          ) : (
            <li key={`event-${entry.value.id}`} className="rounded-xl border border-dashed border-[var(--color-ink)] p-3">
              <p className="font-semibold">{eventLabel(entry.value.eventType)}</p>
              <time className="mt-1 block text-sm text-[var(--color-soft-ink)]" dateTime={entry.value.createdAt}>{displayTime(entry.value.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
