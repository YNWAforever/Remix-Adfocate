import { createFileRoute, Link } from "@tanstack/react-router";
import { MORE_NAV_ITEMS } from "@/components/navItems";
import { NotificationBadge } from "@/components/NotificationBadge";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/more")({ component: More });

function More() {
  const { t } = useI18n();
  return <div className="mx-auto max-w-3xl space-y-5 p-4">
    <h1 className="font-heading text-2xl font-bold">{t("app.nav.more")}</h1>
    <nav aria-label={t("app.nav.more")} className="grid gap-3 sm:grid-cols-2">
      {MORE_NAV_ITEMS.map(({ to, labelKey, icon: Icon, showUnreadBadge }) => <Link key={to} to={to}
        className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        <Icon size={20} aria-hidden="true" /><span>{t(labelKey)}</span>{showUnreadBadge ? <NotificationBadge /> : null}
      </Link>)}
    </nav>
  </div>;
}
