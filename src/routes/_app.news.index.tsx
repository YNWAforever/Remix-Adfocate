import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchNews, contentKeys } from "@/lib/content";
import { NewsCard } from "@/components/news/NewsCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/news/")({ component: NewsFeed });

export function NewsFeed() {
  const { t, lang } = useI18n();
  const filters = { lang };
  const { data, isLoading } = useQuery({
    queryKey: contentKeys.news(filters),
    queryFn: () => fetchNews(filters),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 lg:max-w-5xl">
      <h1 className="font-display text-xl font-bold">{t("app.news.title")}</h1>
      {isLoading ? (
        <p className="text-sm">…</p>
      ) : !data?.items.length ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.news.empty")}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.items.map((it) => (
            <NewsCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
