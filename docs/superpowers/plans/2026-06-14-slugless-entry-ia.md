# Slugless Brand-at-Root Entry & IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the launch brand at the apex with no visible slug — a branded landing at `/`, the whole app at clean root paths, real link-preview metadata, a branded 404, and old `/kocmax/demo/*` links redirected in.

**Architecture:** Re-root the route tree from `/kocmax/$slug/*` to `/` under a TanStack pathless layout `_app`. The workspace is resolved by a new `resolveWorkspace()` (returns a configured default; the slug never appears in the URL). The multi-workspace DB/API and the `X-Workspace-Slug` header are untouched — that is the kept "plumbing." Old tenant URLs are redirected at the Vercel edge.

**Tech Stack:** React 19 + TanStack Router (file-based, typed routes) + Vite, Vitest + Testing Library, Vercel.

**Spec:** `docs/superpowers/specs/2026-06-14-adfocate-slugless-entry-ia-design.md` (commit `e84bb4d`).

**Branch:** `feat/slugless-entry-ia` (already created off `main`).

> **Why Task 4 is one atomic task:** TanStack generates *typed* routes — every `<Link to="...">` and `navigate({to})` is type-checked against the route tree. You cannot rename half the routes and stay green; the tree must move together. So Task 4 re-roots everything in one coordinated sequence with a single green checkpoint at the end. Tasks 1–3 and 5 are independently green.

---

## File Structure

**New**
- `src/lib/workspace.ts` — `resolveWorkspace()` + `DEFAULT_WORKSPACE`.
- `src/lib/workspace.test.ts` — unit test.
- `src/routes/index.tsx` — `/` branded landing (public; signed-in → `/home`).
- `src/routes/_app.tsx` — pathless gated layout (re-rooted from `kocmax.$slug.tsx`).
- `public/og.png` — 1200×630 OG image (placeholder acceptable).

**Renamed (re-rooted): `src/routes/kocmax.$slug.*` → `src/routes/_app.*`**

| Old file | New file | New URL |
|---|---|---|
| `kocmax.$slug.tsx` | `_app.tsx` | (pathless layout) |
| `kocmax.$slug.index.tsx` | `_app.home.tsx` | `/home` |
| `kocmax.$slug.login.tsx` | `_app.login.tsx` | `/login` |
| `kocmax.$slug.auth.callback.tsx` | `_app.auth.callback.tsx` | `/auth/callback` |
| `kocmax.$slug.onboarding.tsx` | `_app.onboarding.tsx` | `/onboarding` |
| `kocmax.$slug.mission.tsx` | `_app.mission.tsx` | `/mission` |
| `kocmax.$slug.mission.$missionSlug.tsx` | `_app.mission.$missionSlug.tsx` | `/mission/$missionSlug` |
| `kocmax.$slug.my.tsx` | `_app.my.tsx` | `/my` |
| `kocmax.$slug.wallet.tsx` | `_app.wallet.tsx` | `/wallet` |
| `kocmax.$slug.redemption.tsx` | `_app.redemption.tsx` | `/redemption` |
| `kocmax.$slug.explore.tsx` | `_app.explore.tsx` | `/explore` |
| `kocmax.$slug.privacy.tsx` | `_app.privacy.tsx` | `/privacy` |
| `kocmax.$slug.tnc.tsx` | `_app.tnc.tsx` | `/tnc` |

**Modified**
- `src/components/BottomNav.tsx` — root-path tabs, drop the `slug` prop.
- `src/lib/auth-flow.ts` — `finishAuth(navigate)` resolves the workspace internally; navigates to root paths.
- `src/routes/__root.tsx` — branded 404.
- `index.html` — OG/meta tags.
- `vercel.json` — edge redirects for old `/kocmax/demo/*` URLs.
- Test files `src/routes/-kocmax.$slug.*.test.tsx` → renamed to `-_app.*.test.tsx`, imports + mocks updated.

---

## Task 1: resolveWorkspace()

