import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Target, ClipboardCheck, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const ITEMS = [
  { to: "/brand", exact: true, icon: LayoutDashboard, labelKey: "app.brand.navDashboard" },
  { to: "/brand/missions", exact: false, icon: Target, labelKey: "app.brand.navMissions" },
  { to: "/brand/review", exact: false, icon: ClipboardCheck, labelKey: "app.brand.navReview" },
  { to: "/brand/budget", exact: false, icon: Wallet, labelKey: "app.brand.navBudget" },
] as const;

const DESKTOP_ITEM =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)]";
const DESKTOP_ITEM_ACTIVE =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2 font-heading text-sm font-bold text-[var(--color-ink)]";
const MOBILE_ITEM =
  "flex flex-1 flex-col items-center gap-1 py-2 font-heading text-xs font-semibold text-[var(--color-soft-ink)]";
const MOBILE_ITEM_ACTIVE =
  "flex flex-1 flex-col items-center gap-1 py-2 font-heading text-xs font-bold text-[var(--color-ink)]";

export function BrandNav() {
  const { t } = useI18n();
  return (
    <>
      <nav
        aria-label={t("app.brand.title")}
        className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col gap-1 overflow-y-auto border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4"
      >
        <Link to="/brand" className="mb-2 px-3 font-display text-xl font-bold">
          {t("app.brand.title")}
        </Link>
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.exact }} className={DESKTOP_ITEM} activeProps={{ className: DESKTOP_ITEM_ACTIVE }}>
              <Icon size={20} aria-hidden />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label={t("app.brand.title")}
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-[var(--color-ink)] bg-[var(--color-paper)]"
      >
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.exact }} className={MOBILE_ITEM} activeProps={{ className: MOBILE_ITEM_ACTIVE }}>
              <Icon size={20} aria-hidden />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
