# KOCmax Member Shell Re-skin (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the deployed KOCmax member app into the neon "Acid Y2K" design language and round it out to an 8-screen member shell + OTP login, wired to the existing Supabase backend — with no schema or API changes.

**Architecture:** Hybrid port. Copy the Acid Y2K design *foundation* (the `@theme` tokens + utility classes) verbatim from the sibling prototype `refreshing-adfocate/`, then rebuild the screens as thin presentational components wired to the **existing** TanStack Query hooks (`src/lib/queries/kocmax.ts`) and Hono REST API. Login swaps LINE OAuth for Supabase Email OTP.

**Tech Stack:** React 19, Vite 7, TanStack Router + Query v5, Tailwind v4 (CSS `@theme`), `@supabase/supabase-js`, Vitest + Testing Library. Package manager: npm. Node 22.

**Spec:** `adfocate-2/docs/superpowers/specs/2026-06-13-adfocate-kocmax-reskin-design.md`. Re-baseline: `.../2026-06-13-adfocate-2.0-architecture-supabase-rebaseline.md`.

**Working directory:** all paths are relative to `adfocate-2/` unless stated. The prototype is the sibling repo at `../refreshing-adfocate/` (same machine). Slice 1 is already deployed; this plan is purely additive/presentational.

---

## File Structure

```
adfocate-2/
  index.html                          # MODIFY: add Google Fonts links
  src/
    styles.css                        # MODIFY: replace placeholder @theme with full Acid Y2K foundation
    components/                        # CREATE: prop-only presentational components
      BottomNav.tsx
      PointsBalanceCard.tsx
      MissionCard.tsx
      RewardCard.tsx
      BadgePill.tsx
      ProgressBar.tsx
      FilterPills.tsx
      SkeletonCard.tsx
      *.test.tsx                       # render tests for the above
    routes/
      kocmax.$slug.tsx                 # MODIFY: re-skin layout, swap 4-tab → 5-tab BottomNav
      kocmax.$slug.index.tsx           # MODIFY: re-skin Home
      kocmax.$slug.mission.tsx         # MODIFY: re-skin Mission list
      kocmax.$slug.mission.$missionSlug.tsx  # MODIFY: re-skin Mission detail
      kocmax.$slug.redemption.tsx      # MODIFY: re-skin Redemption
      kocmax.$slug.wallet.tsx          # MODIFY: re-skin Wallet
      kocmax.$slug.login.tsx           # MODIFY: replace LINE OAuth with Email OTP flow
      kocmax.$slug.explore.tsx         # CREATE: static Explore/FAQ
      kocmax.$slug.tnc.tsx             # CREATE: static Terms & Conditions
      kocmax.$slug.privacy.tsx         # CREATE: static Privacy Policy
```

Existing data hooks (do NOT change): `useMissions(category?)`, `useMission(slug)`, `useGifts(category?)`, `useBalance()`, `usePointHistory()`, `useMe()` in `src/lib/queries/kocmax.ts`; `useRealtimeBalance(creatorId)` in `src/lib/useRealtimeBalance.ts`; `apiFetch(path, init)` in `src/lib/api.ts`; `applyTheme(theme)` in `src/lib/theme.ts`; browser client `supabase` in `src/lib/supabase.ts`.

Existing query return types (from `src/lib/queries/kocmax.ts`): `Mission { id, slug, title, description?, category?, mission_type, points_reward, deadline?, quota, filled, status }`, `Gift { id, name, category?, points_cost, stock_remaining, gift_type, image_url?, status }`, `Balance { balance, available_to }`, `Txn { id, type, delta, balance_after, description?, created_at }`, `Me { id, display_name?, level, xp }`.

---

## Task 1: Port the Acid Y2K design foundation

**Files:**
- Modify: `src/styles.css`
- Modify: `index.html`

- [ ] **Step 1: Replace the `@theme` in `src/styles.css` with the prototype's full Acid Y2K foundation**

Open `../refreshing-adfocate/src/styles.css`. Copy **everything after** its `@import "tailwindcss";` line — the entire `@theme { … }` block AND all custom utility/class rules and `@keyframes` — into `adfocate-2/src/styles.css`, replacing the current placeholder `@theme` block and any placeholder body. Keep `@import "tailwindcss";` as line 1. Do not copy any `@import` of mock data (there are none in CSS).

