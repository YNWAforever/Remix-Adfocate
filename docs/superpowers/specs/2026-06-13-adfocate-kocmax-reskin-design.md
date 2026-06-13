# Adfocate 2.0 — KOCmax Member Shell Re-skin — Design Spec

- **Date:** 2026-06-13
- **Status:** Approved in brainstorming → ready for `writing-plans`
- **Builds on:** Slice 1 (read-only KOCmax vertical). Slice 1 spec/plan live at the workspace root `docs/superpowers/` (`2026-06-13-adfocate-slice1-kocmax-readonly-design.md` / `...-readonly.md`).
- **Repo:** `adfocate-2/` (git, pushed to https://github.com/YNWAforever/Remix-Adfocate). Live demo: https://adfocate-2.vercel.app (`/kocmax/demo`).
- **Design source of truth:** the sibling prototype `refreshing-adfocate/` (Lovable, TanStack Start + Cloudflare) — `docs/design-system.md`, `src/styles.css`, and the `src/routes/kocmax.*.tsx` screens.

## 1. Summary

Slice 1 stood up the platform substrate and 5 **bare, unstyled** KOCmax screens on a real Supabase backend, deliberately skipping the design-system port (the old Task 10). This slice closes that gap: re-skin the existing live screens and add the rest of the member shell so the deployed app **looks and reads like the `refreshing-adfocate` prototype**, in the documented **neon "Acid Y2K"** design language — **without any database or API change**.

Key framing: the two repos are complementary. `refreshing-adfocate` has the design + content + UX but only mock data; `adfocate-2` has the real multi-tenant backend (Supabase + RLS) but no design. This slice brings the prototype's look and copy onto our real backend.

## 2. Goals / Non-goals

**Goals**
- Port the Acid Y2K design foundation (tokens + utility classes + fonts) into `adfocate-2`.
- Deliver an 8-screen **member shell**, visually faithful to the prototype, wired to the **existing** Hono API + TanStack Query hooks (live read-only data + Realtime balance).
- Swap login to an **Email/Phone OTP** flow that actually works without OAuth app registration.

**Non-goals (future slices — require schema/API expansion)**
- Profile / Creator Passport, creator scores (7), badges, levels/XP mechanics.
- My Rewards / redemption records (a `redemptions` table), redemption write actions.
- The marketing/corporate site and the brand/B2B side (Packages, Playbooks, Academy, Copilot, Capital, Offers).
- Any new tables, columns, RLS policies, or API routes.

## 3. Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Intent | Re-skin + rebuild the KOCmax member screens in `adfocate-2` on the live backend; keep our Vite SPA + Hono + Vercel stack. |
| Scope | **Member shell — 8 screens**, no schema change. |
| Palette | **Neon Acid Y2K** (already the seeded demo-workspace theme). |
| Login | **Email/Phone OTP** (drop LINE OAuth). |
| Bottom nav | 5 tabs: **Home / Mission / Redemption / Wallet / Explore**. Keep our real `Wallet`; add `Explore`; **defer Profile** (out of scope). |
| Execution | **Hybrid**: port the design foundation verbatim; rebuild screens as thin components against existing data hooks. |

## 4. Approach — Hybrid port

The design **foundation** (the `@theme` token block + utility classes in `refreshing-adfocate/src/styles.css`) is pure, portable CSS — copy it verbatim. The **screens/components** in the prototype carry mock data and TanStack-Start idioms, so rebuild them as thin presentational components wired to our existing hooks, copying the prototype's markup/layout/zh-HK copy. Port only the handful of presentational components we actually use, as prop-only.

Rejected: (1) faithful component port — drags in 46 shadcn files + mock-data wiring against the wrong data layer; (2) fresh rebuild from the doc — slow, risks visual drift.

## 5. Design

### 5.1 Design foundation (the skipped Task 10, done properly)

- **`src/styles.css`** — replace the placeholder `@theme` with the full Acid Y2K token set + utility classes from `refreshing-adfocate/src/styles.css`. Keep `@import "tailwindcss";` as the first line.
  - **Color tokens (neon):** `--color-acid #D4FF00`, `--color-magenta #D81B60`, `--color-magenta-pop #FF3D7F` (decorative only — never text), `--color-violet #7C5CFF`, `--color-cyan #00E5FF`, `--color-ink #0A0A0A`, `--color-paper #EFEFEF`, `--color-card #FFFFFF`, `--color-soft-ink #4A4A4A`, plus the semantic mappings (`--color-primary` = acid, `--color-secondary` = magenta, `--color-accent` = violet) and gray scale.
  - **Fonts:** `--font-display`/`--font-heading` = Space Grotesk, Noto Sans TC; `--font-body` = DM Sans, Noto Sans TC; `--font-mono` = JetBrains Mono. Headings tight (`-0.03em`–`-0.04em`), H1/H2 fluid `clamp()`.
  - **Signature:** hard-offset shadows (`4px 4px 0 0 #0A0A0A`, no blur), `--radius 1.25rem`, 2px ink borders, pill buttons. Easing `--ease-pop cubic-bezier(0.34,1.56,0.64,1)`, durations 150/200/300ms. Utility classes: `.pastel-card`, `.game-card`, `.btn-primary`, `.btn-ink`, `.pill-btn`, `.filter-pill`, status badges (`.status-live/closing/open/end`), `.wallet-card`, `.xp-bar`, `.skeleton-acid/-card/-pill/-text`, `.level-pill-l0..l6`, `.text-outline-*`, `.glass-panel`, `.dot-pattern`.
  - **A11y (non-negotiable, from the prototype):** WCAG AA contrast; global `:focus-visible` ring (`2px #D4FF00`, offset 2px; magenta ring on acid backgrounds); `prefers-reduced-motion` collapses animations; every clickable is `<button>`/`<Link>`; icon-only buttons need `aria-label`; never `text-white` on light surfaces.
- **`index.html`** — add the Google Fonts links (Space Grotesk, DM Sans, JetBrains Mono, Noto Sans TC).
- **`src/lib/theme.ts`** — keep `applyTheme()` (workspace `theme` JSON → `--color-acid/magenta/violet`); already neon-aligned via the seed. No change needed beyond confirming the mapping.

### 5.2 Presentational components (`src/components/`, prop-only)

Adapted from the prototype, taking props only (no mock-data imports): `BottomNav`, `PointsBalanceCard`, `MissionCard`, `RewardCard`, `BadgePill`, `ProgressBar`, `FilterPills`, `SkeletonCard`. Out: passport/score-ring/wallet-capital/marketing components.

### 5.3 The 8 screens (all under `/kocmax/$slug`)

| # | Screen / route | Sections (from prototype) | Data source |
|---|---|---|---|
| 1 | Home `/` | hero · how-it-works (3) · **live points balance** (+ Realtime) · quick actions (2×2) · featured missions | `useBalance` + `useMissions` |
| 2 | Mission list `/mission` | header · category filter pills · MissionCard list | `useMissions(category)` |
| 3 | Mission detail `/mission/$missionSlug` | sticky header · hero image · detail/points/deadline cards · CTA | `useMission(slug)` |
| 4 | Redemption `/redemption` | balance card · category filter · 2-col RewardCard grid (sold-out overlay) | `useGifts(category)` |
| 5 | Wallet `/wallet` | balance · transaction history list | `useBalance` + `usePointHistory` |
| 6 | Explore/FAQ `/explore` | member benefits (4) · how-to-earn (4 steps) · FAQ accordion | **static** (port copy verbatim) |
| 7 | T&C `/tnc` | legal prose (5 sections) | **static** |
| 8 | Privacy `/privacy` | legal prose (4 sections) | **static** |
| + | Login `/login` | OTP flow | `signInWithOtp` → `verifyOtp` |

All hooks already exist (`src/lib/queries/kocmax.ts`). Screens 1–5 re-skin existing routes; 6–8 are new static routes; Login is rewritten (5.5).

### 5.4 Navigation / IA

`BottomNav` = 5 fixed glass-panel tabs: **主頁 (Home) / 任務 (Mission) / 積分兌換 (Redemption) / 錢包 (Wallet) / 探索 (Explore)**. Login, T&C, Privacy are reached via links (not tabs). Profile is intentionally absent (deferred). Rationale: blends our real Wallet with the prototype's Explore; avoids a dead Profile tab that would need the score/badge model.

### 5.5 Login — Email/Phone OTP

- Replace the LINE `signInWithOAuth({ provider: "line" })` button with an OTP flow:
  1. Email (and optionally phone) input → `supabase.auth.signInWithOtp({ email })`.
  2. Inline 6-digit code entry → `supabase.auth.verifyOtp({ email, token, type: "email" })`.
  3. On session → first-login bootstrap `POST /api/me/bootstrap` (existing route) → redirect to `/kocmax/$slug`.
- **Email OTP works with no extra provider setup** (default Supabase email; template includes the token). **Phone OTP is optional** and requires an SMS provider (e.g. Twilio) in Supabase — out of the critical path; expose only if configured.
- Keep `kocmax.$slug.auth.callback.tsx` for the email magic-link variant as a fallback; inline code entry is primary.
- **Dependency (unchanged, user-gated):** first-login bootstrap needs `SUPABASE_SERVICE_KEY` in the deploy env. Demo viewing of unauthenticated screens does not.

### 5.6 Data flow (unchanged from Slice 1)

Browser supabase-js for the auth session + the single `point_balances` Realtime channel. All reads go through the Hono REST API (RLS-enforced, request-scoped user client) via the existing TanStack Query hooks. **No new tables, columns, RLS policies, or API routes.** This slice is presentational + the OTP login swap + 3 static screens.

### 5.7 Content fidelity

Port the prototype's **zh-HK copy verbatim** for the static screens (Explore/FAQ benefits + earn steps + 4 FAQ Q&As; T&C 5 sections; Privacy 4 sections) and for screen labels/microcopy (e.g. 你的積分餘額, 限時任務, 積分兌換, 開始任務). Missions/gifts render from the already-seeded zh-HK DB rows.

## 6. Testing

- Render tests for the new prop-only components (`MissionCard`, `RewardCard`, `PointsBalanceCard`, `BottomNav`) — props in, expected markup/labels out.
- Keep the existing query-hook unit tests and the RLS integration suite (`api/_server/test/rls.test.ts`) green.
- Gate: `type-check && lint && test && build` (+ `test:integration` when service key available).
- Visual: deploy a preview and eyeball each screen against the prototype + a `prefers-reduced-motion` and keyboard-focus pass.

## 7. Acceptance criteria

1. `src/styles.css` carries the full Acid Y2K `@theme` + utilities; fonts load; the app renders in neon (acid/magenta/violet on paper/ink) with hard-offset shadows.
2. All 8 screens render in the Acid Y2K language, matching the prototype's layout and zh-HK copy.
3. Home/Mission/Redemption/Wallet show **live seeded data** via the existing hooks; Home balance updates live on a DB change (Realtime).
4. Login completes via email OTP end-to-end (input → code → verify → bootstrap → home) when `SUPABASE_SERVICE_KEY` is set.
5. 5-tab bottom nav (Home/Mission/Redemption/Wallet/Explore) works; Explore/T&C/Privacy render static copy.
6. `type-check + lint + test + build` green; no schema/API changes in the diff.
7. Deployed preview reflects all of the above on cloud data.

## 8. Out of scope → future slices

Profile/Passport + 7 creator scores + badges + levels/XP; My Rewards + redemption write/records (needs a `redemptions` table); the marketing site; the brand/B2B side (Packages, Playbooks, Academy, Copilot, Capital, Offers); the `custom_access_token_hook` JWT `workspace_id` claim (Slice 1 shipped the `private.current_workspace_id()` fallback); real KOCmax data migration from the Laravel backend.

## 9. References

- Prototype: `refreshing-adfocate/docs/design-system.md`, `refreshing-adfocate/src/styles.css`, `refreshing-adfocate/src/routes/kocmax.*.tsx`, `refreshing-adfocate/src/components/`, `refreshing-adfocate/src/data/{kocmaxData,mockData}.ts`.
- Slice 1: workspace-root `docs/superpowers/specs/2026-06-13-adfocate-slice1-kocmax-readonly-design.md` and `.../plans/2026-06-13-adfocate-slice1-kocmax-readonly.md`.
- Existing app surface to re-skin: `adfocate-2/src/routes/kocmax.$slug*.tsx`, `adfocate-2/src/lib/queries/kocmax.ts`, `adfocate-2/src/lib/theme.ts`.
