import { useId } from "react";
import { publicationEvidenceRequired, type MissionPublicationView, type MissionPublicationInstructionsView } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";
import { platformLabelKey } from "@/lib/missionMeta";

type Props = {
  publication: MissionPublicationView;
  preview?: false;
} | {
  publication: { platform: string; instructions: Pick<MissionPublicationInstructionsView, "publicationInstructions" | "requiredDisclosures" | "expectedAccount" | "proofEvidencePolicy"> };
  preview: true;
  publicationWindowHours: number;
};

function displayPlatform(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Not specified";
}

function approvedVersionLabel(id: string | null): string {
  if (!id) return "Approved version";
  const match = id.match(/(\d+)$/);
  return match ? `Approved version ${match[1]}` : "Approved version";
}

export function PublicationInstructions(props: Props) {
  const { publication } = props;
  const { t } = useI18n();
  const copy = (key: string, existing: string) => props.preview ? t(key) : existing;
  const headingId = useId();
  const { instructions } = publication;
  const preview = Boolean(props.preview);
  return (
    <section
      aria-labelledby={headingId}
      className={preview
        ? "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-sm)]"
        : "s-card s-stack"}
    >
      <div className={preview ? "flex flex-wrap items-start justify-between gap-3" : "s-between"}>
        <div className={preview ? "" : "s-stack"} style={preview ? undefined : { gap: 6 }}>
          <p className={preview ? "font-heading text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-soft-ink)]" : "s-eyebrow"}>
            {copy("app.admin.missionEditor.previewGuidance", "Frozen guidance")}
          </p>
          <h2 id={headingId} className={preview ? "mt-1 font-heading text-xl font-bold" : ""}>
            {copy("app.admin.missionEditor.publicationInstructions", "Publication instructions")}
          </h2>
        </div>
        {props.preview ? null : <span className="s-tag mint">{approvedVersionLabel(props.publication.approvedVersionId)}</span>}
      </div>

      <dl className={preview ? "mt-5 grid gap-4 sm:grid-cols-2" : "s-row"} style={preview ? undefined : { gap: "12px 32px", alignItems: "flex-start", margin: 0 }}>
        <div>
          <dt className={preview ? "text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]" : "s-eyebrow"} style={preview ? undefined : { fontSize: 11 }}>
            {copy("app.mission.cardPlatform", "Platform")}
          </dt>
          <dd className={preview ? "mt-1 font-semibold" : ""} style={preview ? undefined : { margin: 0, fontWeight: 600 }}>
            {props.preview ? publication.platform ? t(platformLabelKey(publication.platform)) : t("app.mission.notProvided") : displayPlatform(publication.platform)}
          </dd>
        </div>
        <div>
          <dt className={preview ? "text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]" : "s-eyebrow"} style={preview ? undefined : { fontSize: 11 }}>
            {copy("app.admin.missionEditor.expectedAccount", "Expected account")}
          </dt>
          <dd className={preview ? "mt-1 font-semibold" : ""} style={preview ? undefined : { margin: 0, fontWeight: 600 }}>
            {instructions.expectedAccount ?? copy("app.mission.notProvided", "Use your approved account")}
          </dd>
        </div>
        <div className={preview ? "sm:col-span-2" : ""}>
          <dt className={preview ? "text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]" : "s-eyebrow"} style={preview ? undefined : { fontSize: 11 }}>
            {copy("app.admin.missionEditor.previewDeadline", "Publication deadline")}
          </dt>
          <dd className={preview ? "mt-1" : ""} style={preview ? undefined : { margin: 0 }}>
            {props.preview ? Number.isInteger(props.publicationWindowHours) && props.publicationWindowHours > 0
              ? t("app.admin.missionEditor.afterApprovalHours", { hours: props.publicationWindowHours }) : t("app.mission.notProvided")
              : <time dateTime={props.publication.instructions.publishDueAt}>{new Date(props.publication.instructions.publishDueAt).toLocaleString()}</time>}
          </dd>
        </div>
      </dl>

      <div className={preview ? "mt-5 rounded-2xl bg-[var(--color-paper)] p-4" : "s-note"} style={preview ? undefined : { alignItems: "flex-start" }}>
        <p className={preview ? "whitespace-pre-wrap text-sm leading-6" : "whitespace-pre-wrap"}>{instructions.publicationInstructions}</p>
      </div>

      {instructions.requiredDisclosures.length > 0 ? (
        <div className={preview ? "mt-5" : "s-stack"} style={preview ? undefined : { gap: 8 }}>
          <h3 className={preview ? "font-heading text-sm font-bold" : ""}>{copy("app.admin.missionEditor.requiredDisclosures", "Required disclosures")}</h3>
          <ul className={preview ? "mt-2 list-disc space-y-1 pl-5 text-sm" : "s-list-check"}>
            {instructions.requiredDisclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
          </ul>
        </div>
      ) : null}

      <p className={preview ? "mt-5 rounded-xl border border-[var(--color-ink)] px-3 py-2 text-sm font-semibold" : "s-tag ghost"}>
        {publicationEvidenceRequired(instructions.proofEvidencePolicy) ? copy("app.admin.missionEditor.evidenceRequired", "Evidence is required") : copy("app.admin.missionEditor.evidenceOptional", "Evidence is optional")}
      </p>
    </section>
  );
}
