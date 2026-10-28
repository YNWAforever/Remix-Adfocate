import { Home, Target, Gift, Wallet, Compass, BookOpen, Bell, Trophy, ListChecks, Menu, UserRound, IdCard, Sparkles, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; labelKey: string; icon: LucideIcon; exact: boolean; showUnreadBadge?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/home", labelKey: "app.nav.home", icon: Home, exact: true },
  { to: "/mission", labelKey: "app.nav.mission", icon: Target, exact: false },
  { to: "/my", labelKey: "app.nav.myMissions", icon: ListChecks, exact: false },
  { to: "/campaigns", labelKey: "app.nav.campaigns", icon: Trophy, exact: false },
  { to: "/notifications", labelKey: "app.nav.notifications", icon: Bell, exact: false, showUnreadBadge: true },
  { to: "/redemption", labelKey: "app.nav.redemption", icon: Gift, exact: false },
  { to: "/wallet", labelKey: "app.nav.wallet", icon: Wallet, exact: false },
  { to: "/explore", labelKey: "app.nav.explore", icon: Compass, exact: false },
  { to: "/guide", labelKey: "app.nav.guide", icon: BookOpen, exact: false },
];

export const MOBILE_NAV_ITEMS: NavItem[] = [
  NAV_ITEMS[0],
  { ...NAV_ITEMS[1], labelKey: "app.nav.findMissions" },
  NAV_ITEMS[2],
  NAV_ITEMS.find(({ to }) => to === "/wallet")!,
  { to: "/more", labelKey: "app.nav.more", icon: Menu, exact: false },
];

export const MORE_NAV_ITEMS: NavItem[] = [
  ...NAV_ITEMS.filter(({ to }) => !["/home", "/mission", "/my", "/wallet"].includes(to)),
  { to: "/profile", labelKey: "app.home.profileAriaLabel", icon: UserRound, exact: false },
  { to: "/passport", labelKey: "app.home.passportAriaLabel", icon: IdCard, exact: false },
  { to: "/match", labelKey: "app.home.matchAriaLabel", icon: Sparkles, exact: false },
];
