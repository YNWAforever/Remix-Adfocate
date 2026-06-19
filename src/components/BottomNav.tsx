import { Link } from "@tanstack/react-router";
import { NAV_ITEMS } from "./navItems";

export function BottomNav() {
  return (
    <nav aria-label="主要導航" className="glass-panel fixed bottom-0 inset-x-0 z-40 flex border-t-2 border-[var(--color-ink)] pb-[env(safe-area-inset-bottom)] lg:hidden">
      {NAV_ITEMS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            to={t.to}
            activeOptions={{ exact: t.exact }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-mono uppercase tracking-wide text-[var(--color-soft-ink)]"
            activeProps={{ className: "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-mono uppercase tracking-wide text-[var(--color-ink)] font-bold" }}
          >
            <Icon size={20} aria-hidden />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
