import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, WORKSPACE_SLUG } from "@/lib/api";

export const Route = createFileRoute("/kocmax/$slug/auth/callback")({ component: Callback });

function Callback() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await supabase.auth.getSession(); // Supabase parses the OAuth result
        await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug: WORKSPACE_SLUG }) });
        // refresh so the token carries workspace_id; a failed refresh is fatal (reported via
        // a returned { error }, not a throw), so re-throw it into the catch below.
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        navigate({ to: "/kocmax/$slug", params: { slug } });
      } catch {
        // Bootstrap/network failure — don't leave an unhandled rejection that strands
        // the user on a blank "登入中…"; show a recoverable error instead.
        setFailed(true);
      }
    })();
  }, [slug, navigate]);
  if (failed) {
    return (
      <div className="mx-auto max-w-sm space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">登入未能完成，請重新登入</p>
        <Link
          to="/kocmax/$slug/login"
          params={{ slug }}
          className="btn-primary inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-2 font-heading font-bold text-[var(--color-ink)]"
        >
          返回登入
        </Link>
      </div>
    );
  }
  return <div className="p-8">登入中…</div>;
}