**Files:**
- Create: `src/lib/workspace.ts`
- Test: `src/lib/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveWorkspace } from "./workspace";

describe("resolveWorkspace", () => {
  it("returns the default workspace slug", () => {
    expect(resolveWorkspace()).toBe("demo");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run src/lib/workspace.test.ts`
Expected: FAIL — module `./workspace` not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/workspace.ts
/** The configured launch-brand workspace. Override per-deploy with VITE_DEFAULT_WORKSPACE. */
const DEFAULT_WORKSPACE = (import.meta.env.VITE_DEFAULT_WORKSPACE as string | undefined) ?? "demo";

/**
 * The active workspace slug. Today this is a single configured default and is NOT
 * shown in the URL (slugless apex). Later it can additionally resolve from a
 * custom-domain map or a path/subdomain for multi-tenant — callers (the
 * X-Workspace-Slug header in src/lib/api.ts) do not change.
 */
export function resolveWorkspace(): string {
  return DEFAULT_WORKSPACE;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/lib/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/workspace.test.ts
git commit -m "feat(entry): resolveWorkspace() — slug resolution abstraction"
```

---

## Task 2: Link-preview metadata + OG image

**Files:**
- Modify: `index.html`
- Create: `public/og.png`

- [ ] **Step 1: Add an OG image**

Place a 1200×630 PNG at `public/og.png`. A placeholder is acceptable for now (e.g. a solid acid-yellow card with "KOCmax" wordmark). Vite serves `public/og.png` at `/og.png`.

```bash
# placeholder until the branded asset is supplied (any 1200x630 png is fine)
# e.g. copy an existing brand image, or generate one; commit it at public/og.png
```

- [ ] **Step 2: Add meta tags to `index.html`**

Replace the `<title>KOCmax</title>` line in `index.html` with this block (keep everything else):

```html
    <title>KOCmax · 完成任務賺積分換獎賞</title>
    <meta name="description" content="加入 KOCmax 會員平台：完成品牌任務、賺取積分、換領心儀獎賞。用 WhatsApp 一鍵加入。" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="KOCmax · 完成任務賺積分換獎賞" />
    <meta property="og:description" content="完成品牌任務、賺取積分、換領獎賞。用 WhatsApp 一鍵加入。" />
    <meta property="og:image" content="/og.png" />
    <meta property="og:url" content="https://adfocate-2.vercel.app/" />
    <meta name="twitter:card" content="summary_large_image" />
```

> Single brand → static tags cover every share (no SSR). `og:url` is the apex; update it if a custom domain is added.

- [ ] **Step 3: Verify the build includes the asset + tags**

Run: `npm run build`
Expected: PASS; `dist/og.png` exists and `dist/index.html` contains the `og:title` meta.

- [ ] **Step 4: Commit**

```bash
git add index.html public/og.png
git commit -m "feat(entry): OG/meta tags + share image (fixes blank WhatsApp previews)"
```

---

## Task 3: Branded 404

**Files:**
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Read the current file**

Run: `sed -n '1,60p' src/routes/__root.tsx` — note the `notFoundComponent` (currently renders "404 — 找不到頁面").

- [ ] **Step 2: Replace the not-found component with a branded one**

In `src/routes/__root.tsx`, replace the existing not-found component with:

```tsx
function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-paper)] p-8 text-center text-[var(--color-ink)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em]">KOCMAX</p>
      <h1 className="font-display text-3xl font-bold">404 — 找不到頁面</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">這個連結可能已失效或輸入錯誤。</p>
      <a href="/" className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-3 font-heading font-bold">回首頁</a>
    </div>
  );
}
```

Wire it into the root route options as `notFoundComponent: NotFound` (match however the existing root route registers it). Use a plain `<a href="/">` (not `<Link>`) so it works even from an unmatched route.

- [ ] **Step 3: Verify**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat(entry): branded 404 with a home link"
```

---

## Task 4: Re-root the app to slugless paths (atomic)

