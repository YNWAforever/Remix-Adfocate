# One Adfocate — Phase 1 Unification — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/one-adfocate-unification` (off `main` @ c59b516)
**Migration:** yes — `0017_leads.sql` (contact lead capture)
**Scope of this spec:** all of Phase 1 (sub-slices 1A + 1B + 1C) as one document.

---

## Problem

The product exists as **two separate frontends** that look like siblings but are not one product:

| | `refreshing-adfocate` (marketing) | `adfocate-2` (live product) |
|---|---|---|
| What | Polished public marketing pages + a **mock** `kocmax.*` portal | The **real** creator earn-loop: home, mission, match, passport, wallet, redemption, profile, admin/operator |
| Data | Typed mock data (`src/data/*`), no backend | Supabase + Hono `/api`, real auth, CI, tests |
| Stack | TanStack **Start** (SSR) · Cloudflare · Bun · custom i18n (en/zh) | TanStack **Router** (client SPA) · Vercel · npm · hardcoded zh-HK |
| Brand | "ADFOCATE 2.0 × KOCmax" + pillars (KOCmax/Adfoplace/Grow/Capital) | nav says "Adfocate", 404 says "KOCMAX" |
| Design | **Acid Y2K** tokens | **Acid Y2K** tokens (identical but for one magenta shade) |

A visitor cannot move from the marketing story into the working product as one experience, the brand name is inconsistent across surfaces, and the marketing pages run on a stack that re-implements auth/data the live app already has.

## Goal

Make **one product** on the **`adfocate-2`** codebase: the marketing pages move in as the public front-of-house, the live creator app stays behind login, both share one brand, one design system, and one i18n layer. This is **Phase 1** of a larger two-sided vision (below); Phase 1 delivers the unified brand + site + bilingual product and a working lead funnel.

## Vision & roadmap (context — only Phase 1 is specced here)

One brand (**Adfocate** = master; **KOCmax** = the creator product; Adfoplace/Grow/Capital = pillars), one design (Acid Y2K), one codebase, **four surfaces**:

