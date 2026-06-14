import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-paper)] p-8 text-center text-[var(--color-ink)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em]">KOCMAX</p>
      <h1 className="font-display text-3xl font-bold">404 — 找不到頁面</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">這個連結可能已失效或輸入錯誤。</p>
      <a href="/" className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-3 font-heading font-bold">回首頁</a>
    </div>
  );
}
