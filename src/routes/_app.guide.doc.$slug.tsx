import { useEffect } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { Markdown } from "@/components/Markdown";
import { academyKeys, fetchAcademyDoc } from "@/lib/academy";
import { markRead } from "@/lib/guideProgress";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/doc/$slug")({ component: GuideDocPage });

function GuideDocPage() {
  const { slug } = useParams({ from: "/_app/guide/doc/$slug" });
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.doc(slug, uiLang), queryFn: () => fetchAcademyDoc(slug, uiLang), retry: false });
  const doc = q.data?.item;

  useEffect(() => { if (doc) markRead(me.data?.id, slug); }, [doc, me.data?.id, slug]);

  // apiFetch throws on a 404, so a missing slug lands the query in the error state.
  // Gate not-found on q.isError (never on pending) so a valid slug can't false-fire while loading.
  if (q.isLoading) return <div className="p-4 text-sm">…</div>;
  if (q.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.docNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }
  if (!doc) return <div className="p-4 text-sm">…</div>;

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="truncate font-heading font-semibold">{doc.title}</h1>
      </header>
      <div className="p-4"><Markdown source={doc.body ?? ""} /></div>
    </div>
  );
}
