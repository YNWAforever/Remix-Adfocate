# Adfocate 2.0 — Slice 3: Onboarding & Auth — Design

- **Date:** 2026-06-14
- **Status:** Approved design — ready for implementation plan
- **Scope decision:** "Onboarding & Auth, clean boundary" (deferring mission writes + ported PointService + referral payout to Slice 4)
- **Auth decision:** Add **Google OAuth** on top of the existing email magic-link. Apple/LINE deferred.
- **Re-baselines:** Full product spec §6 (KOC Onboarding System) onto the deployed Supabase Auth + Hono-on-Vercel + RLS stack. Per the architecture re-baseline doc, the spec is authoritative for **product scope**; this design wins on **infra**.
- **References:** `docs/superpowers/specs/adfocate-2-spec.md` (§3 Creator entity, §4.1–4.2 auth/onboarding APIs, §6 onboarding, §7.1–7.2 L0/XP, §8.1 routes, §15 KoLink); `docs/superpowers/specs/2026-06-13-adfocate-2.0-architecture-supabase-rebaseline.md` (§4 slice roadmap). Slice 1/2 status in user memory.

---

## 1. Goal & scope

Deliver a **frictionless signup + onboarding** for the KOCmax member portal: a creator can join with Google or email, complete a short resumable wizard (categories → platforms → first-mission preview → welcome bonus), and land on the home screen as an `L0` member with 100 welcome points and a shareable referral code.

**In scope (Slice 3):**
- Google OAuth login (alongside existing magic-link).
- An onboarding **gate** that routes not-yet-onboarded creators into a wizard before the home screen.
- New `creators` onboarding columns + a self-scoped UPDATE RLS policy + the `0003_grants.sql` fix (see §8).
- A guarded `/api/onboarding` endpoint group + an extended `/me/bootstrap`.
- The 5-step wizard UI (Steps 2–5; Step 1 is the auth screen).
- Welcome-points award (100, service-role) + referral-code generation.
- Tests: the missing `/me/bootstrap` integration test, onboarding endpoints, gate redirects.

**Explicitly deferred (see §11).**

## 2. Current state — the seam Slice 3 extends

(Verified by codebase analysis, 2026-06-14.)

- **Auth = Supabase magic-link email only**; `signInWithOAuth` is unused (`src/routes/kocmax.$slug.login.tsx:20`). The callback relies on implicit-flow hash parsing via `detectSessionInUrl` (`src/routes/kocmax.$slug.auth.callback.tsx:15-19`).
- **The only post-login step** is `POST /api/me/bootstrap` (unguarded, `server/routes/me.ts:7-33`): it service-role-upserts a `creators` row (`id`=auth uid, `display_name`=email) + a zero `point_balances` row, idempotently (`ignoreDuplicates`), returns `{ok:true}` — so it **cannot distinguish first-login from returning**.
- **The only route guard** is `kocmax.$slug.tsx` `beforeLoad` (`src/routes/kocmax.$slug.tsx:8-17`): checks session presence only. Every authenticated KOCmax route passes through it — the natural gate chokepoint.
- **`creators` IS the profile/member table** (`supabase/migrations/0001_init.sql:13-25`), 1:1 on the auth user id, already carrying `display_name, avatar_url, level (default 'L0'), xp, categories (default '{}'), social_handles (default '[]'), scores, status (default 'active')`.
- **`point_balances` + `point_transactions` exist**; the txn-type CHECK already includes `'bonus'` and `'referral'` (`0001_init.sql:81-91`) → welcome/referral points need **no enum migration**.
- **No write endpoints** beyond the unguarded bootstrap; **none** of §4.2's `/onboarding/*` endpoints exist.
- `WORKSPACE_SLUG` is hardcoded `'demo'` (`src/lib/api.ts:3`), used for both the bootstrap body and the `X-Workspace-Slug` header — must become route-derived.
- **No i18n framework**; copy is hardcoded zh-Hant-HK.

## 3. Confirmed decisions

| # | Decision |
|---|---|
| 1 | **Referral promise displayed as "200 points each side"** (resolves §6.2 *200 pts* vs §7.2 *100 XP* in favour of the onboarding-facing 200 points). The referral code is generated in Slice 3; the **actual payout crediting is built in Slice 4**. |
| 2 | **Welcome bonus = 100 points, no XP.** Recorded as a `point_transactions` row with `type='bonus'`. |
| 3 | **New creators start `status='active'`** (zero-follower, start-earning-day-one ethos; §6.1). |
| 4 | **"Onboarding complete" = reached/claimed Step 5.** Categories and socials are **skippable**; the wizard is **resumable** via `onboarding_step`. |
| 5 | **Gate = Hybrid** (callback redirect on first login + a cheap cached guard check). |
| 6 | **i18n stays hardcoded zh-Hant-HK**; a real i18n framework is a separate future pass. |

## 4. Architecture

### 4.1 Auth & Step 1 (entry)

