import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMe } from "@/lib/queries/kocmax";
import { Markdown } from "@/components/Markdown";
import { guideDocs } from "@/data/guideDocs";
import { markRead } from "@/lib/guideProgress";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/doc/$slug")({ component: GuideDocPage });

function GuideDocPage() {
  const { slug } = Route.useParams();
  const me = useMe();
  const { t } = useI18n();

  const doc = guideDocs.find((d) => d.id === slug);

  useEffect(() => {
    if (doc) markRead(me.data?.id, slug);
  }, [doc, me.data?.id, slug]);

  if (!doc) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.docNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="truncate font-heading font-semibold">{t(doc.titleKey)}</h1>
      </header>

      <div className="p-4">
        <Markdown source={doc.body} />
      </div>
    </div>
  );
}
