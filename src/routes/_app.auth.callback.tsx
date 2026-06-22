import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/auth/callback")({ component: Callback });

function Callback() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // PKCE landing for Google / magic-link: exchange the `?code=` for a session.
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) throw new Error("no auth code in callback URL");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        const next = params.get("next");
        // Only an exact /admin or /admin/* path skips creator bootstrap (the staff Google
        // sign-in flow). A strict match avoids /adminfoo and keeps a genuine creator flow
        // from accidentally skipping bootstrap on a crafted next param.
        if (next && /^\/admin(\/|$)/.test(next)) {
          // Staff Google login — do NOT run creator bootstrap (which would create a creator row).
          navigate({ to: next });
          return;
        }
        await finishAuth(navigate);
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
          <p className="font-display text-lg font-bold text-[var(--color-ink)]">
            {t("app.auth.callbackError")}
          </p>
          <p className="text-sm text-[var(--color-magenta)]">
            {tx("Something went sideways", "登入連線出現問題")}
          </p>
          <Link to="/login" className="btn-primary inline-flex">
            {t("app.auth.backToLogin")}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8 text-center">
        <span className="sticker">ADFOCATE</span>
        <div
          className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-ink)] border-t-transparent"
          aria-hidden="true"
        />
        <p className="font-display text-lg font-bold text-[var(--color-ink)]">
          {t("common.signingIn")}
        </p>
        <p className="tag-mono text-[var(--color-soft-ink)]">
          {tx("Securing your session", "正在建立連線")}
        </p>
      </div>
    </div>
  );
}
