import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { brandKeys, fetchBrandMe, BrandAuthError, type BrandMe } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export function BrandAuthGate({ children }: { children: (brand: BrandMe) => ReactNode }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: brandKeys.me(), queryFn: fetchBrandMe, retry: false });
  if (q.isLoading) return <div className="p-8 text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</div>;
  if (q.error) {
    const denied = q.error instanceof BrandAuthError;
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.brand.title")}</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">{t(denied ? "app.brand.noAccess" : "app.brand.loadError")}</p>
        <a href="/brand/login" className="block rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold">{t("app.brand.toLogin")}</a>
        <button type="button" onClick={() => supabase.auth.signOut()} className="text-xs underline">{t("app.brand.signOut")}</button>
      </div>
    );
  }
  return <>{children(q.data!.brand)}</>;
}
