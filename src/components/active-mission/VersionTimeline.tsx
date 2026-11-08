import { useId } from "react";
import type { MissionWorkflowEvent } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";
import { formatHongKongDateTime } from "@/lib/creatorFormatting";

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

const VERSION_KEYS: Record<MissionVersionView["state"], string> = {
  submitted: "app.activeMission.timeline.state.submitted",
  under_review: "app.activeMission.timeline.state.underReview",
  revision_requested: "app.activeMission.timeline.state.changesRequested",
  approved_to_publish: "app.activeMission.timeline.state.approvedToPublish",
};

const EVENT_KEYS: Record<string, string> = {
  review_started: "app.activeMission.timeline.event.reviewStarted",
  revision_requested: "app.activeMission.timeline.event.changesRequested",
  draft_saved: "app.activeMission.timeline.event.draftSaved",
  version_submitted: "app.activeMission.timeline.event.versionSubmitted",
  fulfillment_received: "app.activeMission.timeline.event.receiptConfirmed",
  approved_to_publish: "app.activeMission.timeline.event.approvedToPublish",
};

function displayTime(value: string, locale: string): string {
  return formatHongKongDateTime(value, locale, true);
}

export function VersionTimeline({ versions, events }: VersionTimelineProps) {
  const headingId = useId();
  const entries = [
    ...versions.map((version) => ({ kind: "version" as const, timestamp: version.decisionAt ?? version.submittedAt, value: version })),
    ...events.map((event) => ({ kind: "event" as const, timestamp: event.createdAt, value: event })),
  ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const { lang, t } = useI18n();

  return (
    <section aria-labelledby={headingId} className="s-card s-stack">
      <h2 id={headingId}>{t("app.activeMission.timeline.title")}</h2>
      {entries.length === 0 ? <p className="s-muted">{t("app.activeMission.timeline.empty")}</p> : (
        <ol className="s-version-list">
          {entries.map((entry) => entry.kind === "version" ? (
            <li key={`version-${entry.value.id}`} className="s-version-entry">
              <div className="s-between">
                <h3>{t("app.activeMission.timeline.version", { number: entry.value.versionNumber })}</h3>
                <span className="s-tag">{t(VERSION_KEYS[entry.value.state])}</span>
              </div>
              <div className="s-version-meta">
                <p><span>{t("app.activeMission.timeline.submittedAt")}</span>{" "}<time dateTime={entry.value.submittedAt}>{displayTime(entry.value.submittedAt, lang === "zh" ? "zh-HK" : "en-US")}</time></p>
                {entry.value.decisionAt ? <p><span>{t("app.activeMission.timeline.decisionTime")}</span><time dateTime={entry.value.decisionAt}>{displayTime(entry.value.decisionAt, lang === "zh" ? "zh-HK" : "en-US")}</time></p> : null}
              </div>
            </li>
          ) : (
            <li key={`event-${entry.value.id}`} className="s-version-entry event">
              <p>{EVENT_KEYS[entry.value.eventType] ? t(EVENT_KEYS[entry.value.eventType]) : t("app.activeMission.timeline.event.unknown", { event: entry.value.eventType.replaceAll("_", " ") })}</p>
              <time dateTime={entry.value.createdAt}>{displayTime(entry.value.createdAt, lang === "zh" ? "zh-HK" : "en-US")}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