1. **Public marketing** *(Phase 1 — new)*
2. **Creator app** *(live today)*
3. **Brand app** *(Phase 2/3 — productized from today's operator console; ~80% of the data model & mission lifecycle already exists, workspace-scoped)*
4. **Operator / admin** *(live today)*

- **Phase 1 — Unify** *(this spec)*: brand + marketing front + bilingual i18n + SSG/SEO + working contact.
- **Phase 2 — Brand app MVP**: brand auth/roles, per-workspace UI isolation, self-serve mission creation, applicant/submission review for brands.
- **Phase 3 — Packages/billing + brand dashboard/analytics + Adfoplace**.

## Decisions locked (this brainstorm)

1. **Foundation** = the live `adfocate-2` codebase; port marketing pages *into* it.
2. **Both sides real** is the end goal → two-sided product, phased.
3. **Phasing** = unify first, then deepen the brand side.
4. **Navigation** = marketing top-bar for logged-out visitors that **swaps to the existing SideNav/BottomNav app shell after login**.
5. **Brand** = **Adfocate** master wordmark; **KOCmax** = the creator-product label; future brand product = "Adfocate for Brands" / Adfoplace. Drop "2.0" from product UI.
6. **Language** = **full bilingual (en / zh-HK) across both marketing AND the existing creator app**.
7. **SEO** = **static-prerender (SSG) the public marketing routes** at build; per-page meta/OG.

## Non-goals (Phase 1)

- **No brand auth / brand dashboard / self-serve mission creation / billing** — that's Phase 2/3. Brand-side CTAs funnel to the contact form for now.
- **No new creator-app features.** The `_app/*` earn-loop is touched only to (a) consume i18n keys and (b) host the language toggle.
- **The extra marketing pillar pages are out of scope** (`/grow`, `/capital`, `/copilot`, `/workspace`, `/adfoplace`, `/missions`, `/wallet-capital`) — Phase 1 ports **exactly the 8 listed pages**. The roadmap can add the rest later.
- **No SSR server.** SEO is met with build-time prerendering + client `head()`, not a Node/edge SSR runtime.
- **The mock `kocmax.*` preview portal from the marketing repo is discarded** — the real app is the portal.

---

## Architecture

### Route structure

Marketing pages mount as a **pathless public layout group `_site`** at the repo root, *outside* the auth-gated `_app` group. The auth gate lives in `_app.tsx#beforeLoad`; root-level routes never hit it.

```
src/routes/
  __root.tsx          → I18nProvider + HeadContent + <Outlet/> + 404   (wraps EVERYTHING)
  _site.tsx           → MarketingLayout: MarketingHeader + <Outlet/> + Footer   (PUBLIC, no gate)
    _site.index.tsx       → /            (marketing home; keeps "authed → redirect /home")
    _site.creators.tsx    → /creators
    _site.brands.tsx      → /brands
    _site.packages.tsx    → /packages
    _site.earn.tsx        → /earn
    _site.stories.tsx     → /stories
    _site.playbooks.tsx   → /playbooks
    _site.contact.tsx     → /contact
    _site.legal.terms.tsx → /legal/terms       (folded in from marketing repo)
    _site.legal.privacy.tsx → /legal/privacy
  _app.tsx            → (unchanged) auth + onboarding gate → SideNav/BottomNav app shell
    _app.home.tsx … _app.profile.tsx  (live creator app — unchanged routing)
  admin.tsx / operator.tsx  (unchanged)
```

- The current `index.tsx` (today's minimal landing that redirects authed users to `/home`) is **replaced** by `_site.index.tsx`, which renders the full marketing home **and** preserves the "if session → redirect `/home`" behaviour in `beforeLoad`.
- `routeTree.gen.ts` is regenerated by `tsr generate` (never hand-edited).

### Navigation model (Decision 4·A)

- **`MarketingHeader`** (new, ported from the marketing `Header.tsx`): Adfocate wordmark + public nav (Creators · Brands · Packages · Stories · Playbooks · Contact) + **Language toggle** + **Log in / Join** buttons → `/login`. Mobile = hamburger/sheet.
- After login, the user is inside `_app` → the **existing SideNav (desktop) / BottomNav (mobile)** renders; `MarketingHeader` does not. No change to the app shell beyond hosting the language toggle.
- **`Footer`** (ported): shown on `_site` pages only.

### i18n architecture (Slice 1A)

- Port `src/lib/i18n.tsx` (custom React Context + `localStorage`, `useI18n()/t()`) from the marketing repo.
- Mount a single `<I18nProvider>` in `__root.tsx`, wrapping the whole tree (marketing **and** app).
- **Dictionary** = merge of (a) the marketing repo's existing en/zh keys (nav, hero, sections, footer, CTAs — ~190 keys) and (b) **newly-extracted** keys for the existing creator app. Namespacing: `site.*` (marketing), `app.*` (creator app), `common.*`.
- **App-string extraction:** replace hardcoded zh-HK throughout `_app/*`, `navItems.ts`, shared components, and the 404 with `t('app.…')` keys; author en counterparts. This is broad but mechanical.
- **Locale source of truth:** `localStorage` (as marketing does today), defaulting to `zh-HK` for the app's existing audience; first-visit may read `navigator.language`. (URL-locale prefix is **out of scope** — revisit if SEO needs per-locale URLs.)
- **Language toggle** component (`LangToggle`) placed in `MarketingHeader` and the app shell (SideNav footer on desktop; a slot in the mobile chrome — exact mobile placement is an open question, see below).
- **Completeness guard:** a unit test asserts every key present in `zh-HK` exists in `en` and vice-versa (no missing translations ship).

### SSG / SEO (Slice 1C)

The app is a **pure client SPA** (no TanStack Start). To get crawlable marketing pages without adopting an SSR runtime:

- **Per-page meta** via TanStack Router's `head()` route option on each `_site.*` route + `<HeadContent/>` in `__root.tsx` (correct `<title>` / `og:*` / `description` client-side).
- **Build-time prerender** of the 8 public routes to static HTML, wired into the Vercel build after `vite build`. **Tool choice is an open question for the plan** — evaluate `vite-react-ssg` vs a lightweight Playwright/puppeteer crawl of the local `vite preview` that snapshots each `_site` route to `dist/<route>/index.html`. `_app/*` and `admin/operator` are **not** prerendered (auth-gated, no SEO value).
- **`sitemap.xml` + `robots.txt`** generated for the 8 public routes.
- **Vercel rewrites** updated so prerendered HTML is served for the 8 routes while everything else keeps the SPA fallback, and `/api/*` is untouched.

### Brand system (Slice 1B)

- Wordmark **"Adfocate"** everywhere (drop "2.0" from UI). `MarketingHeader` shows the wordmark; the long "KOCmax · Adfoplace · Grow · Capital" subline is **removed** as permanent chrome (pillar names appear contextually on their own pages).
- **KOCmax** is the creator-product label used inside the app context (e.g., membership / hero copy), endorsed by Adfocate.
- Fix inconsistencies: 404 `"KOCMAX · 404 — 找不到頁面"` → `"Adfocate · 找不到頁面"` (via i18n); SideNav logo already "Adfocate" (keep); unify `<title>`/OG meta to the Adfocate master brand.
- Reconcile the single token delta: `--color-magenta` → `#CE1A5C` (the AA-passing shade already in `adfocate-2`).

### Contact lead capture (Slice 1C)

- New **`/api/contact`** Hono route (public, no auth) that validates and inserts a lead via the **service-role** client. Basic anti-abuse: required-field validation + simple rate limiting; CAPTCHA deferred.
- Five enquiry types from the marketing form: `brand_enquiry`, `creator_signup`, `adfoplace_offer`, `capital_waitlist`, `partner_enquiry`.
- The contact form (`_site.contact.tsx`) posts to it and shows a localized success/error toast (`sonner`, already a marketing dep).
- New server files **must use `.js` on relative imports** (ESM rule from the prior outage; enforced by the existing `check:esm` guard).

---

## Data model — `0017_leads.sql`

```sql
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in
                 ('brand_enquiry','creator_signup','adfoplace_offer','capital_waitlist','partner_enquiry')),
  name         text not null,
  email        text not null,
  message      text,
  payload      jsonb not null default '{}'::jsonb,   -- type-specific fields (budget, market, level, …)
  locale       text not null default 'zh-HK',
  workspace_id uuid references public.workspaces(id),  -- nullable; brand site has no workspace yet
  status       text not null default 'new' check (status in ('new','contacted','archived')),
  created_at   timestamptz not null default now()
);
alter table public.leads enable row level security;
-- No anon/authenticated policies: inserts go through the service-role /api/contact endpoint only.
grant select, insert on public.leads to service_role;
```

(Operator UI to triage leads is **deferred**; rows are reachable via Supabase / a future admin tab.)

---

## Porting map (`refreshing-adfocate` → `adfocate-2`)

| Source | Destination | Notes |
|---|---|---|
| `src/routes/{index,creators,brands,packages,earn,stories,playbooks,contact}.tsx` | `src/routes/_site.*.tsx` | Convert any TanStack **Start** `head()` SSR specifics to Router `head()`; ensure no `useServerFn`/server-only calls. |
| `src/routes/legal.{terms,privacy}.tsx` | `src/routes/_site.legal.*.tsx` | Public legal pages. |
| `src/components/{Header,Footer,MobileBottomNav,ProgressBar}.tsx` | `src/components/marketing/*` | Header → `MarketingHeader`; add `LangToggle` + Log in/Join. |
| `src/data/{legacyAdfocateContent,mockData}.ts` | `src/data/*` | Marketing content stays **static/curated** (no backend wiring in Phase 1). |
| `src/lib/i18n.tsx` + dictionaries | `src/lib/i18n.tsx` | Becomes the app-wide provider; dictionary extended with `app.*` keys. |
| shadcn `ui/*` used by marketing pages | reconcile with existing `src/components/ui/*` | Use the target's primitives; only add missing ones. Watch version/prop drift. |

---

## Sub-slices (one plan, three reviewable chunks → ideally three PRs)

- **1A — i18n foundation** *(prerequisite)*: port provider, merge dictionaries, extract existing app strings, `LangToggle` + persistence, completeness test. Ships "the app speaks English too." No new pages.
- **1B — marketing + brand + nav**: port the 8 pages + deps into `_site`, `MarketingLayout` + `MarketingHeader`/`Footer`, brand unification (wordmark/404/meta), nav swap, CTA wiring (creator → `/login`; brand → `/contact`). The visible "one product" win.
- **1C — SSG + SEO + contact backend**: prerender pipeline + `head()` meta + sitemap/robots + Vercel rewrites; `0017_leads.sql` + `/api/contact` + wired contact form.

Dependency order: **1A → 1B → 1C**.

---

## Error handling

- Marketing routes get a route-level **error boundary** rendering a branded fallback (the marketing repo's SSR error normalization does not port — the SPA needs an explicit boundary).
- `/api/contact` returns typed JSON errors; the form surfaces a localized toast and never silently swallows failures.
- The i18n provider falls back to the key's other-locale string (then the raw key) if a translation is missing — but the completeness test should prevent that in practice.
- Auth gate behaviour is unchanged; public `_site` routes must be verified to never trigger the `_app` redirect.

## Testing strategy

- **i18n:** provider unit tests; **key-completeness test** (en ↔ zh-HK parity); a couple of component snapshots in both locales; `LangToggle` toggles + persists.
- **Marketing pages:** per-page smoke render (no crash, key sections present); **nav-swap test** (logged-out → `MarketingHeader`; logged-in → app shell); **CTA target test** (creator CTAs → `/login`, brand CTAs → `/contact`).
- **Contact:** server tests for `/api/contact` (valid insert per type; validation rejects bad input; rate-limit path); form-submit test (success + error toast).
- **SSG:** build assertion that each of the 8 routes emits static HTML with the correct `<title>`/`og:*`.
- **Regression:** the full existing vitest **unit + integration** suites stay green; `npm run type-check` (runs `tsr generate`) + `lint` + `build` + `check:esm` all pass.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **App-string i18n extraction is broad** (many `_app/*` files) | Mechanical, namespaced, guarded by completeness test + full build; do it as its own slice (1A) before anything depends on it. |
| **SSG tooling unknown** on a pure SPA | Plan must spike `vite-react-ssg` vs a Playwright prerender early in 1C; meta via `head()` works regardless, so SEO degrades gracefully if SSG slips. |
| **Vercel rewrites** could break `/api/*` or the SPA fallback | Add prerendered routes explicitly; keep the `/((?!api/).*) → /index.html` fallback; test all 8 routes + an `/api` call post-deploy. |
| **New server files missing `.js` imports** (prior prod outage) | `check:esm` guard in CI; called out in 1C. |
| **shadcn primitive drift** between repos | Use the target's `ui/*`; only add missing primitives; visual diff the ported pages. |
| **Magenta contrast** post-merge | Standardize on `#CE1A5C`; re-run a contrast check on `text-magenta`/`text-rose`. |
| **Bundle size** grows with marketing pages/deps | Marketing routes are code-split by route; prerender keeps first paint static. |
| **`routeTree.gen.ts` drift** | Always `tsr generate`; never hand-edit (known TanStack codegen gotcha). |

## Open questions (for the plan, with defaults)

1. **SSG tool** — `vite-react-ssg` vs Playwright prerender. *Default:* spike both in 1C, pick the lower-friction one; `head()` meta ships regardless.
2. **Mobile language-toggle placement** in the app shell (BottomNav has no room). *Default:* put it in the Profile screen + a small top-row slot on `/home`.
3. **Legal pages** — consolidate the app's existing `_app.tnc/_app.privacy` with the marketing `legal.*`? *Default:* move both to public `_site/legal/*`, redirect the old paths.
4. **Permanent pillar tagline** under the wordmark? *Default:* no — keep the header clean; pillars live on their pages.
