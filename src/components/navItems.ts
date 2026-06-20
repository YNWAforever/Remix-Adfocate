import { Home, Target, Gift, Wallet, Compass, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; labelKey: string; icon: LucideIcon; exact: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/home", labelKey: "app.nav.home", icon: Home, exact: true },
  { to: "/mission", labelKey: "app.nav.mission", icon: Target, exact: false },
  { to: "/redemption", labelKey: "app.nav.redemption", icon: Gift, exact: false },
  { to: "/wallet", labelKey: "app.nav.wallet", icon: Wallet, exact: false },
  { to: "/explore", labelKey: "app.nav.explore", icon: Compass, exact: false },
];
