import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/kocmax/$slug")({
  beforeLoad: async ({ params, location }) => {
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname.endsWith("/login") || location.pathname.includes("/auth/");
    if (!data.session && !isAuthRoute) {
      throw redirect({ to: "/kocmax/$slug/login", params: { slug: params.slug } });
    }
  },
  component: Layout,
});

function Layout() {
  const { slug } = Route.useParams();
  const ws = useWorkspace();
  useEffect(() => { if (ws.data?.theme) applyTheme(ws.data.theme); }, [ws.data]);
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] pb-20">
      <main><Outlet /></main>
      <BottomNav slug={slug} />
    </div>
  );
}
