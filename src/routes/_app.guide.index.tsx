import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { guideDocs } from "@/data/guideDocs";
import { playbooks, resources, academyTracks } from "@/data/academy";
import { GuideDocList } from "@/components/GuideDocList";
import { PlaybookCard } from "@/components/PlaybookCard";
import { AcademyTrackCard } from "@/components/AcademyTrackCard";
import { getRead } from "@/lib/guideProgress";

export const Route = createFileRoute("/_app/guide/")({ component: GuideHub });

function GuideHub() {
  const me = useMe();
  const { t } = useI18n();
  const effective = me.data?.effective_level ?? me.data?.level;
  const creatorId = me.data?.id;
  const readCount = creatorId ? guideDocs.filter((d) => getRead(creatorId).has(d.id)).length : 0;

  return (
    <div className="mx-auto max-w-lg p-4 lg:max-w-5xl space-y-6">
      <h1 className="font-display text-xl font-bold">{t("app.guide.title")}</h1>

      <section className="space-y-2">
        <h2 className="font-heading font-bold">{t("app.guide.sectionGuides")}</h2>
        <GuideDocList creatorId={creatorId} />
      </section>

      <section className="space-y-2">
        <h2 className="font-heading font-bold">{t("app.guide.sectionPlaybooks")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {[...playbooks, ...resources].map((p) => (
            <PlaybookCard key={"id" in p ? p.id : p.industry} item={p} />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold">{t("app.guide.sectionAcademy")}</h2>
          {creatorId && (
            <span className="text-xs text-[var(--color-soft-ink)]">
              {t("app.guide.progress", { done: readCount, total: guideDocs.length })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {academyTracks.map((tr) => (
            <AcademyTrackCard key={tr.id} track={tr} effectiveLevel={effective} />
          ))}
        </div>
      </section>
    </div>
  );
}
