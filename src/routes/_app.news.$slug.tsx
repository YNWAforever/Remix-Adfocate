import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchNewsItem, contentKeys } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { NewsCard } from "@/components/news/NewsCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/news/$slug")({ component: NewsDetail });

function NewsDetail() {
  const { t, lang } = useI18n();
  const { slug } = useParams({ from: "/_app/news/$slug" });
  const { data, isLoading } = useQuery({
    queryKey: contentKeys.newsItem(slug, lang),
    queryFn: () => fetchNewsItem(slug, lang),
  });
  if (isLoading) return <div className="p-4 text-sm">…</div>;
  if (!data) return <div className="p-4 text-sm">{t("app.news.empty")}</div>;
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-4">
      {data.item.coverImageUrl && (
        <img
          src={data.item.coverImageUrl}
          alt=""
          className="aspect-video w-full rounded-[var(--radius)] object-cover"
        />
      )}
      <h1 className="font-display text-2xl font-bold">{data.item.title}</h1>
      {data.item.body && <Markdown source={data.item.body} />}
      {data.related.length > 0 && (
        <section className="space-y-2 border-t-2 border-[var(--color-ink)] pt-4">
          <h2 className="font-heading font-bold">{t("app.news.related")}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.related.map((r) => (
              <NewsCard key={r.id} item={r} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
