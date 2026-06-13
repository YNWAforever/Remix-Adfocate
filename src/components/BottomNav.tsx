import { Link } from "@tanstack/react-router";
import { Home, Target, Gift, Wallet, Compass } from "lucide-react";

const TABS = [
  { to: "/kocmax/$slug", label: "主頁", icon: Home, exact: true as const },
  { to: "/kocmax/$slug/mission", label: "任務", icon: Target, exact: false as const },
  { to: "/kocmax/$slug/redemption", label: "積分兌換", icon: Gift, exact: false as const },
  { to: "/kocmax/$slug/wallet", label: "錢包", icon: Wallet, exact: false as const },
  { to: "/kocmax/$slug/explore" as string, label: "探索", icon: Compass, exact: false as const }, // route added in Task 8
] as const;

export function BottomNav({ slug }: { slug: string }) {
  return (
    <nav aria-label="主要導航" className="glass-panel fixed bottom-0 inset-x-0 z-40 flex border-t-2 border-[var(--color-ink)] pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            to={t.to}
            params={{ slug }}
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
