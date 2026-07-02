import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { NAV_ITEMS } from "./navItems";
import { NotificationBadge } from "./NotificationBadge";

export function BottomNav() {
  const { t } = useI18n();
  return (
    <nav aria-label={t("common.mainNav")} className="glass-panel fixed bottom-0 inset-x-0 z-40 flex border-t-2 border-[var(--color-ink)] pb-[env(safe-area-inset-bottom)] lg:hidden">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.labelKey}
            to={item.to}
            activeOptions={{ exact: item.exact }}
            className="min-w-0 flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-mono uppercase tracking-wide text-[var(--color-soft-ink)]"
            activeProps={{ className: "min-w-0 flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-mono uppercase tracking-wide text-[var(--color-ink)] font-bold" }}
          >
            <span className="relative">
              <Icon size={20} aria-hidden />
              {item.showUnreadBadge && (
                <span className="absolute -right-2 -top-1">
                  <NotificationBadge />
                </span>
              )}
            </span>
            <span className="max-w-full text-center leading-[1.1] break-words">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
