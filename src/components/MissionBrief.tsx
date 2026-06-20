import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { platformLabel, effortLabel } from "@/lib/missionMeta";
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
  const effort = effortLabel(mission.effort);
  const hasAny =
    !!mission.description || deliverables.length > 0 || requirements.length > 0 || platforms.length > 0 || !!effort;

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
              <span key={p} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-heading font-bold">{platformLabel(p)}</span>
            ))}
          </div>
        </Section>
      )}
      {effort && (
        <Section title={t("app.mission.briefEffort")}>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{effort}</span>
        </Section>
      )}
    </div>
  );
}
