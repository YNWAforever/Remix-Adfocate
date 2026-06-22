import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { platformLabelKey, effortLabelKey } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="mb-2 font-heading font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function MissionBrief({ mission }: { mission: Mission }) {
  const { t } = useI18n();
  const deliverables = mission.deliverables ?? [];
  const requirements = mission.requirements ?? [];
  const platforms = mission.platforms ?? [];
  const effortKey = effortLabelKey(mission.effort);
  const dos = mission.dos ?? [];
  const donts = mission.donts ?? [];
  const keyMessages = mission.key_messages ?? [];
  const referenceLinks = mission.reference_links ?? [];
  const audience = mission.target_audience?.trim() || "";
  const hasAny =
    !!mission.description || deliverables.length > 0 || requirements.length > 0 ||
    platforms.length > 0 || !!effortKey ||
    !!audience || dos.length > 0 || donts.length > 0 ||
    keyMessages.length > 0 || referenceLinks.length > 0;

  if (!hasAny) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.mission.briefEmpty")}</p>;

  return (
    <div className="space-y-4">
      {mission.description && (
        <Section title={t("app.mission.briefAbout")}>
          <p className="text-sm text-[var(--color-soft-ink)]">{mission.description}</p>
        </Section>
      )}
      {deliverables.length > 0 && (
        <Section title={t("app.mission.briefDeliverables")}>
          <ul className="list-disc space-y-1 pl-5 text-sm">{deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </Section>
      )}
      {requirements.length > 0 && (
        <Section title={t("app.mission.briefRequirements")}>
          <ul className="list-disc space-y-1 pl-5 text-sm">{requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      )}
      {platforms.length > 0 && (
        <Section title={t("app.mission.briefPlatforms")}>
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <span key={p} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-heading font-bold">{t(platformLabelKey(p))}</span>
            ))}
          </div>
        </Section>
      )}
      {effortKey && (
        <Section title={t("app.mission.briefEffort")}>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{t(effortKey)}</span>
        </Section>
      )}
      {audience && <Section title={t("app.mission.briefAudience")}>{audience}</Section>}
      {dos.length > 0 && (
        <Section title={t("app.mission.briefDos")}>
          <ul className="space-y-1">
            {dos.map((d, i) => <li key={i}>✓ <span>{d}</span></li>)}
          </ul>
        </Section>
      )}
      {donts.length > 0 && (
        <Section title={t("app.mission.briefDonts")}>
          <ul className="space-y-1">
            {donts.map((d, i) => <li key={i}>✗ <span>{d}</span></li>)}
          </ul>
        </Section>
      )}
      {keyMessages.length > 0 && (
        <Section title={t("app.mission.briefKeyMessages")}>
          <ul className="list-disc space-y-1 pl-4">
            {keyMessages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </Section>
      )}
      {referenceLinks.length > 0 && (
        <Section title={t("app.mission.briefReferences")}>
          <ul className="space-y-1">
            {referenceLinks.map((url, i) => (
              <li key={i}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
