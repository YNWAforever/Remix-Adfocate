import { createFileRoute, Outlet, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

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
  const tabs = [
    { to: "/kocmax/$slug", label: "主頁", exact: true },
    { to: "/kocmax/$slug/mission", label: "任務", exact: false },
    { to: "/kocmax/$slug/redemption", label: "兌換", exact: false },
    { to: "/kocmax/$slug/wallet", label: "錢包", exact: false },
  ] as const;
  return (
    <div className="min-h-screen pb-16">
      <main><Outlet /></main>
      <nav className="fixed bottom-0 inset-x-0 flex border-t bg-white">
        {tabs.map((t) => (
          <Link key={t.label} to={t.to} params={{ slug }} activeOptions={{ exact: t.exact }}
                className="flex-1 py-3 text-center text-sm" activeProps={{ className: "font-bold" }}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
