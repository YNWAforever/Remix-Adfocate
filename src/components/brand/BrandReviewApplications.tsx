import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import {
  BrandAuthError,
  brandKeys,
  fetchBrandApplications,
  acceptBrandApplication,
  declineBrandApplication,
} from "@/lib/brand";
import { AdminRequestError } from "@/lib/admin";

export function BrandReviewApplications() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: brandKeys.applications(), queryFn: fetchBrandApplications, retry: false });
  useEffect(() => {
    if (apps.error instanceof BrandAuthError) reportAuthError(apps.error);
  }, [apps.error, reportAuthError]);

  const onErr = (e: unknown) => {
    if (e instanceof BrandAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      action === "accept" ? acceptBrandApplication(id) : declineBrandApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: brandKeys.applications() }),
    onError: onErr,
  });

  if (apps.isLoading) return <p className="text-sm">載入中…</p>;
  if (apps.data?.applications.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.applicationsEmpty")}</p>;

  return (
    <div className="space-y-3">
      {apps.data?.applications.map((a) => (
        <div
          key={a.id}
          className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          <div className="min-w-0 space-y-1">
            <p className="font-heading font-bold">{a.creators.display_name}</p>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              aria-label={t("app.brand.review.accept")}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: a.id, action: "accept" })}
              className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold"
            >
              {t("app.brand.review.accept")}
            </button>
            <button
              aria-label={t("app.brand.review.decline")}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: a.id, action: "decline" })}
              className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold"
            >
              {t("app.brand.review.decline")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
