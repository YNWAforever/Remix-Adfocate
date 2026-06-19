import { Home, Target, Gift, Wallet, Compass, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; exact: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/home", label: "主頁", icon: Home, exact: true },
  { to: "/mission", label: "任務", icon: Target, exact: false },
  { to: "/redemption", label: "積分兌換", icon: Gift, exact: false },
  { to: "/wallet", label: "錢包", icon: Wallet, exact: false },
  { to: "/explore", label: "探索", icon: Compass, exact: false },
];
