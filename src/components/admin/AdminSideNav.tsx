// src/components/admin/AdminSideNav.tsx
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { ADMIN_NAV_GROUPS, type AdminNavItem } from "./adminNavItems";
import { useAdminQueueCounts } from "./useAdminQueueCounts";
import { useStaffAccess, canOpenStaffPage } from "./StaffAccessContext";

const ITEM =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)]";
const ITEM_ACTIVE =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2 font-heading text-sm font-bold text-[var(--color-ink)]";
const ITEM_LOCKED =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)] opacity-60 bg-[var(--color-muted)] cursor-default";

const DESKTOP =
  "hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col gap-1 overflow-y-auto border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4";
const MOBILE =
  "lg:hidden flex flex-col gap-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4";

export function AdminSideNav({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const counts = useAdminQueueCounts();
  const access=useStaffAccess();
  const groups=ADMIN_NAV_GROUPS.map(g=>({...g,items:g.items.filter(item=>canOpenStaffPage(access,item.to))})).filter(g=>g.items.length);
  const home=groups.flatMap(g=>g.items).find(item=>!item.locked)?.to;

  function badge(item: AdminNavItem) {
    if (!item.countKey) return null;
    const n = counts[item.countKey];
    if (!n) return null;
    return <span className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-white px-1.5 text-xs">{n}</span>;
  }

  return (
    <nav aria-label={t("app.admin.title")} className={mobile ? MOBILE : DESKTOP}>
      {home?<Link to={home} className="mb-2 px-3 font-display text-xl font-bold" onClick={onNavigate}>
        {t("app.admin.brand")}
      </Link>:<span className="mb-2 px-3 font-display text-xl font-bold">{t("app.admin.brand")}</span>}
      {groups.map((group) => (
        <div key={group.labelKey} className="mt-3 first:mt-0">
          <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            if (item.locked) {
              return (
                <div key={item.labelKey} className={ITEM_LOCKED}>
                  <Icon size={20} aria-hidden />
                  <span>{t(item.labelKey)}</span>
                  <span className="ml-auto rounded-full border border-dashed border-[var(--color-soft-ink)] px-1.5 text-[10px] uppercase">
                    {t("app.admin.segmentsSoon")}
                  </span>
                </div>
              );
            }
            return (
              <Link
                key={item.labelKey}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className={ITEM}
                activeProps={{ className: ITEM_ACTIVE }}
                onClick={onNavigate}
              >
                <Icon size={20} aria-hidden />
                <span>{t(item.labelKey)}</span>
                {badge(item)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