- Add a **"Continue with Google"** button to `src/routes/kocmax.$slug.login.tsx` calling `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/kocmax/<slug>/auth/callback } })`, beside the existing magic-link form.
- Standardise the Supabase client on the **PKCE flow** (`flowType: 'pkce'`). OAuth returns a `?code=` query; the callback must call `exchangeCodeForSession`. **Both paths must keep working**: magic-link (token in URL) and OAuth (`?code=`). The callback (`src/routes/kocmax.$slug.auth.callback.tsx`) becomes: resolve session (handle `?code=` exchange if present) → bootstrap → branch on onboarding state.
- The callback's `refreshSession()` call is retained for timing (ensuring the just-created `creators` row is visible); note it does **not** add a `workspace_id` JWT claim (no `custom_access_token` hook — tenancy is resolved server-side via `private.current_workspace_id()`).

### 4.2 Onboarding gate (Hybrid)

1. **Callback redirect (first-login path):** after `bootstrap` returns `{created}` (or `/onboarding/status` reports incomplete), navigate to `/kocmax/$slug/onboarding` resumed at `onboarding_step`, instead of home.
2. **Cached guard (defence in depth):** `kocmax.$slug.tsx` `beforeLoad` reads the onboarding flag from a **cached** `/me` (TanStack Query); if `onboarding_completed=false` and the target is not an auth/onboarding route → redirect into the wizard. Cached ⇒ **no extra network round-trip per navigation** after first load.
3. Extend the guard's `isAuthRoute` check (`kocmax.$slug.tsx:11`) so onboarding routes require a session but are **excluded** from the incomplete→wizard redirect (else infinite loop).

*Alternatives rejected:* callback-only (bypassable by typing a URL); guard-only (adds a network hop to every navigation).

## 5. Data model & migrations

### 5.1 Migration `0003_onboarding.sql`

```sql
ALTER TABLE public.creators
  ADD COLUMN onboarding_step      integer NOT NULL DEFAULT 1,
  ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN referral_code        text UNIQUE,
  ADD COLUMN referred_by          uuid REFERENCES public.creators(id);

-- status currently unconstrained; constrain it (default stays 'active')
ALTER TABLE public.creators
  ADD CONSTRAINT creators_status_chk
  CHECK (status IN ('active','suspended','pending_review'));

-- self-scoped profile writes via the user client (points stay service-role)
CREATE POLICY creators_self_update ON public.creators
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
```

- **Referral code:** short, human-shareable (e.g. 8-char base32 derived from `gen_random_uuid()`), generated app-side with retry-on-unique-collision (or a DB default). Backfill existing rows.
- **RLS boundary:** the new `UPDATE` policy lets a creator edit **only their own** profile fields. **`point_transactions` keeps no INSERT policy** — welcome/referral point awards go through the **service-role** path (`server/lib/supabase.ts` service client), so users can never mint points.

### 5.2 Migration `0003_grants.sql` (folds in the integration-403 fix — see §8)

```sql
GRANT SELECT ON public.workspaces, public.missions, public.redemption_gifts,
                public.creators, public.point_balances, public.point_transactions
  TO authenticated;
-- (UPDATE on creators is governed by the RLS policy above; grant UPDATE(col-list) on creators to authenticated)
```

Also set `auto_expose_new_tables = false` explicitly in `supabase/config.toml` so the local stack matches cloud and future tables fail loudly in CI rather than silently relying on a deprecated default.

## 6. API — new `/api/onboarding` group (guarded by `workspaceAuth`)

The creator row already exists post-bootstrap, so these are guarded normally.

| Method & path | Behaviour |
|---|---|
| `GET /api/onboarding/status` | Returns `{ onboarding_step, onboarding_completed, completion_pct }`. |
| `PUT /api/onboarding/profile` | Writes `display_name`, `avatar_url`, `categories` (user client + self-UPDATE RLS); advances `onboarding_step` (max). |
| `POST /api/onboarding/social/connect` | Appends a `{platform, handle, followers, verified:false}` entry to `social_handles` jsonb; advances step. Self-reported (verified later, Slice 7). |
| `GET /api/onboarding/recommended-missions` | `missions WHERE workspace_id = current AND status='active' AND access_type='open' AND category = ANY(creator.categories)` limit 3. **No Matching Agent** (Slice 7). Falls back to any open missions if categories empty. |
| `POST /api/onboarding/complete` | **Service-role, idempotent:** if not already completed — insert `point_transactions {type:'bonus', delta:+100, balance_after, source_ref:'welcome', description}` **and** bump `point_balances.balance` atomically; ensure `referral_code`; set `onboarding_completed=true`, `onboarding_step=5`. |

**Extend `POST /api/me/bootstrap`** (`server/routes/me.ts`): on the creator upsert, initialise `onboarding_step=1` + generate `referral_code`; accept an optional referral code from the signup link → resolve to a referrer and set `referred_by`; return `{ created: boolean }` so the callback can branch.