**Files:** create `src/routes/_app.tsx`, `src/routes/index.tsx`; rename the 13 `kocmax.$slug.*` route files → `_app.*` (table above); modify `src/components/BottomNav.tsx`, `src/lib/auth-flow.ts`; rename + update the `-kocmax.$slug.*.test.tsx` files.

Do the steps **in order**; type-check stays red until Step 6 (typed routes move together — see the note at the top).

- [ ] **Step 1: Create the pathless gated layout `src/routes/_app.tsx`**

This re-roots `kocmax.$slug.tsx`: resolve the workspace internally, gate on root paths.

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, setWorkspaceSlug } from "@/lib/api";
import { resolveWorkspace } from "@/lib/workspace";
import { useWorkspace, type Me } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location, context }) => {
    setWorkspaceSlug(resolveWorkspace());
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname === "/login" || location.pathname.startsWith("/auth/");
    const isOnboardingRoute = location.pathname.startsWith("/onboarding");

    if (!data.session && !isAuthRoute) {
      throw redirect({ to: "/login" });
    }
    if (data.session && !isAuthRoute && !isOnboardingRoute) {
      const me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: () => apiFetch<Me>("/me"),
      });
      if (me && me.onboarding_completed === false) {
        throw redirect({ to: "/onboarding" });
      }
    }
  },
  component: Layout,
});

function Layout() {
  const ws = useWorkspace();
  useEffect(() => { if (ws.data?.theme) applyTheme(ws.data.theme); }, [ws.data]);
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] pb-20">
      <main><Outlet /></main>
      <BottomNav />
    </div>
  );
}
```

Then delete the old `src/routes/kocmax.$slug.tsx`.

- [ ] **Step 2: Update `src/lib/auth-flow.ts`** — drop the slug param, navigate to root paths

```ts
import type { useNavigate } from "@tanstack/react-router";
import { supabase } from "./supabase";
import { apiFetch, setWorkspaceSlug } from "./api";
import { resolveWorkspace } from "./workspace";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Shared post-auth branch, invoked from BOTH the inline WhatsApp verify handler
 * and the redirect callback. Bootstraps the creator, refreshes the session, then
 * routes to the wizard (onboarding incomplete) or home. Throws on any failure.
 */
export async function finishAuth(navigate: Navigate) {
  const slug = resolveWorkspace();
  setWorkspaceSlug(slug);
  const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
  await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug, ref }) });

  const { error } = await supabase.auth.refreshSession();
  if (error) throw error;

  const status = await apiFetch<{ onboarding_completed: boolean }>("/onboarding/status");
  navigate({ to: status.onboarding_completed ? "/home" : "/onboarding" });
}
```

- [ ] **Step 3: Update `src/components/BottomNav.tsx`** — root paths, no slug prop

```tsx
import { Link } from "@tanstack/react-router";
import { Home, Target, Gift, Wallet, Compass } from "lucide-react";

const TABS = [
  { to: "/home", label: "主頁", icon: Home, exact: true as const },
  { to: "/mission", label: "任務", icon: Target, exact: false as const },
  { to: "/redemption", label: "積分兌換", icon: Gift, exact: false as const },
  { to: "/wallet", label: "錢包", icon: Wallet, exact: false as const },
  { to: "/explore", label: "探索", icon: Compass, exact: false as const },
] as const;

