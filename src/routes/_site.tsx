import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { Footer } from "@/components/marketing/Footer";
import { HomeAudienceProvider } from "@/components/marketing/homeAudience";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
  errorComponent: SiteError,
});

function SiteLayout() {
  const { lang } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";

  return (
    <HomeAudienceProvider>
      <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
        <MarketingHeader />
        <main id="main">
          {/* Breadcrumb-style back link above the page title on every subpage
              (the conventional, discoverable spot — not tucked in the header). */}
          {!isHome && (
            <div className="mx-auto max-w-6xl px-4 pt-6 sm:pt-8">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-soft-ink)] transition-colors hover:text-[var(--color-ink)]"
              >
                <ArrowLeft className="h-4 w-4" /> {lang === "en" ? "Back to home" : "返回首頁"}
              </Link>
            </div>
          )}
          <Outlet />
        </main>
        <Footer />
      </div>
    </HomeAudienceProvider>
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
