import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <I18nProvider>
      <Outlet />
      <Toaster />
    </I18nProvider>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-paper)] p-8 text-center text-[var(--color-ink)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em]">{t("app.notFound.kicker")}</p>
      <h1 className="font-display text-3xl font-bold">{t("app.notFound.title")}</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.notFound.body")}</p>
      <a
        href="/"
        className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-3 font-heading font-bold"
      >
        {t("app.notFound.home")}
      </a>
    </div>
  );
}
