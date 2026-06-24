# Admin SaaS Shell + Insights Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-shell the `/admin` operator console into a SaaS-style grouped left sidebar + top bar, and add a read-only Insights dashboard (6 KPIs, funnel, level distribution, SVG trend chart) so operators can measure creator engagement.

**Architecture:** Two additive slices on one branch / one PR. Slice 0 is a pure frontend re-layout (new `AdminSideNav` + `AdminTopBar`, grouped nav config, mobile drawer, count-badge hook) replacing the horizontal `AdminTabs`. Slice 1 adds one guarded read-only Hono sub-route (`/admin/insights`) backed by a pure `shapeInsights()` aggregator computed on-read from existing tables, plus a TanStack route page with bespoke SVG charts. **No DB migration, no new dependency, no new env var, no write paths.**

**Tech Stack:** React + TanStack Router (file-based routing, `tsr generate` codegen), Vite, Tailwind v4 (`@theme` tokens in `src/styles.css`, no config file), Hono v4 server, Supabase (service-role reads), Vitest (unit + integration), `@tanstack/react-query`, `lucide-react`.

---

## Conventions for this plan

- **Repo root:** all paths and commands are relative to the `adfocate-2/` repository (the working directory `New Adfocate` is *not* the git repo; `adfocate-2/` is). Run every `git`/`npm` command from inside `adfocate-2/`.
- **Single branch, single PR:** `feat/admin-saas-insights` off `main` @ `990e3c1`. Slice 0 tasks land first, Slice 1 after; the `/admin` → `/admin/insights` redirect flips only once the insights route exists (final task), so the branch never has a dangling default landing.
- **ESM `.js` rule:** every *relative* import in `server/**` must end in `.js` (e.g. `from "../lib/supabase.js"`). `npm run build` runs `check:esm` and fails otherwise — this caused a prior ~1-day prod outage. **Test files** (`*.test.ts(x)`) import the module under test *without* `.js` (matches `engagedRoster.test.ts`, `match.test.ts`).
- **Route codegen:** adding `src/routes/admin.insights.tsx` requires `npm run type-check` (which runs `tsr generate` to rebuild `routeTree.gen.ts`). Bare `tsc` will not regenerate it. Use dot-notation filenames only.
- **i18n parity:** every new key must be added to **both** the `en` and `zh` blocks of `src/lib/i18n.dict.ts` with a non-empty value, or `src/lib/i18n.test.tsx` fails the build. Keys are flat dotted strings.
- **i18n in tests:** `useI18n()` has a default context that resolves keys against the **zh** dict, so provider-less component renders show zh copy. Component tests assert on the **zh** strings (matches `ScoreRing.test.tsx`, `SideNav.test.tsx`). Router-based component tests also `localStorage.setItem("lang", "zh")` in `beforeEach`.
- **Design tokens:** no `tailwind.config.js`. Card shadows are hardcoded `box-shadow` via CSS classes (`.pastel-card`, `.wallet-card`), never `shadow-*`. Radius is `var(--radius)`. `--color-magenta-pop` is decorative-only. Skeletons use `.skeleton-acid` compound classes (`skeleton-acid skeleton-card`, not BEM `--`).
- **Workspace param triple-naming (confirmed):** the admin selector stores a workspace **UUID**; it persists on the URL as `?ws=` (browser convenience, handled by `AdminWorkspaceContext`) but the API query param is `?workspace=` (built by the private `wsq()` helper in `src/lib/admin.ts`). An empty value means "all workspaces".
- **Auth:** `/admin` is mounted **unguarded** in `server/app.ts`; the staff-auth middleware lives inside `adminRoutes` (in `server/routes/admin.ts`). A new sub-route registered on `adminRoutes` inherits it — **add no second guard.** The break-glass `ADMIN_SECRET` path sets `staff.userId = null` (`viaSecret: true`); never key logic off `userId` without a null guard. `serviceClient()` bypasses RLS — server-only.

## Schema facts confirmed by research (resolve the spec's open items)

- **`mission_submissions` HAS its own `workspace_id` column** (uuid, not null) — so the insights queries filter directly on `mission_submissions.workspace_id = <uuid>` (no join to `missions` needed). Columns used: `creator_id`, `status`, `points_awarded` (int), `created_at`, `submitted_at`, `reviewed_at` (all timestamptz; `submitted_at`/`reviewed_at` nullable). Status CHECK (8 values): `applied, joined, submitted, under_review, approved, rejected, expired, declined`.
- **`missions` capacity columns are `quota` (int) and `filled` (int)** — confirmed (not `slots`/`target_count`). `status` ∈ `draft, active, closed`. Has `workspace_id`.
- **Cash lives in `earnings_transactions`** — column `amount numeric(10,2)`, `type` ∈ `earn, adjust` (only `earn` is ever written, positive credits), `creator_id`, `workspace_id`, `created_at`. (Points live separately in `mission_submissions.points_awarded`.)
- **`creators.level` is `text`** defaulting `'L0'`, range `L0..L6`; has `xp int`; has `workspace_id`.

---

## File map

**Slice 0 (shell) — create:**
- `src/components/admin/adminNavItems.ts` — grouped nav config + title-key helper.
- `src/components/admin/useAdminQueueCounts.ts` — shared React-Query count hook for badges.
- `src/components/admin/AdminSideNav.tsx` — grouped sidebar (desktop fixed + mobile in-flow).
- `src/components/admin/AdminTopBar.tsx` — sticky top bar (title, WorkspaceSwitcher, identity, sign-out, hamburger).
- `src/components/admin/AdminSideNav.test.tsx` — sidebar component test.

**Slice 0 — modify:**
- `src/routes/admin.tsx` — replace centered tab layout with sidebar + top bar + mobile drawer.
- `src/lib/i18n.dict.ts` — add `app.admin.nav*`/`tabInsights`/`tabSegments`/`segmentsSoon`/`brand`/`openNav`/`closeNav` (en + zh).

**Slice 0 — delete:**
- `src/components/admin/AdminTabs.tsx` (count logic migrated to `useAdminQueueCounts`).

**Slice 1 (insights) — create:**
- `server/lib/insights.ts` — pure `shapeInsights()` + types.
- `server/lib/insights.test.ts` — unit tests.
- `server/routes/adminInsights.ts` — Hono sub-route `GET /insights`.
- `server/test/insights.test.ts` — integration test.
- `src/components/admin/TrendChart.tsx` — bespoke SVG line chart.
- `src/components/admin/TrendChart.test.tsx` — chart component test.
- `src/routes/admin.insights.tsx` — Insights page.
- `src/routes/-admin.insights.test.tsx` — route-stub test.

**Slice 1 — modify:**
- `server/routes/admin.ts` — register `adminInsightsRoutes`.
- `src/lib/admin.ts` — add `adminKeys.insights`, `Insights`/`InsightsMetric` types, `fetchInsights`.
- `src/lib/i18n.dict.ts` — add `app.insights.*` (en + zh).
- `package.json` — append `server/test/insights.test.ts` to the `test:integration` list.
- `src/routes/admin.index.tsx` — redirect `/admin` → `/admin/insights`.

---

# SLICE 0 — SaaS shell

### Task 0: Branch

