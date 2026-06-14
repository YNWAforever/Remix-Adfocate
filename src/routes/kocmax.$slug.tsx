import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, setWorkspaceSlug } from "@/lib/api";
import { useWorkspace, type Me } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/kocmax/$slug")({
  beforeLoad: async ({ params, location, context }) => {
    setWorkspaceSlug(params.slug);
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname.endsWith("/login") || location.pathname.includes("/auth/");
    const isOnboardingRoute = location.pathname.includes("/onboarding");

    if (!data.session && !isAuthRoute && !isOnboardingRoute) {
      throw redirect({ to: "/kocmax/$slug/login", params: { slug: params.slug } });
    }

    // Onboarding gate (defence in depth). Cached read → no per-navigation round-trip.
    if (data.session && !isAuthRoute && !isOnboardingRoute) {
      const me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: () => apiFetch<Me>("/me"),
      });
      if (me && me.onboarding_completed === false) {
        throw redirect({ to: "/kocmax/$slug/onboarding", params: { slug: params.slug } });
      }
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
