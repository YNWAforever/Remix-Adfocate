# Wide-Desktop Responsive Implementation Plan

**Goal:** Make the whole app wide-desktop friendly (stop looking like a phone app on big screens) while keeping mobile intact. Frontend-only, neo-brutalist style preserved.

**Strategy (per ui-ux-pro-max §5 Layout & §9 Navigation):**
1. **Adaptive nav** — add a left **SideNav** on `lg+` (≥1024px); the existing **BottomNav** becomes mobile-only (`lg:hidden`). Both share one `NAV_ITEMS` list. Content area offsets right of the sidebar (`lg:pl-60`) and drops bottom padding on desktop. Hide both navs on auth/onboarding routes.
2. **Content width** — widen content/list pages from `max-w-lg` to `lg:max-w-5xl` and use responsive grids for lists; detail pages get two-column; reading pages get a readable `max-w-2xl`; forms stay narrow.

**Tech:** React 19, TanStack Router (file routes; `-` prefixed test files are non-routes), Tailwind v4 CSS vars. Branch: `feat/responsive-desktop` (off main). Brand vars: `--color-ink`, `--color-acid`, `--color-paper`, `--color-soft-ink`, `--radius`.

**Conventions:** Avoid layout shift on active nav state (inactive items carry `border-2 border-transparent` so the active border doesn't reflow). Don't stretch single-column text to full width (keep readable measure). Tests stay behavioral.

---

## Task 1: Adaptive navigation shell

**Files:** create `src/components/navItems.ts`, `src/components/SideNav.tsx`, `src/components/SideNav.test.tsx`; modify `src/components/BottomNav.tsx`, `src/routes/_app.tsx`.

### Step 1: Shared nav items — `src/components/navItems.ts`
```tsx
import { Home, Target, Gift, Wallet, Compass, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; exact: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/home", label: "主頁", icon: Home, exact: true },
  { to: "/mission", label: "任務", icon: Target, exact: false },
  { to: "/redemption", label: "積分兌換", icon: Gift, exact: false },
  { to: "/wallet", label: "錢包", icon: Wallet, exact: false },
  { to: "/explore", label: "探索", icon: Compass, exact: false },
];
```

### Step 2: BottomNav — consume NAV_ITEMS + become mobile-only
Refactor `src/components/BottomNav.tsx` to map `NAV_ITEMS` (instead of its local `TABS`) and add `lg:hidden` to the `<nav>` className. Keep everything else identical (same `glass-panel fixed bottom-0 inset-x-0 z-40 ... pb-[env(safe-area-inset-bottom)]`, same active styling). The existing `BottomNav.test.tsx` must still pass.

### Step 3: SideNav (desktop) — `src/components/SideNav.tsx`
```tsx
import { Link } from "@tanstack/react-router";
import { NAV_ITEMS } from "./navItems";

const ITEM = "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)]";
const ITEM_ACTIVE = "flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2 font-heading text-sm font-bold text-[var(--color-ink)]";

export function SideNav() {
  return (
    <nav
      aria-label="主要導航"
      className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col gap-1 border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4"
    >
      <Link to="/home" className="mb-4 px-3 font-display text-2xl font-bold">
        Adfocate
      </Link>
      {NAV_ITEMS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            to={t.to}
            activeOptions={{ exact: t.exact }}
            className={ITEM}
            activeProps={{ className: ITEM_ACTIVE }}
          >
            <Icon size={20} aria-hidden />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

### Step 4: SideNav test — `src/components/SideNav.test.tsx`
Mock `@tanstack/react-router`'s `Link` to a plain anchor (same pattern as `BottomNav.test.tsx`). Assert the 5 destinations render with their labels and correct hrefs (`/home`, `/mission`, `/redemption`, `/wallet`, `/explore`).

### Step 5: Shell — `src/routes/_app.tsx`
In `Layout()`:
- Import `SideNav`.
- Hide BOTH navs on auth/onboarding routes: derive the current path (use `useRouterState({ select: (s) => s.location.pathname })` or `useLocation`) and compute `const showNav = !(path === "/login" || path.startsWith("/auth/") || path.startsWith("/onboarding"))`.
- Wrapper className: `min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]` + (when `showNav`) `pb-20 lg:pb-0 lg:pl-60`; when nav hidden, no `pb-20`/`lg:pl-60`.
- Render `{showNav && <SideNav />}`, `<main><Outlet /></main>`, `<LevelUpModal />`, `{showNav && <BottomNav />}`.

Keep `beforeLoad` and the `useWorkspace`/`applyTheme` effect unchanged.

### Step 6: Verify + commit
`npx vitest run src/components/BottomNav.test.tsx src/components/SideNav.test.tsx` → pass. `npm run type-check` → clean.
```
git add src/components/navItems.ts src/components/SideNav.tsx src/components/SideNav.test.tsx src/components/BottomNav.tsx src/routes/_app.tsx
git commit -m "feat: adaptive nav — desktop sidebar (lg+) + mobile bottom nav"
```

---

## Per-page widening (Tasks 2–6)

For every page below, the subagent READS the current page, then applies the responsive treatment WITHOUT changing behavior, copy, data flow, or tests' asserted text/roles. The standard moves:
- Outer container: `mx-auto max-w-lg ... p-4` → `mx-auto w-full max-w-lg ... p-4 lg:max-w-5xl` (content/list/detail) — match the pattern already used in `_app.profile.tsx`/`_app.passport.tsx`.
- Lists/grids of cards: add `lg:grid-cols-2` (or `lg:grid-cols-3` for compact tiles) on desktop; single column on mobile.
- Detail pages: two-column `lg:grid-cols-[1.5fr_1fr]` (primary content left, facts/CTA right) where it fits.
- Reading/legal pages: `lg:max-w-2xl` (keep readable measure; do NOT stretch to 5xl).
- Forms: keep narrow (`max-w-lg`/`max-w-md`), do not widen.
- Loading/error states inside each page should get the SAME widened container as the success state for visual consistency (or stay narrow — match the page's main container).
Each task ends with `npm run type-check` clean + a commit. Tests for these pages (if any `-_app.*.test.tsx`) must still pass unchanged.

## Task 2: Main feed pages — `_app.home.tsx`, `_app.explore.tsx`
Widen to `lg:max-w-5xl`; arrange their card sections into responsive grids on desktop (e.g. 2-col). Commit: `feat: responsive desktop layout for home + explore`.

## Task 3: Mission pages — `_app.mission.index.tsx`, `_app.mission.$missionSlug.tsx`, `_app.mission.tsx`
Mission list → `lg:max-w-5xl` + `lg:grid-cols-2` card grid. Mission detail/brief → `lg:max-w-5xl` two-column (brief left, `MissionFacts`/CTA right). `_app.mission.tsx` is the layout wrapper with the `<Outlet/>` — only widen if it sets a container; otherwise leave. Commit: `feat: responsive desktop layout for mission list + detail`.

## Task 4: Earn/track pages — `_app.match.tsx`, `_app.my.tsx`
Both are ranked/owned mission lists → `lg:max-w-5xl` + responsive card grid. Commit: `feat: responsive desktop layout for match + my missions`.

## Task 5: Wallet + redemption — `_app.wallet.tsx`, `_app.redemption.index.tsx`, `_app.redemption.history.tsx`
Wallet → `lg:max-w-5xl`, balance card + transaction list (two-column or wide). Redemption index (rewards) → `lg:max-w-5xl` + `lg:grid-cols-2/3` reward grid. Redemption history → `lg:max-w-3xl` list (wider but not a grid). Commit: `feat: responsive desktop layout for wallet + redemption`.

## Task 6: Public + reading pages — `passport.$token.tsx`, `_app.privacy.tsx`, `_app.tnc.tsx`
Public passport (`passport.$token.tsx`) → mirror `_app.passport.tsx`'s `lg:max-w-5xl` two-column showcase. Privacy + TnC (legal text) → `lg:max-w-2xl` readable measure (do not stretch). Commit: `feat: responsive desktop layout for public passport + legal pages`.

(Leave forms `_app.onboarding.tsx`, `_app.login.tsx` narrow — no change. Operator pages already partly responsive — out of scope unless trivial.)

## Task 7: Verification + PR
- `npm test` → all pass. `npm run type-check` → clean. `npm run lint` → clean. `npm run build` → green.
- Commit any codegen if produced.
- Push `feat/responsive-desktop`, open PR → main.

---

## Notes / decisions
- **No sidebar/bottom-nav on login/onboarding** — fixes a pre-existing quirk where app nav showed on auth screens.
- **`max-w-5xl` (1024px)** is the shared desktop content cap (same as profile/passport reorg) so the whole app feels consistent.
- **Reading pages capped narrower** (`max-w-2xl`) to preserve 65–75 char line length (§6).
- Tests are behavioral (text/roles/hrefs); responsive class changes shouldn't touch them.
