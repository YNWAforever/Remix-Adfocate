import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { NAV_ITEMS } from "./navItems";
import { LangToggle } from "./LangToggle";
import { NotificationBadge } from "./NotificationBadge";

const ITEM = "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)]";
const ITEM_ACTIVE = "flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2 font-heading text-sm font-bold text-[var(--color-ink)]";

export function SideNav() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("common.mainNav")}
      className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col gap-1 border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4"
    >
      <Link to="/home" className="mb-4 px-3 font-display text-2xl font-bold">
        Adfocate
      </Link>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.labelKey}
            to={item.to}
            activeOptions={{ exact: item.exact }}
            className={ITEM}
            activeProps={{ className: ITEM_ACTIVE }}
          >
            <Icon size={20} aria-hidden />
            <span>{t(item.labelKey)}</span>
            {item.showUnreadBadge && <NotificationBadge />}
          </Link>
        );
      })}
      <div className="mt-auto pt-4">
        <LangToggle />
      </div>
    </nav>
  );
}