export function BottomNav() {
  return (
    <nav aria-label="主要導航" className="glass-panel fixed bottom-0 inset-x-0 z-40 flex border-t-2 border-[var(--color-ink)] pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
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
```

- [ ] **Step 4: Re-root the 12 child route files** — rename each per the table, then apply these **transformation rules** to its contents:

1. `createFileRoute("/kocmax/$slug/X")` → `createFileRoute("/_app/X")`. The index becomes `createFileRoute("/_app/home")` in `_app.home.tsx`. Keep `$missionSlug`: `createFileRoute("/_app/mission/$missionSlug")`.
2. Delete `const { slug } = Route.useParams();` when `slug` was only used to build Links. Keep other params: `const { missionSlug } = Route.useParams();` stays.
3. Rewrite every link: `<Link to="/kocmax/$slug/Y" params={{ slug }}>` → `<Link to="/Y">`; `<Link to="/kocmax/$slug/mission/$missionSlug" params={{ slug, missionSlug: m.slug }}>` → `<Link to="/mission/$missionSlug" params={{ missionSlug: m.slug }}>`. Drop `params={{ slug }}` everywhere; drop any `as string` cast on `to`.
4. Where a screen needs the workspace for logic (login/auth-callback), replace `Route.useParams().slug` with `resolveWorkspace()` from `@/lib/workspace`.
5. The home `<Link to="/kocmax/$slug">` (back-to-home) → `<Link to="/home">`.

**Worked example A — `_app.home.tsx`** (from `kocmax.$slug.index.tsx`):

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Target, Gift, Receipt, CalendarCheck } from "lucide-react";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { MissionCard } from "@/components/MissionCard";

export const Route = createFileRoute("/_app/home")({ component: Home });

function Home() {
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

      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />

      <section className="grid grid-cols-2 gap-3">
        {[
          { to: "/mission", label: "限時任務", icon: Target },
          { to: "/redemption", label: "積分兌換", icon: Gift },
          { to: "/wallet", label: "積分記錄", icon: Receipt },
          { to: "/explore", label: "探索獎賞", icon: CalendarCheck },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} to={a.to} aria-label={a.label} className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-heading font-semibold">
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
            <Link key={m.id} to="/mission/$missionSlug" params={{ missionSlug: m.slug }}>
              <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
```

**Worked example B — `_app.login.tsx`** (from `kocmax.$slug.login.tsx`): change the route id, drop the slug param, call `finishAuth(navigate)`, and point the secondary redirect URLs at `/auth/callback`:

```tsx
// header
export const Route = createFileRoute("/_app/login")({ component: Login });
// inside Login():  remove `const { slug } = Route.useParams();`
//   verify(): replace `await finishAuth(slug, navigate);` → `await finishAuth(navigate);`
//   the "其他登入方式" toggle: render `<SecondaryMethods />` (no slug prop)
// SecondaryMethods(): drop the `slug` prop; change BOTH redirect URLs to:
//   emailRedirectTo: `${window.location.origin}/auth/callback`
//   redirectTo:      `${window.location.origin}/auth/callback`
```

Apply the rules to the remaining files: `_app.mission.tsx`, `_app.mission.$missionSlug.tsx` (keep `missionSlug`; its back-link `to="/kocmax/$slug/mission"` → `to="/mission"`), `_app.my.tsx` (mission links), `_app.wallet.tsx`, `_app.redemption.tsx`, `_app.explore.tsx`, `_app.privacy.tsx`, `_app.tnc.tsx`, `_app.onboarding.tsx` (its post-complete `navigate`/links → `/home`; if it calls `finishAuth`, use the new signature), `_app.auth.callback.tsx` (`resolveWorkspace()` + `finishAuth(navigate)`). Delete each old `kocmax.$slug.*` file as you create its `_app.*` replacement.

- [ ] **Step 5a: Create the landing `src/routes/index.tsx`** (public; signed-in → `/home`)

```tsx
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-paper)] p-8 text-center text-[var(--color-ink)]">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em]">ADFOCATE · KOCMAX</span>
      <h1 className="font-display text-4xl font-bold leading-[1.05]">完成任務<br/>賺積分換獎賞</h1>
      <p className="max-w-xs text-sm text-[var(--color-soft-ink)]">加入 KOCmax 會員平台，完成品牌任務、賺取積分、換領心儀獎賞。</p>
      <Link to="/login" className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-8 py-3 font-heading font-bold">用 WhatsApp 加入</Link>
      <Link to="/mission" className="text-sm underline text-[var(--color-soft-ink)]">先睇睇任務</Link>
    </div>
  );
}
```

> Note: `/mission` is behind the `_app` auth gate, so an anonymous "先睇睇任務" click redirects to `/login` — acceptable. A public mission preview, if wanted later, is a separate change.

- [ ] **Step 5b: Update the affected component tests** — rename `src/routes/-kocmax.$slug.*.test.tsx` → `-_app.*.test.tsx`, fix the import path (`./_app.mission.$missionSlug`, etc.), and **replace any `vi.spyOn(Route, "useParams")` slug mock** with a `resolveWorkspace` mock where the component now uses it:

```tsx
// for screens that previously read useParams().slug (e.g. login):
vi.mock("@/lib/workspace", () => ({ resolveWorkspace: () => "demo" }));
// keep Route.useParams mocks ONLY for real params (e.g. { missionSlug: "m1" }).
```

The mission-detail and my-missions tests keep their existing mocks (they used `missionSlug` / none, never `slug`) — just update the import path to the new `_app.*` filename.

- [ ] **Step 6: Regenerate the route tree + green checkpoint**

Run: `npm run type-check`
Expected: PASS. (`tsr generate` rewrites `routeTree.gen.ts`. If any `<Link to="...">` still points at a removed `/kocmax/$slug/...` path, type-check fails here — fix each until green. This is the safety net that proves no link was missed.)

Run: `npx vitest run`
Expected: PASS — unit + component suites green (integration skips without env).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(entry): re-root app to slugless paths under _app layout + landing at /"
```

---

## Task 5: Redirect old `/kocmax/demo/*` URLs at the edge

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add `redirects` (processed before `rewrites`)**

Replace `vercel.json` with:

```json
{
  "redirects": [
    { "source": "/kocmax/demo", "destination": "/home" },
    { "source": "/kocmax/demo/", "destination": "/home" },
    { "source": "/kocmax/demo/:path*", "destination": "/:path*" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

> Only `demo` ever existed, so this covers every live WhatsApp/QR link: `/kocmax/demo` → `/home`, `/kocmax/demo/mission/x` → `/mission/x`, etc. Default 307 (temporary) is safe during cutover; switch to `"permanent": true` (308) once stable.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(entry): edge-redirect legacy /kocmax/demo URLs to root paths"
```

---

## Task 6: Full gate + smoke

**Files:** none (verification + any fixups)

- [ ] **Step 1: Gate**

Run: `npm run type-check && npx vitest run && npm run lint && npm run build`
Expected: all PASS. (If `.vercel/output` stale artifacts trip eslint, `rm -rf .vercel/output` — do not edit `eslint.config.js`, it is hook-protected.)

- [ ] **Step 2: Local nav smoke (manual)**

Run: `npm run dev`, then verify in the browser:
- `/` shows the landing; "用 WhatsApp 加入" → `/login`.
- Signed-out visit to `/home` or `/mission` → redirects to `/login`.
- After login → `/onboarding` (new user) or `/home`; BottomNav tabs route to `/home`, `/mission`, `/redemption`, `/wallet`, `/explore`.
- A bogus path (e.g. `/nope`) shows the branded 404 with a working 回首頁 link.
- View source on `/` → the `og:title`/`og:image` meta is present.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "chore(entry): gate green" || echo "nothing to commit"
```

---

## Done criteria
- Apex `/` shows a branded landing (not a 404); signed-in creators are taken to `/home`.
- The whole app runs at clean root paths; no `/kocmax/$slug` visible; old `/kocmax/demo/*` links redirect in at the edge.
- `index.html` carries OG/meta so WhatsApp/QR shares unfurl with title + description + image.
- `type-check`, `vitest`, `lint`, `build` all green.
- **Release-gated (user):** before/with deploy, update Supabase Auth **Site URL** = the apex origin and **redirect allow-list** = `<origin>/auth/callback`, and the Google OAuth client redirect to match — else login breaks. Supply a branded `public/og.png` to replace the placeholder.