After pasting, verify these tokens are present in the `@theme` (spot-check — they are the identity of the system):
```
--color-acid: #D4FF00;  --color-magenta: #D81B60;  --color-magenta-pop: #FF3D7F;
--color-violet: #7C5CFF; --color-cyan: #00E5FF;     --color-ink: #0A0A0A;
--color-paper: #EFEFEF;  --color-card: #FFFFFF;     --color-soft-ink: #4A4A4A;
--color-primary: #D4FF00; --color-secondary: #D81B60; --color-accent: #7C5CFF;
--font-display: "Space Grotesk", "Noto Sans TC", system-ui, sans-serif;
--font-body: "DM Sans", "Noto Sans TC", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
--radius: 1.25rem;
--ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);
```
And these utility classes exist: `.pastel-card`, `.game-card`, `.btn-primary`, `.btn-ink`, `.pill-btn`, `.filter-pill`, `.status-live/.status-closing/.status-open/.status-end`, `.wallet-card`, `.xp-bar`, `.skeleton-acid/.skeleton-card/.skeleton-pill/.skeleton-text`, `.glass-panel`, `.dot-pattern`, plus the `:focus-visible` and `prefers-reduced-motion` rules.

- [ ] **Step 2: Add the fonts to `index.html`**

In `index.html`, inside `<head>` (after the `<meta name="viewport" …>` line), add:
```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: `tsr generate && tsc --noEmit && vite build` completes, writes `dist/`, no CSS/TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css index.html
git commit -m "feat(web): port Acid Y2K design foundation (tokens, utilities, fonts)"
```

---

## Task 2: Re-skin the layout + 5-tab BottomNav

**Files:**
- Create: `src/components/BottomNav.tsx`
- Test: `src/components/BottomNav.test.tsx`
- Modify: `src/routes/kocmax.$slug.tsx`

- [ ] **Step 1: Write the failing render test**

Create `src/components/BottomNav.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { BottomNav } from "./BottomNav";

function renderNav() {
  const root = createRootRoute({ component: () => <BottomNav slug="demo" /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<RouterProvider router={router as never} />);
}

describe("BottomNav", () => {
  it("renders all five member tabs", () => {
    renderNav();
    for (const label of ["主頁", "任務", "積分兌換", "錢包", "探索"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/BottomNav.test.tsx`
Expected: FAIL — cannot find module `./BottomNav`.

- [ ] **Step 3: Implement `BottomNav`**

Create `src/components/BottomNav.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { Home, Target, Gift, Wallet, Compass } from "lucide-react";

const TABS = [
  { to: "/kocmax/$slug", label: "主頁", icon: Home, exact: true },
  { to: "/kocmax/$slug/mission", label: "任務", icon: Target, exact: false },
  { to: "/kocmax/$slug/redemption", label: "積分兌換", icon: Gift, exact: false },
  { to: "/kocmax/$slug/wallet", label: "錢包", icon: Wallet, exact: false },
  { to: "/kocmax/$slug/explore", label: "探索", icon: Compass, exact: false },
] as const;

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
```
> `lucide-react` is already a dependency (used in Slice 1 / available). If `npm ls lucide-react` shows it missing, run `npm i lucide-react` and commit `package.json` + lock in Step 6.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/BottomNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use `BottomNav` in the layout and re-skin the shell**

In `src/routes/kocmax.$slug.tsx`, keep the `beforeLoad` auth guard and `applyTheme` effect unchanged. Replace the inline `<nav>` + tabs markup in `Layout()` with the new component and a paper background:
```tsx
import { BottomNav } from "@/components/BottomNav";
// …inside Layout(), keep: const { slug } = Route.useParams(); const ws = useWorkspace(); useEffect(...applyTheme...);
return (
  <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] pb-20">
    <main><Outlet /></main>
    <BottomNav slug={slug} />
  </div>
);
```
Remove the now-unused `Link` import from this file if it is no longer referenced.

- [ ] **Step 6: Verify build + tests**