**`GET /api/me`** should surface `onboarding_step` / `onboarding_completed` (the gate's cached source).

**Client:** make `WORKSPACE_SLUG` route-derived (`src/lib/api.ts:3`) so bootstrap/onboarding use the real `$slug`, not hardcoded `'demo'`.

## 7. Wizard UI

Route: `src/routes/kocmax.$slug.onboarding.tsx` (a stepper; Step 1 = the auth screen, so the wizard covers Steps 2–5). Reuses `ProgressBar` (5-step indicator), `FilterPills` (extended to **multi-select** for categories), `MissionCard` (Step 4 previews), `PointsBalanceCard` (Step 5 reveal). Copy hardcoded zh-Hant-HK, Acid Y2K design language.

- **Step 2 — Categories (`你的範疇`):** multi-select chips (1–3: 美容/餐飲/生活/科技/旅遊/媽媽/寵物…), **skippable** → `PUT /onboarding/profile`.
- **Step 3 — Platforms (`你的平台`):** manual handle entry for IG / 小紅書 / TikTok / YouTube, **skippable** (honours "no form wall"; self-reported) → `POST /onboarding/social/connect`.
- **Step 4 — First Mission (`你的第一個任務`):** **preview** 3 recommended open missions via `GET /onboarding/recommended-missions`; CTA advances. **No real join** — the creator joins post-onboarding on the live mission screens (joins are Slice 4). Copy makes the "join right after" path clear.
- **Step 5 — Welcome Bonus (`迎新獎賞`):** calls `POST /onboarding/complete` → reveal **+100 積分**, show `referral_code` + share prompt (`邀請朋友，各得 200 分`), L0 Newcomer passport stub → navigate home.

The wizard resumes at the persisted `onboarding_step` if the user re-enters mid-flow.

## 8. The integration-403 fix (folded in)

The CI `integration` job (`server/test/rls.test.ts`) has been red on `main`: `/api/missions` and `/api/wallet/points/history` return 403 instead of 200. **Root cause (confirmed): a missing table-level `GRANT`**, not a seed/membership/RLS bug. No migration ever granted `SELECT` to `authenticated` on `missions`/`redemption_gifts`/`point_transactions`; they relied on Supabase's implicit auto-expose, whose default **flipped to `false` on 2026-05-30**. `point_balances` survived via an explicit publication add (so the *balance* tests pass). Production still works because the **cloud project predates the flip**; the **fresh CI local stack is post-flip**.

Fix = `0003_grants.sql` (§5.2) + pinning `auto_expose_new_tables=false`. This turns the two red tests green and hardens against drift. **It belongs in Slice 3** because Slice 3 adds new tables/columns and the first **write** paths, so getting grants + RLS write-policies right is this slice's responsibility.

## 9. Testing

- **Add the missing `/me/bootstrap` integration test** (currently untested) — a brand-new user with no `creators` row calls bootstrap, then `workspaceAuth` resolves them and `GET /me` returns the profile. This is the exact creator + workspace-membership path onboarding rides on.
- Onboarding endpoint tests: `status`, `profile` write (+ RLS self-scope), `social/connect`, `recommended-missions` filter, `complete` (welcome-points award + idempotency / no double-award).
- Gate tests: not-onboarded → redirected into wizard; completed → reaches home; onboarding routes excluded from the redirect loop.
- Keep all gates green (type-check, lint, build, unit + integration once grants land).

## 10. User-gated setup (Google OAuth)

Cannot be done by the agent (provider credentials + dashboard):
1. Create a **Google Cloud OAuth 2.0 client** (Web), authorised redirect URI = the Supabase Auth callback (`https://<project>.supabase.co/auth/v1/callback`).
2. In **Supabase → Auth → Providers → Google**: enable + paste client id/secret.
3. In **Supabase → Auth → URL Configuration**: ensure the app callback `<origin>/kocmax/*/auth/callback` is in the redirect allow-list and Site URL is the real origin.

Exact steps will be restated in the implementation plan / a `SETUP.md` note.

## 11. Deferred / out of scope

| Item | Owner slice |
|---|---|
| Real mission **join** write + ported `PointService` + referral **payout** crediting | Slice 4 |
| Social-handle **OAuth verification** + Matching-Agent recommendations | Slice 7 |
| Pre-signup **earnings simulator** (§6.3), progressive-enrichment nudges (§6.4), payout/FPS | Slice 5+ |
| **Apple & LINE** OAuth providers | Future |
| A real **i18n framework** (en / zh-HK) | Separate pass |

## 12. Risks & notes

- **PKCE migration risk:** switching `flowType` to `pkce` changes how *both* magic-link and OAuth resolve in the callback. Verify magic-link still completes end-to-end (it currently depends on implicit-hash parsing) before merge; this needs the Supabase redirect allow-list configured (Slice 2's pending item).
- **Gate caching:** the guard must read onboarding state from cache, not a fresh fetch per navigation, or every page transition pays a round-trip.
- **Referral self-referral / loops:** `referred_by` resolution must reject self-referral and unknown codes gracefully (no hard failure of signup).
- **Idempotency:** `/onboarding/complete` must never double-award welcome points on retry/double-submit.
