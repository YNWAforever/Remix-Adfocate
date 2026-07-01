import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandAuthError, brandKeys, fetchBrandResources } from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/resources/")({ component: BrandResourcesList });

function BrandResourcesList() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const list = useQuery({ queryKey: brandKeys.resources(1), queryFn: () => fetchBrandResources(1), retry: false });

  useEffect(() => {
    if (list.error instanceof BrandAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("app.brand.resources.title")}</h1>
      {list.isLoading ? <p className="text-sm">{t("app.brand.resources.loading")}</p> : null}
      {!list.isLoading && (list.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.resources.empty")}</p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.data?.items.map((item) => (
          // Plain <a> (not TanStack's type-safe `Link`) because `/brand/resources/$slug`
          // doesn't exist as a route yet — it lands in Task 10. Swap to `Link` then.
          <a
            key={item.id}
            href={`/brand/resources/${item.slug}`}
            className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 hover:bg-[var(--color-paper)]"
          >
            {item.coverImageUrl && (
              <img src={item.coverImageUrl} alt="" className="mb-2 aspect-video w-full rounded object-cover" />
            )}
            <h3 className="font-heading font-bold">{item.title}</h3>
            {item.excerpt && (
              <p className="mt-1 line-clamp-2 text-sm text-[var(--color-soft-ink)]">{item.excerpt}</p>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
