import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { Footer } from "@/components/marketing/Footer";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
  errorComponent: SiteError,
});

function SiteLayout() {
  const { lang } = useI18n();
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <MarketingHeader />
      <main id="main">
        <p role="note" aria-label={lang === "en" ? "Product preview" : "產品預覽"}
          className="border-b-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-3 text-center text-sm">
          {lang === "en"
            ? "Product preview. Profiles, statistics and earning examples are illustrative. Pending reward is not payment. Withdrawals, financing and automatic affiliate payouts are unavailable. Contact forms do not send or save information."
            : "產品預覽：履歷、統計及收入例子僅供示範。待處理獎勵不等於付款；提現、融資及自動佣金尚未開通。聯絡表格不會發送或儲存資料。"}
        </p>
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