Run: `npm run build && npm test`
Expected: build OK; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/BottomNav.tsx src/components/BottomNav.test.tsx src/routes/kocmax.\$slug.tsx
git commit -m "feat(web): Acid Y2K layout shell + 5-tab BottomNav"
```

---

## Task 3: Shared presentational components

**Files:**
- Create: `src/components/BadgePill.tsx`, `ProgressBar.tsx`, `FilterPills.tsx`, `SkeletonCard.tsx`, `PointsBalanceCard.tsx`, `MissionCard.tsx`, `RewardCard.tsx`
- Test: `src/components/components.test.tsx`

- [ ] **Step 1: Write the failing render test**

Create `src/components/components.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BadgePill } from "./BadgePill";
import { FilterPills } from "./FilterPills";
import { PointsBalanceCard } from "./PointsBalanceCard";
import { MissionCard } from "./MissionCard";
import { RewardCard } from "./RewardCard";

describe("presentational components", () => {
  it("BadgePill shows its label", () => {
    render(<BadgePill>美容</BadgePill>);
    expect(screen.getByText("美容")).toBeInTheDocument();
  });
  it("FilterPills renders options and marks the active one pressed", () => {
    render(<FilterPills options={["全部", "美容"]} value="美容" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "美容" })).toHaveAttribute("aria-pressed", "true");
  });
  it("PointsBalanceCard shows the balance and label", () => {
    render(<PointsBalanceCard balance={1250} availableTo="2026-09-01T00:00:00Z" />);
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("你的積分餘額")).toBeInTheDocument();
  });
  it("MissionCard shows title, points and category", () => {
    render(<MissionCard title="美容精華試用" category="美容" points={300} deadline="2026-05-31" />);
    expect(screen.getByText("美容精華試用")).toBeInTheDocument();
    expect(screen.getByText(/300/)).toBeInTheDocument();
  });
  it("RewardCard shows name, cost and a sold-out badge when out of stock", () => {
    render(<RewardCard name="HK$50 現金券" pointsCost={500} stockRemaining={0} />);
    expect(screen.getByText("HK$50 現金券")).toBeInTheDocument();
    expect(screen.getByText("已換罄")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/components.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

Create `src/components/BadgePill.tsx`:
```tsx
export function BadgePill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-block rounded-full border-[1.5px] border-[var(--color-ink)] bg-[var(--color-acid)] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink)] ${className}`}>
      {children}
    </span>
  );
}
```

Create `src/components/ProgressBar.tsx`:
```tsx
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="xp-bar h-2 w-full overflow-hidden rounded-full border-[1.5px] border-[var(--color-ink)] bg-white" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full bg-[var(--color-acid)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

Create `src/components/FilterPills.tsx`:
```tsx
export function FilterPills({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={`filter-pill shrink-0 rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm ${active ? "bg-[var(--color-acid)] font-bold" : "bg-white"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
```

Create `src/components/SkeletonCard.tsx`:
```tsx
export function SkeletonCard({ className = "" }: { className?: string }) {
  return <div className={`skeleton-card ${className}`} aria-hidden />;
}
```

Create `src/components/PointsBalanceCard.tsx`:
```tsx
import { Clock } from "lucide-react";

export function PointsBalanceCard({ balance, availableTo, loading = false }: { balance: number; availableTo?: string | null; loading?: boolean }) {
  return (
    <section className="wallet-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] p-6 text-[var(--color-paper)]">
      <p className="font-mono text-xs uppercase tracking-wide opacity-80">你的積分餘額</p>
      {loading ? (
        <div className="skeleton-text mt-2 h-9 w-28" />
      ) : (
        <p className="mt-1 font-display text-4xl font-bold text-[var(--color-acid)]">{balance.toLocaleString("en-US")}</p>
      )}
      {availableTo && (
        <p className="mt-2 flex items-center gap-1 text-xs opacity-80">
          <Clock size={14} aria-hidden /> 到期：{availableTo.slice(0, 10)}
        </p>
      )}
    </section>
  );
}
```

Create `src/components/MissionCard.tsx`:
```tsx
import { Star, Clock } from "lucide-react";
import { BadgePill } from "./BadgePill";

export function MissionCard({ title, category, points, deadline, imageUrl }: { title: string; category?: string; points: number; deadline?: string; imageUrl?: string }) {
  return (
    <article className="pastel-card flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {category && <BadgePill>{category}</BadgePill>}
        <h3 className="mt-1 line-clamp-2 font-heading font-semibold">{title}</h3>
        <div className="mt-1 flex items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span className="flex items-center gap-1"><Star size={14} aria-hidden /> {points} 積分</span>
          {deadline && <span className="flex items-center gap-1"><Clock size={14} aria-hidden /> {deadline.slice(0, 10)}</span>}
        </div>
      </div>
    </article>
  );
}
```

Create `src/components/RewardCard.tsx`:
```tsx
import { Star } from "lucide-react";

export function RewardCard({ name, pointsCost, stockRemaining, imageUrl }: { name: string; pointsCost: number; stockRemaining: number; imageUrl?: string }) {
  const soldOut = stockRemaining <= 0;
  return (
    <article className="pastel-card relative flex flex-col overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-0">
      <div className="relative h-32 w-full border-b-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center bg-black/55 font-heading font-bold text-white">已換罄</span>
        )}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 font-heading font-semibold">{name}</h3>
        <p className="mt-1 flex items-center gap-1 font-bold text-[var(--color-ink)]">
          <Star size={14} className="text-[var(--color-magenta)]" aria-hidden /> {pointsCost} 積分
        </p>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/BadgePill.tsx src/components/ProgressBar.tsx src/components/FilterPills.tsx src/components/SkeletonCard.tsx src/components/PointsBalanceCard.tsx src/components/MissionCard.tsx src/components/RewardCard.tsx src/components/components.test.tsx
git commit -m "feat(web): prop-only Acid Y2K presentational components + render tests"
```

---

## Task 4: Re-skin the Home screen

**Files:**
- Modify: `src/routes/kocmax.$slug.index.tsx`

- [ ] **Step 1: Replace the Home component body**

In `src/routes/kocmax.$slug.index.tsx`, keep the `createFileRoute("/kocmax/$slug/")` export and the hook calls (`useMe`, `useBalance`, `useMissions`, `useRealtimeBalance(me.data?.id)`). Replace the returned JSX of `Home()` with:
```tsx
import { Link } from "@tanstack/react-router";
import { Target, Gift, Receipt, CalendarCheck } from "lucide-react";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { MissionCard } from "@/components/MissionCard";
// keep existing hook imports (useMe, useBalance, useMissions, useRealtimeBalance)

function Home() {
  const { slug } = Route.useParams();
  const me = useMe();
  const balance = useBalance();
  const missions = useMissions();
  useRealtimeBalance(me.data?.id);

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 text-[var(--color-ink)] shadow-[4px_4px_0_0_var(--color-ink)]">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-2 font-display text-3xl font-bold leading-[1.05]">賺取積分<br/>兌換心儀獎賞</h1>
        <p className="mt-2 text-sm">購物賺積分 · 完成任務 · 兌換獎賞</p>
      </section>

      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />

      <section className="grid grid-cols-2 gap-3">
        {[
          { to: "/kocmax/$slug/mission", label: "限時任務", icon: Target },
          { to: "/kocmax/$slug/redemption", label: "積分兌換", icon: Gift },
          { to: "/kocmax/$slug/wallet", label: "積分記錄", icon: Receipt },
          { to: "/kocmax/$slug/explore", label: "探索獎賞", icon: CalendarCheck },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} to={a.to} params={{ slug }} className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-heading font-semibold">
              <Icon size={20} aria-hidden /> {a.label}
            </Link>
          );
        })}
      </section>

      <section>
        <h2 className="mb-2 font-heading font-bold">精選任務</h2>
        {missions.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
        <div className="space-y-2">
          {missions.data?.slice(0, 3).map((m) => (
            <Link key={m.id} to="/kocmax/$slug/mission/$missionSlug" params={{ slug, missionSlug: m.slug }}>
              <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npm run build && npm test`
Expected: build OK; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/kocmax.\$slug.index.tsx
git commit -m "feat(web): re-skin Home screen (Acid Y2K, live balance + featured missions)"
```

---

## Task 5: Re-skin Mission list + detail

**Files:**
- Modify: `src/routes/kocmax.$slug.mission.tsx`
- Modify: `src/routes/kocmax.$slug.mission.$missionSlug.tsx`

- [ ] **Step 1: Re-skin the Mission list**

In `src/routes/kocmax.$slug.mission.tsx`, keep the route export. Use local category state + `useMissions(category)` + `FilterPills` + `MissionCard`:
```tsx
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMissions } from "@/lib/queries/kocmax";
import { FilterPills } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";

const CATEGORIES = ["全部", "社交", "美容", "餐飲", "生活"] as const;

function Missions() {
  const { slug } = Route.useParams();
  const [category, setCategory] = useState<string>("全部");
  const missions = useMissions(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-2xl font-bold">限時任務</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {missions.isLoading && <div className="space-y-2"><SkeletonCard className="h-24" /><SkeletonCard className="h-24" /></div>}
      <div className="space-y-2">
        {missions.data?.map((m) => (
          <Link key={m.id} to="/kocmax/$slug/mission/$missionSlug" params={{ slug, missionSlug: m.slug }}>
            <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
          </Link>
        ))}
      </div>
    </div>
  );
}
```
Keep the existing `createFileRoute("/kocmax/$slug/mission")({ component: Missions })` export (and `Route` reference) — adjust the component name to match if the current file differs.

- [ ] **Step 2: Re-skin the Mission detail**

In `src/routes/kocmax.$slug.mission.$missionSlug.tsx`, keep `useMission(missionSlug)`. Replace JSX:
```tsx
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Star, Clock } from "lucide-react";
import { useMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";

function MissionDetail() {
  const { slug, missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  return (
    <div className="mx-auto max-w-lg pb-6">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/kocmax/$slug/mission" params={{ slug }} aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data?.title ?? "任務"}</h1>
      </header>
      <div className="space-y-4 p-4">
        {m.data?.category && <BadgePill>{m.data.category}</BadgePill>}
        <h2 className="font-display text-xl font-bold">{m.data?.title}</h2>
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="mb-1 font-heading font-bold">任務詳情</h3>
          <p className="text-sm text-[var(--color-soft-ink)]">{m.data?.description}</p>
        </section>
        <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <Star className="text-[var(--color-magenta)]" aria-hidden />
          <div><p className="font-heading font-bold">獎勵積分</p><p className="font-display text-lg">{m.data?.points_reward} 積分</p></div>
        </section>
        {m.data?.deadline && (
          <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <Clock aria-hidden />
            <div><p className="font-heading font-bold">截止日期</p><p>{m.data.deadline.slice(0, 10)}</p></div>
          </section>
        )}
        <Link to="/kocmax/$slug/login" params={{ slug }} className="btn-primary block rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">開始任務</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build + tests, then commit**

Run: `npm run build && npm test`
Expected: build OK; tests PASS.
```bash
git add src/routes/kocmax.\$slug.mission.tsx src/routes/kocmax.\$slug.mission.\$missionSlug.tsx
git commit -m "feat(web): re-skin Mission list + detail"
```

---

## Task 6: Re-skin the Redemption screen

**Files:**
- Modify: `src/routes/kocmax.$slug.redemption.tsx`

- [ ] **Step 1: Replace the component body**

```tsx
import { useState } from "react";
import { useGifts, useBalance } from "@/lib/queries/kocmax";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { FilterPills } from "@/components/FilterPills";
import { RewardCard } from "@/components/RewardCard";
import { SkeletonCard } from "@/components/SkeletonCard";

const CATEGORIES = ["全部", "美容", "餐飲", "娛樂", "生活", "電子", "健康", "時尚"] as const;

function Redemption() {
  const [category, setCategory] = useState<string>("全部");
  const balance = useBalance();
  const gifts = useGifts(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      <h1 className="font-display text-2xl font-bold">積分兌換</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {gifts.isLoading && <div className="grid grid-cols-2 gap-3"><SkeletonCard className="h-48" /><SkeletonCard className="h-48" /></div>}
      <div className="grid grid-cols-2 gap-3">
        {gifts.data?.map((g) => (
          <RewardCard key={g.id} name={g.name} pointsCost={g.points_cost} stockRemaining={g.stock_remaining} imageUrl={g.image_url} />
        ))}
      </div>
    </div>
  );
}
```
Keep the `createFileRoute("/kocmax/$slug/redemption")({ component: Redemption })` export.

- [ ] **Step 2: Verify build + tests, then commit**

Run: `npm run build && npm test`
```bash
git add src/routes/kocmax.\$slug.redemption.tsx
git commit -m "feat(web): re-skin Redemption grid"
```

---

## Task 7: Re-skin the Wallet screen

**Files:**
- Modify: `src/routes/kocmax.$slug.wallet.tsx`

- [ ] **Step 1: Replace the component body**

```tsx
import { useBalance, usePointHistory } from "@/lib/queries/kocmax";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { SkeletonCard } from "@/components/SkeletonCard";

function Wallet() {
  const balance = useBalance();
  const history = usePointHistory();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-2xl font-bold">錢包</h1>
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      <h2 className="font-heading font-bold">積分記錄</h2>
      {history.isLoading && <SkeletonCard className="h-24" />}
      <ul className="space-y-2">
        {history.data?.map((t) => (
          <li key={t.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div>
              <p className="font-heading font-semibold">{t.description ?? t.type}</p>
              <p className="text-xs text-[var(--color-soft-ink)]">{t.created_at.slice(0, 10)}</p>
            </div>
            <span className={`font-display font-bold ${t.delta >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-magenta)]"}`}>{t.delta >= 0 ? "+" : ""}{t.delta}</span>
          </li>
        ))}
        {history.data?.length === 0 && <li className="text-sm text-[var(--color-soft-ink)]">暫無記錄</li>}
      </ul>
    </div>
  );
}
```
Keep the `createFileRoute("/kocmax/$slug/wallet")({ component: Wallet })` export.

- [ ] **Step 2: Verify build + tests, then commit**

Run: `npm run build && npm test`
```bash
git add src/routes/kocmax.\$slug.wallet.tsx
git commit -m "feat(web): re-skin Wallet (balance + transaction history)"
```

---

## Task 8: Explore / FAQ static screen

**Files:**
- Create: `src/routes/kocmax.$slug.explore.tsx`

- [ ] **Step 1: Create the route with the prototype's copy**

Mirror the content of `../refreshing-adfocate/src/routes/kocmax.explore.tsx` — copy its benefit cards, the 4 earn-steps, and the 4 FAQ Q&As **verbatim** (Traditional Chinese). Implement with an accordion using local state:
```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/kocmax/$slug/explore")({ component: Explore });

const BENEFITS = [
  { t: "購物賺積分", d: "於合作商戶消費，每消費HK$1即可賺取1積分" },
  { t: "完成任務", d: "參與品牌任務，完成後獲得額外積分獎勵" },
  { t: "每日簽到", d: "每日登入簽到，連續簽到可獲額外獎勵" },
  { t: "兌換獎賞", d: "累積積分兌換精選禮品、優惠券及體驗" },
];
const STEPS = [
  { n: "01", t: "購物消費", d: "於合作商戶購物後保留收據" },
  { n: "02", t: "上傳收據", d: "在App內上傳收據相片以賺取積分" },
  { n: "03", t: "完成任務", d: "瀏覽並接受品牌任務，完成後獲得積分" },
  { n: "04", t: "每日簽到", d: "每日登入簽到賺取額外積分" },
];
const FAQ = [
  { q: "如何賺取積分?", a: "透過購物消費、完成任務、每日簽到及上傳收據即可賺取積分。" },
  { q: "積分會過期嗎?", a: "會。積分有效期為12個月，到期日請查看積分卡。" },
  { q: "如何兌換獎賞?", a: "前往「積分兌換」頁面，選擇心儀獎賞並以積分兌換。" },
  { q: "如何查看我的兌換記錄?", a: "前往「我的」>「我的獎賞」即可查看兌換記錄。" },
];

function Explore() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <h1 className="font-display text-2xl font-bold">探索 KOCmax</h1>
      <section>
        <h2 className="mb-2 font-heading font-bold">會員權益</h2>
        <div className="grid gap-3">
          {BENEFITS.map((b) => (
            <div key={b.t} className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <p className="font-heading font-semibold">{b.t}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">{b.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-heading font-bold">如何賺取積分</h2>
        <div className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="font-display text-lg font-bold text-[var(--color-magenta)]">{s.n}</span>
              <div><p className="font-heading font-semibold">{s.t}</p><p className="text-sm text-[var(--color-soft-ink)]">{s.d}</p></div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-heading font-bold">常見問題</h2>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={f.q} className="pastel-card overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between p-4 text-left font-heading font-semibold">
                {f.q} <ChevronDown size={18} className={open === i ? "rotate-180 transition" : "transition"} aria-hidden />
              </button>
              {open === i && <p className="px-4 pb-4 text-sm text-[var(--color-soft-ink)]">{f.a}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```
> Replace the `BENEFITS`/`STEPS`/`FAQ` strings above with the exact strings from the prototype file if any differ. The above are the prototype's strings as captured in the design deep-dive.

- [ ] **Step 2: Verify build (route tree regenerates), then commit**

Run: `npm run build`
Expected: `tsr generate` picks up the new route; build OK.
```bash
git add src/routes/kocmax.\$slug.explore.tsx
git commit -m "feat(web): Explore/FAQ static screen"
```

---

## Task 9: Terms & Privacy static screens

**Files:**
- Create: `src/routes/kocmax.$slug.tnc.tsx`, `src/routes/kocmax.$slug.privacy.tsx`

- [ ] **Step 1: Create the T&C screen**

Copy the 5-section legal prose **verbatim** from `../refreshing-adfocate/src/routes/kocmax.tnc.tsx` into a card:
```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/kocmax/$slug/tnc")({ component: Tnc });

function Tnc() {
  const { slug } = Route.useParams();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <Link to="/kocmax/$slug" params={{ slug }} className="inline-flex items-center gap-1 text-sm"><ArrowLeft size={16} /> 返回</Link>
      <h1 className="font-display text-2xl font-bold">條款及細則</h1>
      <article className="pastel-card space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-sm leading-[1.65] text-[var(--color-soft-ink)]">
        {/* Paste the intro + 5 sections (1.會員資格 / 2.積分賺取 / 3.積分有效期 / 4.獎賞兌換 / 5.一般條款) verbatim from the prototype, each as: */}
        {/* <h3 className="font-heading font-bold text-[var(--color-ink)]">…</h3><p>…</p> */}
      </article>
    </div>
  );
}
```
Fill the `article` with the verbatim sections from the prototype (intro + the 5 numbered sections), each as `<h3 className="font-heading font-bold text-[var(--color-ink)]">…</h3>` + `<p>…</p>`.

- [ ] **Step 2: Create the Privacy screen**

Same pattern in `src/routes/kocmax.$slug.privacy.tsx` (`createFileRoute("/kocmax/$slug/privacy")`, component `Privacy`), title `私隱政策`, with the 4 verbatim sections (1.資料收集 / 2.資料使用 / 3.資料保護 / 4.查閱及更正) copied from `../refreshing-adfocate/src/routes/kocmax.privacy.tsx`.

- [ ] **Step 3: Verify build, then commit**

Run: `npm run build`
```bash
git add src/routes/kocmax.\$slug.tnc.tsx src/routes/kocmax.\$slug.privacy.tsx
git commit -m "feat(web): Terms & Privacy static screens"
```

---

## Task 10: Login — Email OTP flow

**Files:**
- Modify: `src/routes/kocmax.$slug.login.tsx`

- [ ] **Step 1: Replace the LINE OAuth login with an OTP flow**

```tsx
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export const Route = createFileRoute("/kocmax/$slug/login")({ component: Login });

function Login() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) { setBusy(false); setError(error.message); return; }
    // First-login bootstrap (creates creator + balance if absent). Requires SUPABASE_SERVICE_KEY on the server.
    try { await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug }) }); } catch { /* already bootstrapped */ }
    setBusy(false);
    navigate({ to: "/kocmax/$slug", params: { slug } });
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-bold">登入 KOCmax</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">輸入電郵以接收一次性驗證碼登入或註冊</p>
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
      {stage === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3" aria-label="電郵地址" />
          <button type="submit" disabled={busy} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50">
            {busy ? "傳送中…" : "傳送驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位數驗證碼"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 tracking-[0.4em]" aria-label="驗證碼" />
          <button type="submit" disabled={busy} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50">
            {busy ? "驗證中…" : "登入"}
          </button>
          <button type="button" onClick={() => setStage("email")} className="w-full text-center text-sm text-[var(--color-soft-ink)]">使用其他電郵</button>
        </form>
      )}
    </div>
  );
}
```
> Operator note: Supabase Email OTP works with the default email provider; the email template must include `{{ .Token }}` (Supabase default does). Phone OTP is out of scope unless an SMS provider is configured. The `kocmax.$slug.auth.callback.tsx` route stays as a magic-link fallback and needs no change.

- [ ] **Step 2: Verify build + tests**

Run: `npm run build && npm test`
Expected: build OK; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/kocmax.\$slug.login.tsx
git commit -m "feat(web): Email OTP login (replaces LINE OAuth)"
```

