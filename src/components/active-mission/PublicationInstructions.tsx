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
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-soft-ink)]">{copy("app.admin.missionEditor.previewGuidance", "Frozen guidance")}</p>
          <h2 id={headingId} className="mt-1 font-heading text-xl font-bold">{copy("app.admin.missionEditor.publicationInstructions", "Publication instructions")}</h2>
        </div>
        {!props.preview ? <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold">
          {approvedVersionLabel(props.publication.approvedVersionId)}
        </span> : null}
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{copy("app.mission.cardPlatform", "Platform")}</dt>
          <dd className="mt-1 font-semibold">{props.preview ? publication.platform ? t(platformLabelKey(publication.platform)) : t("app.mission.notProvided") : displayPlatform(publication.platform)}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{copy("app.admin.missionEditor.expectedAccount", "Expected account")}</dt>
          <dd className="mt-1 font-semibold">{instructions.expectedAccount ?? copy("app.mission.notProvided", "Use your approved account")}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{copy("app.admin.missionEditor.previewDeadline", "Publication deadline")}</dt>
          <dd className="mt-1">
            {props.preview ? Number.isInteger(props.publicationWindowHours) && props.publicationWindowHours > 0
              ? t("app.admin.missionEditor.afterApprovalHours", { hours: props.publicationWindowHours }) : t("app.mission.notProvided")
              : <time dateTime={props.publication.instructions.publishDueAt}>{new Date(props.publication.instructions.publishDueAt).toLocaleString()}</time>}
          </dd>
        </div>
      </dl>

      <div className="mt-5 rounded-2xl bg-[var(--color-paper)] p-4">
        <p className="whitespace-pre-wrap text-sm leading-6">{instructions.publicationInstructions}</p>
      </div>

      {instructions.requiredDisclosures.length > 0 ? (
        <div className="mt-5">
          <h3 className="font-heading text-sm font-bold">{copy("app.admin.missionEditor.requiredDisclosures", "Required disclosures")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {instructions.requiredDisclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
          </ul>
        </div>
      ) : null}

      <p className="mt-5 rounded-xl border border-[var(--color-ink)] px-3 py-2 text-sm font-semibold">
        {publicationEvidenceRequired(instructions.proofEvidencePolicy) ? copy("app.admin.missionEditor.evidenceRequired", "Evidence is required") : copy("app.admin.missionEditor.evidenceOptional", "Evidence is optional")}
      </p>
    </section>
  );
}
