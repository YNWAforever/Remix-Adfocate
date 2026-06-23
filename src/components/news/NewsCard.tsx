import { Link } from "@tanstack/react-router";
import type { NewsItem } from "@/lib/content";

export function NewsCard({ item }: { item: NewsItem }) {
  return (
    <Link
      to="/news/$slug"
      params={{ slug: item.slug }}
      className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 hover:bg-[var(--color-paper)]"
    >
      {item.coverImageUrl && (
        <img src={item.coverImageUrl} alt="" className="mb-2 aspect-video w-full rounded object-cover" />
      )}
      <div className="flex items-center gap-2 text-xs text-[var(--color-soft-ink)]">
        {item.category && (
          <span className="rounded-full border border-[var(--color-ink)] px-2">{item.category.label}</span>
        )}
        {item.kind === "announcement" && <span>📣</span>}
      </div>
      <h3 className="mt-1 font-heading font-bold">{item.title}</h3>
      {item.excerpt && (
        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-soft-ink)]">{item.excerpt}</p>
      )}
    </Link>
  );
}