---

## Task 11: Final verification + deploy

**Files:**
- None (verification only)

- [ ] **Step 1: Full local gate**

Run: `npm run type-check && npm run lint && npm test && npm run build`
Expected: all green. Fix any failures before proceeding.

- [ ] **Step 2: Manual visual check (dev server)**

Run: `npm run dev`, open `http://localhost:3000/kocmax/demo`. Verify: neon Acid Y2K styling (acid hero, hard-offset shadows, fonts loaded), 5-tab bottom nav, Home live balance, Mission list/detail, Redemption grid (sold-out overlay), Wallet history, Explore/FAQ accordion, T&C, Privacy, and the OTP login screen render. Tab through with the keyboard to confirm the acid focus ring; toggle OS "reduce motion" and confirm animations are suppressed.

- [ ] **Step 3: Deploy a preview**

Run (from `adfocate-2/`): `vercel deploy --yes --scope ynwaforevers-projects`
(The 4 non-secret env vars are already in the Vercel project store; `SUPABASE_SERVICE_KEY` is required only for end-to-end OTP first-login bootstrap.)
Expected: build succeeds; deployment READY. Open `<url>/kocmax/demo` and confirm the re-skin renders on cloud data.

- [ ] **Step 4: Commit any final tweaks + push**

```bash
git add -A && git commit -m "chore: finalize KOCmax re-skin (Slice 2)" --allow-empty
git push origin main
```

