import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { Footer } from "@/components/marketing/Footer";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
  errorComponent: SiteError,
});

function SiteLayout() {
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <MarketingHeader />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function SiteError() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-2xl font-bold">{t("site.error.title")}</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">{t("site.error.body")}</p>
      <a href="/" className="btn-primary">{t("app.notFound.home")}</a>
    </div>
  );
}
