import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand_/login")({ component: BrandLogin });

function BrandLogin() {
  const { t, lang, setLang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/brand/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-paper)] px-4 py-10">
      <div aria-hidden className="dot-pattern pointer-events-none absolute inset-0 z-0 opacity-30" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-xl font-bold tracking-tight text-[var(--color-ink)]">
            Adfocate<span className="text-[var(--color-magenta)]">.</span>
          </span>
          <button type="button" onClick={() => setLang(lang === "en" ? "zh" : "en")} className="tag-mono" aria-label={tx("Switch language", "切換語言")}>
            EN · 繁
          </button>
        </div>
        <div className="pastel-card p-6 sm:p-8">
          <span className="sticker">{tx("BRAND ACCESS", "品牌登入")}</span>
          <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-ink)]">{t("app.brand.loginHeading")}</h1>
          {error && <p className="mt-3 text-sm text-[var(--color-magenta)]">{error}</p>}
          {sent ? (
            <p className="mt-4 text-sm text-[var(--color-soft-ink)]">{t("app.brand.loginCheckEmail")}</p>
          ) : (
            <form onSubmit={sendLink} className="mt-4 space-y-3">
              <label className="block text-sm text-[var(--color-soft-ink)]">
                {t("app.brand.loginEmailLabel")}
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@brand.com"
                  className="mt-1 w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
                  aria-label={t("app.brand.loginEmailLabel")}
                />
              </label>
              <button type="submit" disabled={busy} className="btn-ink w-full disabled:opacity-50">
                {busy ? t("app.login.sending") : t("app.brand.loginSend")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