---

## Acceptance criteria (verify before calling Slice 2 done)

1. `src/styles.css` carries the full Acid Y2K `@theme` + utilities; fonts load; app renders neon (acid/magenta/violet on paper/ink) with hard-offset shadows (Task 1).
2. All 8 screens + login render in Acid Y2K, matching the prototype's layout and zh-HK copy (Tasks 2–10).
3. Home/Mission/Redemption/Wallet show live seeded data via existing hooks; Home balance updates live on a DB change (Task 4 + `useRealtimeBalance`).
4. Email OTP login completes end-to-end (email → code → verify → bootstrap → home) when `SUPABASE_SERVICE_KEY` is set (Task 10).
5. 5-tab bottom nav (主頁/任務/積分兌換/錢包/探索) works; Explore/T&C/Privacy render static copy (Tasks 2, 8, 9).
6. `type-check + lint + test + build` green; the diff contains no `supabase/migrations/**` or `api/**` route changes (Task 11).
7. Deployed preview reflects all of the above on cloud data (Task 11).

## Notes & deferred (from spec §8)

- Profile/Passport, creator scores/badges/levels/XP, My Rewards + redemption records (needs a `redemptions` table), marketing site, and the brand/B2B side are **out of scope** — future slices per the re-baseline roadmap.
- `apiFetch` still sends `X-Workspace-Slug: "demo"` (Slice 1 constant); multi-workspace slug wiring is out of scope for this slice.
- If `lucide-react` is not yet a dependency, `npm i lucide-react` and include `package.json` + lockfile in the Task 2 commit.
