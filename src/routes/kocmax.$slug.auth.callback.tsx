import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, WORKSPACE_SLUG } from "@/lib/api";

export const Route = createFileRoute("/kocmax/$slug/auth/callback")({ component: Callback });

function Callback() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      await supabase.auth.getSession(); // Supabase parses the OAuth result
      await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug: WORKSPACE_SLUG }) });
      await supabase.auth.refreshSession(); // refresh so the token carries workspace_id
      navigate({ to: "/kocmax/$slug", params: { slug } });
    })();
  }, [slug, navigate]);
  return <div className="p-8">登入中…</div>;
}
