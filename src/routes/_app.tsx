import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, setWorkspaceSlug } from "@/lib/api";
import { resolveWorkspace } from "@/lib/workspace";
import { useWorkspace, type Me } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location, context }) => {
    setWorkspaceSlug(resolveWorkspace());
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname === "/login" || location.pathname.startsWith("/auth/");
    const isOnboardingRoute = location.pathname.startsWith("/onboarding");

    // Onboarding requires a session too — only the login/callback routes are
    // reachable unauthenticated (else a typed /onboarding URL bypasses auth).
    if (!data.session && !isAuthRoute) {
      throw redirect({ to: "/login" });
    }

    // Onboarding gate (defence in depth). Cached read → no per-navigation round-trip.
    if (data.session && !isAuthRoute && !isOnboardingRoute) {
      const me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: () => apiFetch<Me>("/me"),
      });
      if (me && me.onboarding_completed === false) {
        throw redirect({ to: "/onboarding" });
      }
    }
  },
  component: Layout,
});

function Layout() {
  const ws = useWorkspace();
  useEffect(() => { if (ws.data?.theme) applyTheme(ws.data.theme); }, [ws.data]);
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] pb-20">
      <main><Outlet /></main>
      <BottomNav />
    </div>
  );
}
