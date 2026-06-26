import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { acceptBrand } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand_/auth/callback")({ component: BrandCallback });

function BrandCallback() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) throw new Error("no auth code in callback URL");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        await acceptBrand();
        navigate({ to: "/brand" });
      } catch {
        setFailed(true);
      }
    })();
  }, [navigate]);
  if (failed) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-6">
        <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
        <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8 text-center">
          <span className="sticker">ADFOCATE</span>
          <p className="font-display text-lg font-bold text-[var(--color-ink)]">{t("app.brand.callbackFailed")}</p>
          <a href="/brand/login" className="btn-primary inline-flex">{t("app.brand.toLogin")}</a>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8 text-center">
        <span className="sticker">ADFOCATE</span>
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-ink)] border-t-transparent" aria-hidden="true" />
        <p className="font-display text-lg font-bold text-[var(--color-ink)]">{t("app.brand.callbackWorking")}</p>
      </div>
    </div>
  );
}
