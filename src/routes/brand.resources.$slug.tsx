import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandAuthError, brandKeys, fetchBrandResource } from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { Markdown } from "@/components/Markdown";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/resources/$slug")({ component: BrandResourceDetail });

function BrandResourceDetail() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const { slug } = useParams({ from: "/brand/resources/$slug" });
  const item = useQuery({ queryKey: brandKeys.resource(slug), queryFn: () => fetchBrandResource(slug), retry: false });

  useEffect(() => {
    if (item.error instanceof BrandAuthError) reportAuthError(item.error);
  }, [item.error, reportAuthError]);

  if (item.isLoading) return <div className="p-4 text-sm">{t("app.brand.resources.loading")}</div>;
  if (!item.data) return <div className="p-4 text-sm">{t("app.brand.resources.empty")}</div>;
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-4">
      {item.data.item.coverImageUrl && (
        <img
          src={item.data.item.coverImageUrl}
          alt=""
          className="aspect-video w-full rounded-[var(--radius)] object-cover"
        />
      )}
      <h1 className="font-display text-2xl font-bold">{item.data.item.title}</h1>
      {item.data.item.body && <Markdown source={item.data.item.body} />}
    </article>
  );
}
