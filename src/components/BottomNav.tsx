import { Link } from "@tanstack/react-router";
import { Home, Target, Gift, Wallet, Compass } from "lucide-react";

const TABS = [
  { to: "/kocmax/$slug" as string, label: "主頁", icon: Home, exact: true },
  { to: "/kocmax/$slug/mission" as string, label: "任務", icon: Target, exact: false },
  { to: "/kocmax/$slug/redemption" as string, label: "積分兌換", icon: Gift, exact: false },
  { to: "/kocmax/$slug/wallet" as string, label: "錢包", icon: Wallet, exact: false },
  { to: "/kocmax/$slug/explore" as string, label: "探索", icon: Compass, exact: false },
];

export function BottomNav({ slug }: { slug: string }) {
  return (
    <nav className="glass-panel fixed bottom-0 inset-x-0 z-40 flex border-t-2 border-[var(--color-ink)] pb-[env(safe-area-inset-bottom)]">
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
