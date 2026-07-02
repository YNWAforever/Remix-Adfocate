// src/components/admin/adminNavItems.ts
import {
  BarChart3,
  Inbox,
  FileCheck,
  Users,
  UserCheck,
  Layers,
  Target,
  Trophy,
  FileText,
  Radar,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  exact: boolean;
  locked?: boolean;
  countKey?: "applications" | "submissions";
};

export type AdminNavGroup = { labelKey: string; items: AdminNavItem[] };

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    labelKey: "app.admin.navGroupAnalytics",
    items: [
      { to: "/admin/insights", labelKey: "app.admin.tabInsights", icon: BarChart3, exact: false },
      { to: "/admin/radar", labelKey: "app.admin.tabRadar", icon: Radar, exact: false },
    ],
  },
  {
    labelKey: "app.admin.navGroupReview",
    items: [
      { to: "/admin/applications", labelKey: "app.admin.tabApplications", icon: Inbox, exact: false, countKey: "applications" },
      { to: "/admin/submissions", labelKey: "app.admin.tabSubmissions", icon: FileCheck, exact: false, countKey: "submissions" },
      { to: "/admin/engaged", labelKey: "app.admin.tabEngaged", icon: Users, exact: false },
    ],
  },
  {
    labelKey: "app.admin.navGroupAudience",
    items: [
      { to: "/admin/creators", labelKey: "app.admin.tabCreators", icon: UserCheck, exact: false },
      { to: "/admin/segments", labelKey: "app.admin.tabSegments", icon: Layers, exact: false, locked: true },
    ],
  },
  {
    labelKey: "app.admin.navGroupLibrary",
    items: [
      { to: "/admin/missions", labelKey: "app.admin.tabMissions", icon: Target, exact: false },
      { to: "/admin/campaigns", labelKey: "app.admin.tabCampaigns", icon: Trophy, exact: false },
      { to: "/admin/content", labelKey: "app.admin.tabContent", icon: FileText, exact: false },
      { to: "/admin/academy", labelKey: "app.admin.tabAcademy", icon: GraduationCap, exact: false },
    ],
  },
];

/** Navigable (non-locked) items, flattened — used for top-bar title resolution. */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.locked);

/** i18n key for the top-bar page title, matched by longest `to` prefix; falls back to the console title. */
export function adminPageTitleKey(pathname: string): string {
  const match = ADMIN_NAV_ITEMS.filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  return match?.labelKey ?? "app.admin.title";
}
