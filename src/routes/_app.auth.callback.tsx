import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/auth/callback")({ component: Callback });

function Callback() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // PKCE landing for Google / magic-link: exchange the `?code=` for a session.
        const code = new URLSearchParams(window.location.search).get("code");
        if (!code) throw new Error("no auth code in callback URL");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        await finishAuth(navigate);
      } catch {
        setFailed(true);
      }
    })();
  }, [navigate]);
  if (failed) {
    return (
      <div className="mx-auto max-w-sm space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.auth.callbackError")}</p>
        <Link
          to="/login"
          className="btn-primary inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-2 font-heading font-bold text-[var(--color-ink)]"
        >
          {t("app.auth.backToLogin")}
        </Link>
      </div>
    );
  }
  return <div className="p-8">{t("app.auth.loading")}</div>;
}