- [ ] **Step 1: Create the branch off main**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/admin-saas-insights
git log -1 --oneline   # expect base at or after 990e3c1
```

---

### Task 1: Shell i18n keys (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts` (en block ~line 561 area; zh block ~line 1204 area)

- [ ] **Step 1: Add the new keys to the `en` block**

Add these lines immediately after the existing `"app.admin.tabContent": "Content",` line in the **en** object:

```ts
    "app.admin.brand": "Adfocate OPS",
    "app.admin.navGroupAnalytics": "Analytics",
    "app.admin.navGroupReview": "Review queue",
    "app.admin.navGroupAudience": "Audience",
    "app.admin.navGroupLibrary": "Library",
    "app.admin.tabInsights": "Insights",
    "app.admin.tabSegments": "Segments",
    "app.admin.segmentsSoon": "Soon",
    "app.admin.openNav": "Open navigation",
    "app.admin.closeNav": "Close navigation",
```

- [ ] **Step 2: Add the SAME keys to the `zh` block**

Add these lines immediately after the existing `"app.admin.tabContent": "內容",` line in the **zh** object:

```ts
    "app.admin.brand": "Adfocate OPS",
    "app.admin.navGroupAnalytics": "分析",
    "app.admin.navGroupReview": "審批佇列",
    "app.admin.navGroupAudience": "受眾",
    "app.admin.navGroupLibrary": "資料庫",
    "app.admin.tabInsights": "洞察",
    "app.admin.tabSegments": "分眾",
    "app.admin.segmentsSoon": "即將推出",
    "app.admin.openNav": "開啟導覽",
    "app.admin.closeNav": "關閉導覽",
```

- [ ] **Step 3: Run the i18n parity test**

Run: `npm test -- src/lib/i18n.test.tsx`
Expected: PASS (identical key sets, no empty values).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "feat(admin): add SaaS shell nav i18n keys (en + zh)"
```

---

### Task 2: Grouped nav config

**Files:**
- Create: `src/components/admin/adminNavItems.ts`

- [ ] **Step 1: Write the config + title helper**

```ts
// src/components/admin/adminNavItems.ts
import {
  BarChart3,
  Inbox,
  FileCheck,
  Users,
  UserCheck,
  Layers,
  Target,
  FileText,
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
    items: [{ to: "/admin/insights", labelKey: "app.admin.tabInsights", icon: BarChart3, exact: false }],
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
      { to: "/admin/content", labelKey: "app.admin.tabContent", icon: FileText, exact: false },
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
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS (no type errors; all 8 lucide icons exist in `lucide-react`).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/adminNavItems.ts
git commit -m "feat(admin): add grouped admin nav config"
```

---

### Task 3: Shared queue-count hook

**Files:**
- Create: `src/components/admin/useAdminQueueCounts.ts`

- [ ] **Step 1: Write the hook (lifts the existing AdminTabs count logic verbatim)**

```ts
// src/components/admin/useAdminQueueCounts.ts
import { useQuery } from "@tanstack/react-query";
import { adminKeys, fetchApplications, fetchSubmissions } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

/**
 * Live counts for the Applications/Submissions sidebar badges. Uses the same query
 * keys the tab pages populate, so it shares the React-Query cache and triggers no
 * extra fetch (migrated out of the old AdminTabs).
 */
export function useAdminQueueCounts(): { applications?: number; submissions?: number } {
  const { authed } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const apps = useQuery({
    queryKey: adminKeys.applications(workspace),
    queryFn: () => fetchApplications(workspace),
    enabled: authed,
    retry: false,
  });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted", workspace),
    queryFn: () => fetchSubmissions("submitted", workspace),
    enabled: authed,
    retry: false,
  });
  return { applications: apps.data?.applications.length, submissions: subs.data?.submissions.length };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/useAdminQueueCounts.ts
git commit -m "feat(admin): add useAdminQueueCounts hook for sidebar badges"
```

---

### Task 4: AdminSideNav component (TDD)

**Files:**
- Create: `src/components/admin/AdminSideNav.tsx`
- Test: `src/components/admin/AdminSideNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/AdminSideNav.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Stub the count hook so the sidebar renders without auth/workspace/query providers.
vi.mock("./useAdminQueueCounts", () => ({ useAdminQueueCounts: () => ({ applications: 7, submissions: 12 }) }));

import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { I18nProvider } from "@/lib/i18n";
import { AdminSideNav } from "./AdminSideNav";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

