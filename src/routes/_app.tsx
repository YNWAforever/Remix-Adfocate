import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, setWorkspaceSlug, ApiError } from "@/lib/api";
import { resolveWorkspace } from "@/lib/workspace";
import { useWorkspace, type Me } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";
import { LevelUpModal } from "@/components/LevelUpModal";

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
      let me: Me | undefined;
      try {
        me = await context.queryClient.ensureQueryData({
          queryKey: ["me"],
          queryFn: () => apiFetch<Me>("/me"),
        });
      } catch (err) {
        // A stale / expired session makes /me return 401 — sign the dead session
        // out and send the user to login, rather than letting the error crash the
        // route into the default "Something went wrong" boundary.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          await supabase.auth.signOut({ scope: "local" });
          context.queryClient.removeQueries({ queryKey: ["me"] });
          throw redirect({ to: "/login" });
        }
        throw err;
      }
      if (me && me.onboarding_completed === false) {
        throw redirect({ to: "/onboarding" });
      }
    }
  },
  component: Layout,
});

function Layout() {
  const ws = useWorkspace();
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { if (ws.data?.theme) applyTheme(ws.data.theme); }, [ws.data]);
  const showNav = !(path === "/login" || path.startsWith("/auth/") || path.startsWith("/onboarding"));
  return (
    <div className={`min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]${showNav ? " pb-20 lg:pb-0 lg:pl-60" : ""}`}>
      {showNav && (
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:border-2 focus:border-[var(--color-ink)] focus:bg-[var(--color-acid)] focus:px-4 focus:py-2 focus:font-heading focus:font-bold"
        >
          跳至主要內容
        </a>
      )}
      {showNav && <SideNav />}
      <main id="main"><Outlet /></main>
      <LevelUpModal />
      {showNav && <BottomNav />}
    </div>
  );
}
