import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { academyKeys, fetchAcademy } from "@/lib/academy";
import { GuideDocList } from "@/components/GuideDocList";
import { PlaybookCard } from "@/components/PlaybookCard";
import { AcademyTrackCard } from "@/components/AcademyTrackCard";
import { getRead } from "@/lib/guideProgress";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/_app/guide/")({ component: GuideHub });

function GuideHub() {
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.bundle(uiLang), queryFn: () => fetchAcademy(uiLang), retry: false });
  const bundle = useCanShowPreviousData(q, academyKeys.bundle(uiLang)) ? q.data : undefined;

  const creatorLevel = me.data?.level;
  const isTrusted = me.data?.is_trusted ?? false;
  const creatorId = me.data?.id;
  const readIds = creatorId ? getRead(creatorId) : new Set<string>();
  const docs = bundle?.docs ?? [];
  const readCount = docs.filter((d) => readIds.has(d.slug)).length;

  return (
    <div className="mx-auto max-w-lg p-4 lg:max-w-5xl space-y-6">
      <h1 className="font-display text-xl font-bold">{t("app.guide.title")}</h1>
      <RequestFeedback error={q.error} stale={Boolean(bundle)} retry={() => void q.refetch()} />
      <RequestFeedback error={me.error} retry={() => void me.refetch()} />

      {q.isLoading ? (
        <p className="text-sm text-[var(--color-soft-ink)]">…</p>
      ) : bundle ? (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.guide.sectionGuides")}</h2>
            <GuideDocList docs={docs} readIds={readIds} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.guide.sectionPlaybooks")}</h2>
            <div className="grid grid-cols-2 gap-3">
              {bundle.playbooks.map((p) => <PlaybookCard key={p.slug} item={p} />)}
              {bundle.resources.map((r) => <PlaybookCard key={r.slug} item={r} />)}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold">{t("app.guide.sectionAcademy")}</h2>
              {creatorId && docs.length > 0 && (
                <span className="text-xs text-[var(--color-soft-ink)]">
                  {t("app.guide.progress", { done: readCount, total: docs.length })}
                </span>
              )}
            </div>
            {!q.isError && bundle.tracks.length === 0 && <p role="status" className="text-sm text-[var(--color-soft-ink)]">目前沒有可顯示的課程。 / No courses available.</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!me.error && !me.isLoading && bundle.tracks.map((tr) => (
                <AcademyTrackCard key={tr.slug} track={tr} creatorLevel={creatorLevel} isTrusted={isTrusted} />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