function renderNav(initial = "/admin/insights") {
  const root = createRootRoute({ component: () => <AdminSideNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  return render(
    <I18nProvider>
      <RouterProvider router={router as never} />
    </I18nProvider>,
  );
}

describe("AdminSideNav", () => {
  it("renders the four group headers", async () => {
    renderNav();
    for (const label of ["分析", "審批佇列", "受眾", "資料庫"]) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    }
  });

  it("renders the Insights item as a link to /admin/insights", async () => {
    renderNav();
    await waitFor(() => {
      const link = screen.getByText("洞察").closest("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/admin/insights");
    });
  });

  it("renders the locked Segments item as non-navigating (not an anchor)", async () => {
    renderNav();
    await waitFor(() => {
      const el = screen.getByText("分眾");
      expect(el.closest("a")).toBeNull();
    });
    expect(screen.getByText("即將推出")).toBeInTheDocument();
  });

  it("shows live count badges for Applications and Submissions", async () => {
    renderNav();
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/admin/AdminSideNav.test.tsx`
Expected: FAIL with "Failed to resolve import ./AdminSideNav" (file not created yet).

- [ ] **Step 3: Write the component**

```tsx
// src/components/admin/AdminSideNav.tsx
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { ADMIN_NAV_GROUPS, type AdminNavItem } from "./adminNavItems";
import { useAdminQueueCounts } from "./useAdminQueueCounts";

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

  function badge(item: AdminNavItem) {
    if (!item.countKey) return null;
    const n = counts[item.countKey];
    if (!n) return null;
    return <span className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-white px-1.5 text-xs">{n}</span>;
  }

  return (
    <nav aria-label={t("app.admin.title")} className={mobile ? MOBILE : DESKTOP}>
      <Link to="/admin/insights" className="mb-2 px-3 font-display text-xl font-bold" onClick={onNavigate}>
        {t("app.admin.brand")}
      </Link>
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.labelKey} className="mt-3 first:mt-0">
          <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            if (item.locked) {
              return (
                <div key={item.labelKey} className={ITEM_LOCKED} aria-disabled>
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/admin/AdminSideNav.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminSideNav.tsx src/components/admin/AdminSideNav.test.tsx
git commit -m "feat(admin): add grouped AdminSideNav with locked items and count badges"
```

---

### Task 5: AdminTopBar component

**Files:**
- Create: `src/components/admin/AdminTopBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/admin/AdminTopBar.tsx
import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { adminPageTitleKey } from "./adminNavItems";

export function AdminTopBar({ onMenu }: { onMenu: () => void }) {
  const { t } = useI18n();
  const { staff } = useAdminAuth();
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t("app.admin.openNav")}
        className="lg:hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2"
      >
        <Menu size={18} aria-hidden />
      </button>
      <h1 className="font-display text-lg font-bold">{t(adminPageTitleKey(pathname))}</h1>
      <div className="ml-auto flex items-center gap-3">
        <WorkspaceSwitcher />
        {staff?.email ? (
          <span className="hidden text-xs text-[var(--color-soft-ink)] sm:inline">{staff.email}</span>
        ) : null}
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-heading font-bold"
        >
          {t("app.admin.signOut")}
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminTopBar.tsx
git commit -m "feat(admin): add AdminTopBar (title, workspace switcher, identity, sign-out)"
```

---

### Task 6: Re-layout admin.tsx + remove AdminTabs

**Files:**
- Modify: `src/routes/admin.tsx` (full rewrite of the component body)
- Delete: `src/components/admin/AdminTabs.tsx`

- [ ] **Step 1: Replace the whole file contents of `src/routes/admin.tsx`**

```tsx
// src/routes/admin.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const [, setAuthError] = useState<unknown>(null);
  const [navOpen, setNavOpen] = useState(false);
  return (
    <StaffAuthGate>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError: setAuthError }}>
          <AdminWorkspaceProvider>
            <AdminSideNav />
            <div className="min-h-screen lg:pl-60">
              <AdminTopBar onMenu={() => setNavOpen((v) => !v)} />
              {navOpen ? (
                <div className="p-4 lg:hidden">
                  <AdminSideNav mobile onNavigate={() => setNavOpen(false)} />
                </div>
              ) : null}
              <main className="mx-auto max-w-5xl space-y-4 p-4">
                <Outlet />
              </main>
            </div>
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
```

- [ ] **Step 2: Delete the old tabs component**

```bash
git rm src/components/admin/AdminTabs.tsx
```

- [ ] **Step 3: Verify nothing else imports AdminTabs**

Run: `grep -rn "AdminTabs" src/`
Expected: no matches (only `admin.tsx` referenced it, and that import is now gone).

- [ ] **Step 4: Update the existing admin layout route-stub test**

`src/routes/-admin.test.tsx` renders `Route.options.component`. Open it and confirm it still passes given the new layout (it mocks `Link` and the providers). If it asserts on the old header/`AdminTabs` markup, update those assertions to target the new shell — assert the top-bar sign-out button renders:

```tsx
// in src/routes/-admin.test.tsx, replace any AdminTabs-specific assertion with:
expect(screen.getByText("登出")).toBeInTheDocument(); // app.admin.signOut (zh default)
```

If `-admin.test.tsx` mocks `@tanstack/react-router`, ensure the mock also exports `useLocation: () => ({ pathname: "/admin/insights" })` (AdminTopBar calls it). Add to the existing `vi.mock("@tanstack/react-router", ...)` `return` object:

```tsx
useLocation: () => ({ pathname: "/admin/insights" }),
```

- [ ] **Step 5: Run the layout test + type-check + lint**

Run: `npm test -- src/routes/-admin.test.tsx`
Expected: PASS.
Run: `npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.tsx src/routes/-admin.test.tsx
git commit -m "feat(admin): replace AdminTabs with SaaS sidebar + top bar shell"
```

---

# SLICE 1 — Insights dashboard

### Task 7: Pure insights aggregator (TDD)

**Files:**
- Create: `server/lib/insights.ts`
- Test: `server/lib/insights.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/insights.test.ts
import { describe, it, expect } from "vitest";
import {
  shapeInsights,
  type InsightsSubmissionRow,
  type InsightsEarningRow,
  type InsightsCreatorRow,
  type InsightsMissionRow,
} from "./insights";

const TO = "2026-06-30T00:00:00.000Z"; // "now" for the window
const inWin = "2026-06-20T00:00:00.000Z"; // within last 30d
const inPrior = "2026-05-20T00:00:00.000Z"; // within prior 30d (31..60d ago)

let n = 0;
function sub(over: Partial<InsightsSubmissionRow> & { status: string }): InsightsSubmissionRow {
  return {
    creator_id: over.creator_id ?? `c${n++}`,
    status: over.status,
    points_awarded: over.points_awarded ?? 0,
    created_at: over.created_at ?? inWin,
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
  };
}

function base(over: {
  submissions?: InsightsSubmissionRow[];
  earnings?: InsightsEarningRow[];
  creators?: InsightsCreatorRow[];
  missions?: InsightsMissionRow[];
}) {
  return shapeInsights({
    to: TO,
    days: 30,
    submissions: over.submissions ?? [],
    earnings: over.earnings ?? [],
    creators: over.creators ?? [],
    missions: over.missions ?? [],
  });
}

describe("shapeInsights", () => {
  it("returns all-zero metrics and a 7-level histogram on empty input (no throw)", () => {
    const r = base({});
    expect(r.kpis.activeCreators.value).toBe(0);
    expect(r.kpis.cashPaid.value).toBe(0);
    expect(r.kpis.activeCreators.deltaPct).toBeNull(); // prev 0 -> null
    expect(r.levels.map((l) => l.level)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(r.levels.every((l) => l.count === 0)).toBe(true);
    expect(r.window.days).toBe(30);
    expect(Array.isArray(r.trend)).toBe(true);
  });

  it("counts distinct active creators in-window only", () => {
    const r = base({
      submissions: [
        sub({ creator_id: "a", status: "joined", created_at: inWin }),
        sub({ creator_id: "a", status: "submitted", created_at: inWin, submitted_at: inWin }),
        sub({ creator_id: "b", status: "joined", created_at: inWin }),
        sub({ creator_id: "old", status: "joined", created_at: inPrior }), // prior window, not current
      ],
    });
    expect(r.kpis.activeCreators.value).toBe(2); // a, b
  });

  it("computes the funnel and its conversion percentages", () => {
    const r = base({
      submissions: [
        sub({ creator_id: "a", status: "joined", created_at: inWin }),
        sub({ creator_id: "b", status: "submitted", created_at: inWin, submitted_at: inWin }),
        sub({ creator_id: "c", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 100 }),
        sub({ creator_id: "d", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 50 }),
      ],
    });
    expect(r.funnel.joined).toBe(4); // all four are loop-status rows created in-window
    expect(r.funnel.submitted).toBe(3); // b, c, d have submitted_at in-window
    expect(r.funnel.approved).toBe(2); // c, d
    expect(r.funnel.joinToSubmit).toBe(75); // 3/4
    expect(r.funnel.submitToApprove).toBeCloseTo(66.7, 1); // 2/3
    expect(r.kpis.pointsIssued.value).toBe(150);
    expect(r.kpis.completions.value).toBe(2);
  });

  it("computes deltaPct vs the prior equal-length window", () => {
    const r = base({
      submissions: [
        sub({ creator_id: "a", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 200 }),
        sub({ creator_id: "b", status: "approved", created_at: inPrior, submitted_at: inPrior, reviewed_at: inPrior, points_awarded: 100 }),
      ],
    });
    // current points = 200, prior = 100 -> +100%
    expect(r.kpis.pointsIssued.value).toBe(200);
    expect(r.kpis.pointsIssued.prev).toBe(100);
    expect(r.kpis.pointsIssued.deltaPct).toBe(100);
  });

  it("sums cash from earnings credits in-window", () => {
    const r = base({
      earnings: [
        { amount: "150.50", created_at: inWin },
        { amount: 49.5, created_at: inWin },
        { amount: 999, created_at: "2026-01-01T00:00:00.000Z" }, // far past, excluded
      ],
    });
    expect(r.kpis.cashPaid.value).toBe(200); // 150.50 + 49.50
  });

  it("computes mission fill rate over active missions (snapshot, null delta)", () => {
    const r = base({
      missions: [
        { status: "active", quota: 10, filled: 4 },
        { status: "active", quota: 10, filled: 1 },
        { status: "draft", quota: 100, filled: 0 }, // ignored
      ],
    });
    expect(r.kpis.missionFillRate.value).toBe(25); // 5/20
    expect(r.kpis.missionFillRate.deltaPct).toBeNull();
  });

  it("builds a level histogram from creator levels", () => {
    const r = base({ creators: [{ level: "L0" }, { level: "L3" }, { level: "L3" }, { level: null }] });
    const byLevel = Object.fromEntries(r.levels.map((l) => [l.level, l.count]));
    expect(byLevel.L0).toBe(2); // L0 + null defaults to L0
    expect(byLevel.L3).toBe(2);
    expect(byLevel.L6).toBe(0);
  });

  it("buckets the trend by day for 30d and by week for 90d", () => {
    const sevenSubs = [sub({ creator_id: "a", status: "joined", created_at: inWin })];
    const day = shapeInsights({ to: TO, days: 30, submissions: sevenSubs, earnings: [], creators: [], missions: [] });
    expect(day.trend.length).toBe(30); // 30 daily buckets
    const week = shapeInsights({ to: TO, days: 90, submissions: sevenSubs, earnings: [], creators: [], missions: [] });
    expect(week.trend.length).toBeGreaterThanOrEqual(12); // ~13 weekly buckets
    expect(week.trend.length).toBeLessThanOrEqual(14);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- server/lib/insights.test.ts`
Expected: FAIL with "Failed to resolve import ./insights".

- [ ] **Step 3: Write the implementation**

```ts
// server/lib/insights.ts
// Pure aggregation for the operator Insights dashboard. Takes already-fetched rows
// (mission_submissions, earnings_transactions, creators, missions) + the window and
// produces KPIs, an engagement funnel, a level histogram, and a time-series trend.
// No DB / no async — fully unit-tested. Mirrors engagedRoster.ts / missionActivity.ts.

export type InsightsWindowDays = 7 | 30 | 90;

export type InsightsSubmissionRow = {
  creator_id: string;
  status: string;
  points_awarded: number | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};

export type InsightsEarningRow = {
  amount: number | string | null; // numeric(10,2) may arrive from PostgREST as a string
  created_at: string;
};

export type InsightsCreatorRow = { level: string | null };

export type InsightsMissionRow = { status: string; quota: number | null; filled: number | null };

export type Metric = { value: number; prev: number; deltaPct: number | null };

export type Insights = {
  window: { days: InsightsWindowDays; from: string; to: string };
  kpis: {
    activeCreators: Metric;
    submitToApprove: Metric;
    pointsIssued: Metric;
    cashPaid: Metric;
    missionFillRate: Metric;
    completions: Metric;
  };
  funnel: { joined: number; submitted: number; approved: number; joinToSubmit: number; submitToApprove: number };
  levels: Array<{ level: string; count: number }>;
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};

export type ShapeInsightsInput = {
  to: string; // ISO instant treated as "now"
  days: InsightsWindowDays;
  submissions: InsightsSubmissionRow[];
  earnings: InsightsEarningRow[];
  creators: InsightsCreatorRow[];
  missions: InsightsMissionRow[];
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["joined", "submitted", "under_review"]);
const LOOP_STATUSES: ReadonlySet<string> = new Set([
  "joined",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "expired",
]);
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
const DAY_MS = 86_400_000;

function num(v: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function inRange(ts: string | null, fromMs: number, toMs: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= fromMs && t < toMs;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deltaPct(value: number, prev: number): number | null {
  if (prev === 0) return null; // render "—", never ∞
  return round1(((value - prev) / prev) * 100);
}

function activeCreatorCount(subs: InsightsSubmissionRow[], fromMs: number, toMs: number): number {
  const ids = new Set<string>();
  for (const r of subs) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    if (inRange(r.created_at, fromMs, toMs) || inRange(r.submitted_at, fromMs, toMs)) ids.add(r.creator_id);
  }
  return ids.size;
}

function funnelCounts(subs: InsightsSubmissionRow[], fromMs: number, toMs: number) {
  let joined = 0;
  let submitted = 0;
  let approved = 0;
  for (const r of subs) {
    if (LOOP_STATUSES.has(r.status) && inRange(r.created_at, fromMs, toMs)) joined += 1;
    if (inRange(r.submitted_at, fromMs, toMs)) submitted += 1;
    if (r.status === "approved" && inRange(r.reviewed_at, fromMs, toMs)) approved += 1;
  }
  return { joined, submitted, approved };
}

function pointsIssued(subs: InsightsSubmissionRow[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const r of subs) {
    if (r.status === "approved" && inRange(r.reviewed_at, fromMs, toMs)) sum += r.points_awarded ?? 0;
  }
  return sum;
}

function cashPaid(earnings: InsightsEarningRow[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const e of earnings) {
    if (inRange(e.created_at, fromMs, toMs)) sum += num(e.amount);
  }
  return round2(sum);
}

function metric(value: number, prev: number): Metric {
  return { value, prev, deltaPct: deltaPct(value, prev) };
}

function pct(numr: number, denom: number): number {
  return denom === 0 ? 0 : round1((numr / denom) * 100);
}

function buildTrend(subs: InsightsSubmissionRow[], fromMs: number, toMs: number, days: InsightsWindowDays) {
  const stepMs = days === 90 ? 7 * DAY_MS : DAY_MS;
  const buckets: Array<{ bucket: string; start: number; end: number; joined: number; submitted: number; approved: number }> = [];
  for (let start = fromMs; start < toMs; start += stepMs) {
    const end = Math.min(start + stepMs, toMs);
    buckets.push({ bucket: new Date(start).toISOString().slice(0, 10), start, end, joined: 0, submitted: 0, approved: 0 });
  }
  for (const r of subs) {
    for (const b of buckets) {
      if (LOOP_STATUSES.has(r.status) && inRange(r.created_at, b.start, b.end)) b.joined += 1;
      if (inRange(r.submitted_at, b.start, b.end)) b.submitted += 1;
      if (r.status === "approved" && inRange(r.reviewed_at, b.start, b.end)) b.approved += 1;
    }
  }
  return buckets.map((b) => ({ bucket: b.bucket, joined: b.joined, submitted: b.submitted, approved: b.approved }));
}

export function shapeInsights(input: ShapeInsightsInput): Insights {
  const { to, days, submissions, earnings, creators, missions } = input;
  const toMs = Date.parse(to);
  const fromMs = toMs - days * DAY_MS;
  const priorFromMs = fromMs - days * DAY_MS;
  const priorToMs = fromMs;

  const cur = funnelCounts(submissions, fromMs, toMs);
  const prev = funnelCounts(submissions, priorFromMs, priorToMs);
  const curS2A = pct(cur.approved, cur.submitted);
  const prevS2A = pct(prev.approved, prev.submitted);

  let activeQuota = 0;
  let activeFilled = 0;
  for (const m of missions) {
    if (m.status !== "active") continue;
    activeQuota += m.quota ?? 0;
    activeFilled += m.filled ?? 0;
  }
  const fillRate = pct(activeFilled, activeQuota);

  const levelCounts = new Map<string, number>(LEVELS.map((l) => [l, 0]));
  for (const c of creators) {
    const lvl = c.level && levelCounts.has(c.level) ? c.level : "L0";
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }

  return {
    window: { days, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    kpis: {
      activeCreators: metric(
        activeCreatorCount(submissions, fromMs, toMs),
        activeCreatorCount(submissions, priorFromMs, priorToMs),
      ),
      submitToApprove: { value: curS2A, prev: prevS2A, deltaPct: deltaPct(curS2A, prevS2A) },
      pointsIssued: metric(pointsIssued(submissions, fromMs, toMs), pointsIssued(submissions, priorFromMs, priorToMs)),
      cashPaid: metric(cashPaid(earnings, fromMs, toMs), cashPaid(earnings, priorFromMs, priorToMs)),
      missionFillRate: { value: fillRate, prev: 0, deltaPct: null }, // current snapshot, no prior comparison
      completions: metric(cur.approved, prev.approved),
    },
    funnel: {
      joined: cur.joined,
      submitted: cur.submitted,
      approved: cur.approved,
      joinToSubmit: pct(cur.submitted, cur.joined),
      submitToApprove: curS2A,
    },
    levels: LEVELS.map((level) => ({ level, count: levelCounts.get(level) ?? 0 })),
    trend: buildTrend(submissions, fromMs, toMs, days),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/lib/insights.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/insights.ts server/lib/insights.test.ts
git commit -m "feat(insights): add pure shapeInsights aggregator + unit tests"
```

---

### Task 8: Insights Hono sub-route

**Files:**
- Create: `server/routes/adminInsights.ts`
- Modify: `server/routes/admin.ts` (import + register)

- [ ] **Step 1: Write the sub-route**

```ts
// server/routes/adminInsights.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeInsights, type InsightsWindowDays } from "../lib/insights.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const VALID_WINDOWS: InsightsWindowDays[] = [7, 30, 90];
const DAY_MS = 86_400_000;

export const adminInsightsRoutes = new Hono<AdminEnv>();

// GET /admin/insights?workspace=<uuid?>&window=<7|30|90>
// Inherits the staff-auth middleware from adminRoutes — no extra guard.
adminInsightsRoutes.get("/insights", async (c) => {
  const raw = c.req.query("window");
  const days = (raw ? Number(raw) : 30) as InsightsWindowDays;
  if (!VALID_WINDOWS.includes(days)) {
    return c.json({ error: "window must be 7, 30 or 90", code: "validation" }, 422);
  }
  const ws = c.req.query("workspace") || "";

  const to = new Date().toISOString();
  const priorFromIso = new Date(Date.parse(to) - 2 * days * DAY_MS).toISOString();
  const svc = serviceClient();

  // 1) submissions touching the current OR prior window (any of the three timestamps)
  let subsQ = svc
    .from("mission_submissions")
    .select("creator_id, status, points_awarded, created_at, submitted_at, reviewed_at")
    .or(`created_at.gte.${priorFromIso},submitted_at.gte.${priorFromIso},reviewed_at.gte.${priorFromIso}`);
  if (ws) subsQ = subsQ.eq("workspace_id", ws);
  const subs = await subsQ;
  if (subs.error) return c.json({ error: subs.error.message, code: "db_error" }, 500);

  // 2) cash credits in the current + prior window
  let earnQ = svc
    .from("earnings_transactions")
    .select("amount, created_at")
    .eq("type", "earn")
    .gte("created_at", priorFromIso);
  if (ws) earnQ = earnQ.eq("workspace_id", ws);
  const earn = await earnQ;
  if (earn.error) return c.json({ error: earn.error.message, code: "db_error" }, 500);

  // 3) level histogram — current creators snapshot
  let creatorsQ = svc.from("creators").select("level");
  if (ws) creatorsQ = creatorsQ.eq("workspace_id", ws);
  const creators = await creatorsQ;
  if (creators.error) return c.json({ error: creators.error.message, code: "db_error" }, 500);

  // 4) fill rate — active missions snapshot
  let missionsQ = svc.from("missions").select("status, quota, filled").eq("status", "active");
  if (ws) missionsQ = missionsQ.eq("workspace_id", ws);
  const missions = await missionsQ;
  if (missions.error) return c.json({ error: missions.error.message, code: "db_error" }, 500);

  const insights = shapeInsights({
    to,
    days,
    submissions: subs.data ?? [],
    earnings: earn.data ?? [],
    creators: creators.data ?? [],
    missions: missions.data ?? [],
  });
  return c.json({ insights });
});
```

- [ ] **Step 2: Register it in `server/routes/admin.ts`**

Add the import alongside the other sub-route imports near the top:

```ts
import { adminInsightsRoutes } from "./adminInsights.js";
```

Add the mount alongside the existing `adminRoutes.route("/", ...)` lines (after `adminRoutes.route("/", adminContentRoutes);`):

```ts
adminRoutes.route("/", adminInsightsRoutes);
```

> Note: like the sibling sub-routes, this mounts at `"/"` and the handler declares the full `/insights` path — so the live path is `/api/admin/insights`. (The spec sketched `adminRoutes.route("/insights", ...)`; mounting at `"/"` matches the three existing registrations and is equivalent.)

- [ ] **Step 3: Build (runs check:esm) + type-check**

Run: `npm run type-check && npm run build`
Expected: PASS — in particular `check:esm` confirms every relative import in `adminInsights.ts` ends in `.js`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminInsights.ts server/routes/admin.ts
git commit -m "feat(insights): add guarded GET /admin/insights aggregation route"
```

---

### Task 9: Integration test

**Files:**
- Create: `server/test/insights.test.ts`
- Modify: `package.json` (append to `test:integration` file list)

- [ ] **Step 1: Write the integration test (skips automatically without Supabase env)**

```ts
// server/test/insights.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeStaff, makeCreator, seedSubmission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminReq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("admin insights", () => {
  let staff: { userId: string; jwt: string };
  let creator: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    staff = await makeStaff("insights-staff@test.local");
    creator = await makeCreator("insights-koc@test.local", 0);
    await seedSubmission(creator.userId, "joined", "test-insights-joined");
    await seedSubmission(creator.userId, "submitted", "test-insights-submitted");
  });
  afterAll(cleanup);

  it("rejects an invalid window with 422", async () => {
    const res = await adminReq("/admin/insights?window=5", staff.jwt);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
  });

  it("requires staff auth (401 without a token)", async () => {
    const res = await app.request("/api/admin/insights?window=30");
    expect(res.status).toBe(401);
  });

  it("returns a well-formed insights payload for staff", async () => {
    const res = await adminReq("/admin/insights?window=30", staff.jwt);
    expect(res.status).toBe(200);
    const { insights } = await res.json();
    expect(insights.window.days).toBe(30);
    expect(insights.kpis.activeCreators.value).toBeGreaterThanOrEqual(1); // seeded joined+submitted
    expect(insights.funnel.joined).toBeGreaterThanOrEqual(1);
    expect(insights.levels).toHaveLength(7);
    expect(insights.levels[0].level).toBe("L0");
    expect(Array.isArray(insights.trend)).toBe(true);
    expect(insights.trend.length).toBe(30);
  });
});
```

- [ ] **Step 2: Append the file to the `test:integration` script in `package.json`**

Find the `"test:integration":` line and append ` server/test/insights.test.ts` to the **end** of the space-separated file list (after `server/test/notifications-api.test.ts`). The resulting tail reads:

```
... server/test/notifications-triggers.test.ts server/test/notifications-api.test.ts server/test/insights.test.ts
```

- [ ] **Step 3: Run the integration suite for this file**

> Requires the local Supabase stack + a `.env.test.local` exported into the shell (never source `.env.local` — that is PROD). If the stack is down the suite auto-skips (`describe.skip`); that is acceptable for local iteration but note it in the PR.

Run: `RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/insights.test.ts`
Expected: PASS (3 tests) when env present, otherwise SKIPPED.

- [ ] **Step 4: Commit**

```bash
git add server/test/insights.test.ts package.json
git commit -m "test(insights): add GET /admin/insights integration test"
```

---

### Task 10: Client wiring (types + key + fetcher)

**Files:**
- Modify: `src/lib/admin.ts`

- [ ] **Step 1: Add the `insights` key to the existing `adminKeys` factory**

Replace the `adminKeys` object (currently `applications`/`submissions`/`engaged`) with the version that adds `insights`:

```ts
export const adminKeys = {
  applications: (workspace: string) => ["admin-applications", workspace] as const,
  submissions: (status: string, workspace: string) => ["admin-submissions", status, workspace] as const,
  engaged: (workspace: string) => ["admin-engaged", workspace] as const,
  insights: (workspace: string, window: number) => ["admin-insights", workspace, window] as const,
};
```

- [ ] **Step 2: Add the Insights types + fetcher**

Add at the end of the file (after the last export), mirroring `server/lib/insights.ts`:

```ts
// ---- Insights dashboard (mirrors server/lib/insights.ts — keep in sync) ----
export type InsightsMetric = { value: number; prev: number; deltaPct: number | null };

export type Insights = {
  window: { days: 7 | 30 | 90; from: string; to: string };
  kpis: {
    activeCreators: InsightsMetric;
    submitToApprove: InsightsMetric;
    pointsIssued: InsightsMetric;
    cashPaid: InsightsMetric;
    missionFillRate: InsightsMetric;
    completions: InsightsMetric;
  };
  funnel: { joined: number; submitted: number; approved: number; joinToSubmit: number; submitToApprove: number };
  levels: Array<{ level: string; count: number }>;
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};

export function fetchInsights(workspace = "", window = 30) {
  const parts = [`window=${window}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ insights: Insights }>(`/admin/insights?${parts.join("&")}`);
}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin.ts
git commit -m "feat(insights): add adminKeys.insights + fetchInsights client wiring"
```

---

### Task 11: TrendChart component (TDD)

**Files:**
- Create: `src/components/admin/TrendChart.tsx`
- Test: `src/components/admin/TrendChart.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/TrendChart.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart, type TrendPoint } from "./TrendChart";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

const populated: TrendPoint[] = [
  { bucket: "2026-06-01", joined: 2, submitted: 1, approved: 0 },
  { bucket: "2026-06-02", joined: 3, submitted: 2, approved: 1 },
];
const zeros: TrendPoint[] = [
  { bucket: "2026-06-01", joined: 0, submitted: 0, approved: 0 },
  { bucket: "2026-06-02", joined: 0, submitted: 0, approved: 0 },
];

describe("TrendChart", () => {
  it("renders an accessible svg chart when there is data", () => {
    render(<TrendChart data={populated} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img.querySelectorAll("path").length).toBe(3); // joined/submitted/approved series
  });

  it("renders the empty state when all values are zero", () => {
    render(<TrendChart data={zeros} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("未有足夠數據")).toBeInTheDocument(); // app.insights.trendEmpty (zh)
  });

  it("renders the empty state when there is no data at all", () => {
    render(<TrendChart data={[]} />);
    expect(screen.getByText("未有足夠數據")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/admin/TrendChart.test.tsx`
Expected: FAIL with "Failed to resolve import ./TrendChart".

> The empty-state assertion also needs the `app.insights.trendEmpty` key — it is added in Task 12. If Task 12 runs after this, the empty-state test temporarily resolves the raw key string; add the i18n keys (Task 12) before re-running the full gate. To keep this task self-contained, run Task 12's i18n step first if you prefer strict green-at-every-step.

- [ ] **Step 3: Write the component**

```tsx
// src/components/admin/TrendChart.tsx
import { useI18n } from "@/lib/i18n";

export type TrendPoint = { bucket: string; joined: number; submitted: number; approved: number };

const SERIES = [
  { key: "joined", stroke: "var(--color-ink)" },
  { key: "submitted", stroke: "var(--color-cyan)" },
  { key: "approved", stroke: "var(--color-acid)" },
] as const;

const W = 640;
const H = 200;
const PAD = 24;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const { t } = useI18n();
  const allZero = data.every((d) => d.joined === 0 && d.submitted === 0 && d.approved === 0);

  if (data.length === 0 || allZero) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-[var(--radius)] border-2 border-dashed border-[var(--color-soft-ink)] text-sm text-[var(--color-soft-ink)]">
        {t("app.insights.trendEmpty")}
      </div>
    );
  }

  const max = Math.max(1, ...data.flatMap((d) => [d.joined, d.submitted, d.approved]));
  const x = (i: number) =>
    PAD + (data.length === 1 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (data.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const path = (key: "joined" | "submitted" | "approved") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("app.insights.trendTitle")}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-ink)" strokeWidth="1.5" />
      {SERIES.map((s) => (
        <path
          key={s.key}
          d={path(s.key)}
          fill="none"
          stroke={s.stroke}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/admin/TrendChart.test.tsx`
Expected: PASS (3 tests) — requires `app.insights.trendEmpty`/`trendTitle` keys from Task 12.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/TrendChart.tsx src/components/admin/TrendChart.test.tsx
git commit -m "feat(insights): add bespoke SVG TrendChart with empty state"
```

---

### Task 12: Insights i18n keys (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add the `app.insights.*` keys to the `en` block**

Add after the `app.admin.*` keys you added in Task 1 (anywhere inside the `en` object):

```ts
    "app.insights.heading": "Insights",
    "app.insights.window7": "7 days",
    "app.insights.window30": "30 days",
    "app.insights.window90": "90 days",
    "app.insights.kpiActiveCreators": "Active creators",
    "app.insights.kpiSubmitToApprove": "Submit → approve",
    "app.insights.kpiPointsIssued": "Points issued",
    "app.insights.kpiCashPaid": "Cash paid",
    "app.insights.kpiMissionFillRate": "Mission fill rate",
    "app.insights.kpiCompletions": "Completions",
    "app.insights.funnelTitle": "Engagement funnel",
    "app.insights.funnelJoined": "Joined",
    "app.insights.funnelSubmitted": "Submitted",
    "app.insights.funnelApproved": "Approved",
    "app.insights.levelsTitle": "Level distribution",
    "app.insights.trendTitle": "Activity trend",
    "app.insights.trendEmpty": "Not enough data yet",
    "app.insights.trendJoined": "Joined",
    "app.insights.trendSubmitted": "Submitted",
    "app.insights.trendApproved": "Approved",
    "app.insights.radarTitle": "At-risk radar",
    "app.insights.radarSoon": "Coming soon",
    "app.insights.deltaNone": "—",
```

- [ ] **Step 2: Add the SAME keys to the `zh` block**

```ts
    "app.insights.heading": "洞察",
    "app.insights.window7": "7 天",
    "app.insights.window30": "30 天",
    "app.insights.window90": "90 天",
    "app.insights.kpiActiveCreators": "活躍創作者",
    "app.insights.kpiSubmitToApprove": "提交 → 批准",
    "app.insights.kpiPointsIssued": "已發放積分",
    "app.insights.kpiCashPaid": "已發放現金",
    "app.insights.kpiMissionFillRate": "任務填充率",
    "app.insights.kpiCompletions": "完成次數",
    "app.insights.funnelTitle": "互動漏斗",
    "app.insights.funnelJoined": "已加入",
    "app.insights.funnelSubmitted": "已提交",
    "app.insights.funnelApproved": "已批准",
    "app.insights.levelsTitle": "等級分佈",
    "app.insights.trendTitle": "活動趨勢",
    "app.insights.trendEmpty": "未有足夠數據",
    "app.insights.trendJoined": "已加入",
    "app.insights.trendSubmitted": "已提交",
    "app.insights.trendApproved": "已批准",
    "app.insights.radarTitle": "風險雷達",
    "app.insights.radarSoon": "即將推出",
    "app.insights.deltaNone": "—",
```

- [ ] **Step 3: Run the i18n parity test**

Run: `npm test -- src/lib/i18n.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "feat(insights): add insights dashboard i18n keys (en + zh)"
```

---

### Task 13: Insights page route (TDD route-stub)

**Files:**
- Create: `src/routes/admin.insights.tsx`
- Test: `src/routes/-admin.insights.test.tsx`

- [ ] **Step 1: Write the failing route-stub test**

```tsx
// src/routes/-admin.insights.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchInsights: vi.fn(), reportAuthError: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", () => ({
  fetchInsights: h.fetchInsights,
  adminKeys: { insights: (ws: string, w: number) => ["admin-insights", ws, w] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.insights";
import { AdminAuthError } from "@/lib/admin";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

const payload = {
  insights: {
    window: { days: 30, from: "2026-05-31T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z" },
    kpis: {
      activeCreators: { value: 12, prev: 8, deltaPct: 50 },
      submitToApprove: { value: 66.7, prev: 70, deltaPct: -4.7 },
      pointsIssued: { value: 3400, prev: 3400, deltaPct: 0 },
      cashPaid: { value: 1280.5, prev: 0, deltaPct: null },
      missionFillRate: { value: 25, prev: 0, deltaPct: null },
      completions: { value: 9, prev: 5, deltaPct: 80 },
    },
    funnel: { joined: 20, submitted: 12, approved: 8, joinToSubmit: 60, submitToApprove: 66.7 },
    levels: [
      { level: "L0", count: 5 },
      { level: "L1", count: 3 },
      { level: "L2", count: 0 },
      { level: "L3", count: 0 },
      { level: "L4", count: 0 },
      { level: "L5", count: 0 },
      { level: "L6", count: 0 },
    ],
    trend: [
      { bucket: "2026-06-29", joined: 2, submitted: 1, approved: 1 },
      { bucket: "2026-06-30", joined: 3, submitted: 2, approved: 1 },
    ],
  },
};

describe("admin insights page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("shows a loading skeleton before data resolves", () => {
    h.fetchInsights.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = r();
    expect(container.querySelector(".skeleton-acid")).not.toBeNull();
  });

  it("renders KPI values and the active-creators delta", async () => {
    h.fetchInsights.mockResolvedValue(payload);
    r();
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument()); // active creators
    expect(screen.getByText("活躍創作者")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument(); // delta badge
    // null delta renders the em dash, not "0%"
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("reports auth errors through reportAuthError", async () => {
    h.fetchInsights.mockRejectedValue(new AdminAuthError("unauthorized"));
    r();
    await waitFor(() => expect(h.reportAuthError).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/routes/-admin.insights.test.tsx`
Expected: FAIL with "Failed to resolve import ./admin.insights".

- [ ] **Step 3: Write the page**

```tsx
// src/routes/admin.insights.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminKeys, fetchInsights, type Insights, type InsightsMetric } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { TrendChart } from "@/components/admin/TrendChart";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/insights")({ component: InsightsPage });

type Win = 7 | 30 | 90;

function fmtNumber(n: number): string {
  return n.toLocaleString();
}
function fmtPct(n: number): string {
  return `${n}%`;
}
function fmtCash(n: number): string {
  return `HK$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DeltaBadge({ metric }: { metric: InsightsMetric }) {
  const { t } = useI18n();
  if (metric.deltaPct === null) {
    return <span className="text-xs text-[var(--color-soft-ink)]">{t("app.insights.deltaNone")}</span>;
  }
  const up = metric.deltaPct > 0;
  const flat = metric.deltaPct === 0;
  const cls = flat ? "metric-badge" : up ? "metric-badge metric-up" : "metric-badge metric-down";
  const sign = up ? "+" : "";
  return <span className={cls}>{`${sign}${metric.deltaPct}%`}</span>;
}

function KpiCard({
  label,
  metric,
  format,
  primary = false,
}: {
  label: string;
  metric: InsightsMetric;
  format: (n: number) => string;
  primary?: boolean;
}) {
  if (primary) {
    return (
      <div className="wallet-card p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-paper)] opacity-80">{label}</p>
        <p className="mt-1 font-display text-4xl font-bold text-[var(--color-acid)]">{format(metric.value)}</p>
        <div className="mt-2">
          <DeltaBadge metric={metric} />
        </div>
      </div>
    );
  }
  return (
    <div className="pastel-card p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{format(metric.value)}</p>
      <div className="mt-2">
        <DeltaBadge metric={metric} />
      </div>
    </div>
  );
}

function FunnelView({ funnel }: { funnel: Insights["funnel"] }) {
  const { t } = useI18n();
  const stages = [
    { label: t("app.insights.funnelJoined"), value: funnel.joined },
    { label: t("app.insights.funnelSubmitted"), value: funnel.submitted },
    { label: t("app.insights.funnelApproved"), value: funnel.approved },
  ];
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.insights.funnelTitle")}</h2>
      <div className="mt-3 flex items-end gap-3">
        {stages.map((s) => (
          <div key={s.label} className="flex-1 text-center">
            <p className="font-display text-2xl font-bold">{fmtNumber(s.value)}</p>
            <p className="text-xs text-[var(--color-soft-ink)]">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-xs text-[var(--color-soft-ink)]">
        {`${t("app.insights.funnelJoined")} → ${t("app.insights.funnelSubmitted")}: ${fmtPct(funnel.joinToSubmit)} · ${t(
          "app.insights.funnelSubmitted",
        )} → ${t("app.insights.funnelApproved")}: ${fmtPct(funnel.submitToApprove)}`}
      </p>
    </div>
  );
}

function LevelBars({ levels }: { levels: Insights["levels"] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...levels.map((l) => l.count));
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.insights.levelsTitle")}</h2>
      <div className="mt-3 space-y-2">
        {levels.map((l) => (
          <div key={l.level} className="flex items-center gap-3">
            <span className={`level-pill level-pill-${l.level.toLowerCase()} w-14 justify-center`}>{l.level}</span>
            <div className="xp-bar flex-1">
              <div className="xp-bar-fill" style={{ width: `${(l.count / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right font-mono text-xs">{l.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WindowSelector({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const { t } = useI18n();
  const opts: Array<{ w: Win; label: string }> = [
    { w: 7, label: t("app.insights.window7") },
    { w: 30, label: t("app.insights.window30") },
    { w: 90, label: t("app.insights.window90") },
  ];
  return (
    <div className="flex gap-2">
      {opts.map((o) => (
        <button
          key={o.w}
          type="button"
          onClick={() => onChange(o.w)}
          className={value === o.w ? "filter-pill filter-pill-active" : "filter-pill"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-acid skeleton-card" />
      ))}
    </div>
  );
}

function InsightsPage() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const [win, setWin] = useState<Win>(30);

  const q = useQuery({
    queryKey: adminKeys.insights(workspace, win),
    queryFn: () => fetchInsights(workspace, win),
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = q.data?.insights;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t("app.insights.heading")}</h1>
        <WindowSelector value={win} onChange={setWin} />
      </div>

      {!data ? (
        <InsightsSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.insights.kpiActiveCreators")} metric={data.kpis.activeCreators} format={fmtNumber} primary />
            <KpiCard label={t("app.insights.kpiCompletions")} metric={data.kpis.completions} format={fmtNumber} />
            <KpiCard label={t("app.insights.kpiSubmitToApprove")} metric={data.kpis.submitToApprove} format={fmtPct} />
            <KpiCard label={t("app.insights.kpiPointsIssued")} metric={data.kpis.pointsIssued} format={fmtNumber} />
            <KpiCard label={t("app.insights.kpiCashPaid")} metric={data.kpis.cashPaid} format={fmtCash} />
            <KpiCard label={t("app.insights.kpiMissionFillRate")} metric={data.kpis.missionFillRate} format={fmtPct} />
          </div>

          <div className="pastel-card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold">{t("app.insights.trendTitle")}</h2>
              <p className="font-mono text-[11px] text-[var(--color-soft-ink)]">
                {`${t("app.insights.trendJoined")} · ${t("app.insights.trendSubmitted")} · ${t("app.insights.trendApproved")}`}
              </p>
            </div>
            <TrendChart data={data.trend} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <FunnelView funnel={data.funnel} />
            <LevelBars levels={data.levels} />
          </div>

          {/* Slice 2 teaser — locked, matches the nav locked idiom */}
          <div className="pastel-card p-5 opacity-60">
            <h2 className="font-heading text-base font-bold">{t("app.insights.radarTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.insights.radarSoon")}</p>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Regenerate the route tree + run the test**

Run: `npm run type-check`  (runs `tsr generate`, adding `/admin/insights` to `routeTree.gen.ts`)
Expected: PASS.
Run: `npm test -- src/routes/-admin.insights.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.insights.tsx src/routes/-admin.insights.test.tsx src/routeTree.gen.ts
git commit -m "feat(insights): add /admin/insights dashboard page"
```

---

### Task 14: Flip the default landing redirect

**Files:**
- Modify: `src/routes/admin.index.tsx`

- [ ] **Step 1: Change the redirect target**

```tsx
// src/routes/admin.index.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/insights" });
  },
});
```

- [ ] **Step 2: Update the index redirect test if one exists**

Run: `grep -rn "admin/applications" src/routes/-admin*.test.tsx`
If a test asserts the redirect target is `/admin/applications`, update it to `/admin/insights`. If no such test exists, skip.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.index.tsx
git commit -m "feat(admin): land /admin on the Insights dashboard"
```

---

### Task 15: Full gate run + PR

- [ ] **Step 1: Run every gate**

```bash
npm run type-check && npm run lint && npm run build && npm test
```
Expected: all PASS. `npm run build` includes `check:esm` (confirms `.js` extensions in the new server files).

- [ ] **Step 2: Run the integration suite (if local Supabase + `.env.test.local` available)**

```bash
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/insights.test.ts
```
Expected: PASS, or SKIPPED if the stack is down (note which in the PR).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/admin-saas-insights
gh pr create --title "Admin SaaS shell + Insights dashboard" \
  --body "Slice 0 (SaaS sidebar shell) + Slice 1 (read-only Insights dashboard). No migration, no new env var, no write paths. See docs/superpowers/plans/2026-06-24-admin-saas-shell-insights.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Deploy note**

Merge → Vercel Git deploy. **Never `vercel --prod` from local** (mis-bundles the API). No Supabase migration and no env changes are required for these two slices.

---

## Post-implementation verification checklist

- [ ] `/admin` redirects to `/admin/insights` and the Insights item is highlighted in the sidebar.
- [ ] Sidebar shows four groups (Analytics / Review queue / Audience / Library); Applications & Submissions show live count badges; Segments is greyed, non-clickable, with a "soon" pill.
- [ ] Top bar shows the active page title, the workspace switcher, the staff email, and a working sign-out.
- [ ] At `< lg` width: the sidebar is hidden, the hamburger toggles an in-flow drawer (no `position: fixed` overlay), and tapping a nav item closes it.
- [ ] Insights: window selector (7/30/90, default 30) re-queries; 6 KPI cards render (Active creators as the ink/acid primary card); deltas show ▲cyan/▼magenta and "—" when prior is 0; funnel + level bars + SVG trend render; trend shows the empty state on no data; the "At-risk radar — coming soon" tile is greyed.
- [ ] `GET /api/admin/insights` returns 401 unauthenticated, 422 for `window=5`, 200 with `{ insights }` for staff.

---

## Self-review (performed against the spec)

- **Spec coverage:** Slice 0 §3 — AdminSideNav grouped IA (Task 2/4), top bar + relocated WorkspaceSwitcher (Task 5), `lg:pl-60` layout + mobile drawer (Task 6), locked placeholder (Task 4), count-badge cache reuse (Task 3), i18n (Task 1), default-landing flip (Task 14), AdminTabs removal (Task 6). Slice 1 §4 — route + Hono sub-route + pure shaper (Tasks 7/8), all 6 KPIs incl. Cash paid + deltas (Task 7/13), funnel + level dist + SVG TrendChart + window selector + locked radar tile + skeletons (Tasks 11/13), client wiring (Task 10), i18n (Task 12), cross-workspace correctness via confirmed `mission_submissions.workspace_id` (Task 8). Testing §5 — unit (Task 7), component (Tasks 4/11), route-stub (Task 13), sidebar (Task 4), integration + package.json append (Task 9). No spec requirement is left without a task.
- **Open items from the spec resolved:** `missions` quota column = `quota`/`filled` (confirmed); `mission_submissions` has its own `workspace_id` (confirmed — filter directly, no join); cash = `earnings_transactions.amount` where `type='earn'`.
- **Type consistency:** `Insights`/`InsightsMetric` shapes match between `server/lib/insights.ts` (`Metric`) and `src/lib/admin.ts` (`InsightsMetric`), and the route-stub test payload (Task 13) matches both. `shapeInsights` signature, `adminKeys.insights(workspace, window)`, and `fetchInsights(workspace, window)` are consistent across Tasks 7/8/10/13. `AdminNavItem.countKey` values (`"applications"|"submissions"`) match `useAdminQueueCounts` return keys.
- **Known acceptable gap:** the integration suite auto-skips without a local Supabase stack — flagged in Tasks 9 and 15.
