# Adfocate 2.0 — Slice 3: Onboarding & Auth — Design

- **Date:** 2026-06-14
- **Status:** Revised for **WhatsApp-primary auth** — awaiting user spec re-review before writing the implementation plan.
- **Scope decision:** "Onboarding & Auth, clean boundary" (deferring mission writes + ported PointService + referral payout to Slice 4; deferring two-way messaging to **Slice 3.5 — Messaging**).
- **Auth decision:** **WhatsApp phone-OTP is the PRIMARY login** (Hong Kong-first), via Supabase phone auth on **Twilio Verify** (WhatsApp channel). **Email magic-link** (existing) and **Google OAuth** remain as **secondary** methods; a logged-in creator can converge methods onto one identity via `linkIdentity`. Apple/LINE deferred.
- **Provider strategy = Hybrid:** native **Twilio Verify** for the auth OTP only; the live **Laravel `fimmick-crm` kocmax** two-way WhatsApp pipeline (iSlash/SleekFlow/Woztell) is reused for conversational messaging when **Slice 3.5** lands. The OTP sender is kept **separate** from the messaging sender (Twilio account-quality guidance).
- **Re-baselines:** Full product spec §6 (KOC Onboarding System) onto the deployed Supabase Auth + Hono-on-Vercel + RLS stack. Per the architecture re-baseline doc, the spec is authoritative for **product scope**; this design wins on **infra**.
- **References:** `docs/superpowers/specs/adfocate-2-spec.md` (§3 Creator entity, §4.1–4.2 auth/onboarding APIs, §6 onboarding, §7.1–7.2 L0/XP, §8.1 routes, §15 KoLink); `docs/superpowers/specs/2026-06-13-adfocate-2.0-architecture-supabase-rebaseline.md` (§4 slice roadmap). Slice 1/2 status in user memory.

---

## 1. Goal & scope

Deliver a **frictionless, Hong-Kong-first signup + onboarding** for the KOCmax member portal: a creator joins with their **WhatsApp number** (one-tap OTP), completes a short resumable wizard (categories → platforms → first-mission preview → welcome bonus), and lands on the home screen as an `L0` member with 100 welcome points and a shareable referral code. Email magic-link and Google remain available for creators who prefer them.

**In scope (Slice 3):**
- **WhatsApp phone-OTP login (PRIMARY)** — inline `signInWithOtp`/`verifyOtp`, no redirect/callback.
- Keep **email magic-link**; add **Google OAuth** — both **secondary**, redirect/callback-based.
- An onboarding **gate** that routes not-yet-onboarded creators into a wizard before the home screen (works for both the inline and the callback auth paths).
- New `creators` onboarding columns **+ `phone`** + a self-scoped UPDATE RLS policy + the `0003_grants.sql` fix (see §8).
- A guarded `/api/onboarding` endpoint group + an extended, **null-email-tolerant** `/me/bootstrap`.
- The 5-step wizard UI (Steps 2–5; Step 1 is the auth screen).
- Welcome-points award (100, service-role) + referral-code generation.
- Tests: the missing `/me/bootstrap` integration test (phone-primary + email), onboarding endpoints, gate redirects.

**Explicitly deferred (see §11)** — including all **two-way / conversational messaging** (→ Slice 3.5).

## 2. Current state — the seam Slice 3 extends

(Verified by codebase analysis, 2026-06-14.)

- **Auth = Supabase magic-link email only**; `signInWithOAuth` is unused (`src/routes/kocmax.$slug.login.tsx:20`). No phone auth. The callback relies on implicit-flow hash parsing via `detectSessionInUrl` (`src/routes/kocmax.$slug.auth.callback.tsx:15-19`).
- **The only post-login step** is `POST /api/me/bootstrap` (unguarded, `server/routes/me.ts:7-33`): it service-role-upserts a `creators` row (`id`=auth uid, **`display_name`=email**) + a zero `point_balances` row, idempotently (`ignoreDuplicates`), returns `{ok:true}`. **Two problems for this slice:** (a) it **cannot distinguish first-login from returning**; (b) the **`display_name`=email hack breaks for phone-primary users**, whose JWT may carry no email.
- **The only route guard** is `kocmax.$slug.tsx` `beforeLoad` (`src/routes/kocmax.$slug.tsx:8-17`): checks session presence only. Every authenticated KOCmax route passes through it — the natural gate chokepoint.
- **`creators` IS the profile/member table** (`supabase/migrations/0001_init.sql:13-25`), 1:1 on the auth user id, already carrying `display_name, avatar_url, level (default 'L0'), xp, categories (default '{}'), social_handles (default '[]'), scores, status (default 'active')`. **No `phone` column yet.**
- **`point_balances` + `point_transactions` exist**; the txn-type CHECK already includes `'bonus'` and `'referral'` (`0001_init.sql:81-91`) → welcome/referral points need **no enum migration**.
- **No write endpoints** beyond the unguarded bootstrap; **none** of §4.2's `/onboarding/*` endpoints exist.
- `WORKSPACE_SLUG` is hardcoded `'demo'` (`src/lib/api.ts:3`), used for both the bootstrap body and the `X-Workspace-Slug` header — must become route-derived.
- **No conversational-messaging infra in adfocate-2** (greenfield). The live two-way WhatsApp system lives in the **Laravel `fimmick-crm` kocmax backend** (inbound webhook → `whatsapp_webhook_inbounds` → `ProcessWhatsappWebhookInbound` → `HandleTextMessage`/`HandleImageMessage`; outbound `SendSessionMessage`/`SendTemplateMessage`). That system is **reused in Slice 3.5**, not rebuilt here.
- **No i18n framework**; copy is hardcoded zh-Hant-HK.

## 3. Confirmed decisions

| # | Decision |
|---|---|
| 1 | **WhatsApp phone-OTP is the PRIMARY auth** (HK-first). Inline flow, no redirect. Provider = **Twilio Verify** (WhatsApp channel). |
| 2 | **Email magic-link + Google OAuth are SECONDARY**, redirect/callback-based. A logged-in creator may attach additional methods to one identity via `linkIdentity` (convergence UI itself is deferred — see §11). |
| 3 | **Referral promise displayed as "200 points each side"** (resolves §6.2 *200 pts* vs §7.2 *100 XP* in favour of the onboarding-facing 200 points). The referral code is generated in Slice 3; the **actual payout crediting is built in Slice 4**. |
| 4 | **Welcome bonus = 100 points, no XP.** Recorded as a `point_transactions` row with `type='bonus'`. |
| 5 | **New creators start `status='active'`** (zero-follower, start-earning-day-one ethos; §6.1). |
| 6 | **"Onboarding complete" = reached/claimed Step 5.** Categories and socials are **skippable**; the wizard is **resumable** via `onboarding_step`. |
| 7 | **Gate = Hybrid** (post-auth redirect on first login + a cheap cached guard check). |
| 8 | **i18n stays hardcoded zh-Hant-HK**; a real i18n framework is a separate future pass. |
| 9 | **Two-way / conversational messaging is OUT of Slice 3** → **Slice 3.5 — Messaging**, reusing the Laravel kocmax pipeline (hybrid). |

## 4. Architecture

### 4.1 Auth & Step 1 (entry)

The login screen (`src/routes/kocmax.$slug.login.tsx`) presents **WhatsApp first**, with email magic-link and Google offered as "other ways to sign in".

**Primary — WhatsApp phone OTP (inline, no redirect):**
1. User enters their phone number (HK default `+852`, E.164-normalised).
2. `supabase.auth.signInWithOtp({ phone, options: { channel: 'whatsapp' } })` — Supabase → Twilio Verify → an **Authentication-category** WhatsApp template delivers the 6-digit code.
3. User enters the code → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` (`type:'sms'` is the verify type for phone OTP regardless of channel). On success the session is established **in place** — **no callback route, no `?code=`, no PKCE**.
4. The login component then runs the shared **post-auth branch** (see §4.2): `POST /api/me/bootstrap` → branch on `{created}` / onboarding state → navigate to the wizard or home.

Because the primary path is inline, it **does not touch the Supabase redirect allow-list** — it sidesteps the Slice 2 magic-link redirect-config blocker and the PKCE-migration risk for the majority of HK signups.

**Secondary — email magic-link (existing) + Google OAuth (new), redirect-based:**
- Magic-link unchanged in spirit (token in URL).
- "Continue with Google" calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/kocmax/<slug>/auth/callback } })`.
- These two share the existing **callback route** (`src/routes/kocmax.$slug.auth.callback.tsx`). For them, standardise the client on the **PKCE flow** (`flowType: 'pkce'`): Google returns `?code=` → the callback calls `exchangeCodeForSession`; magic-link continues to resolve its token. The callback then runs the same **post-auth branch** as the inline path.
- The callback's `refreshSession()` is retained for timing (ensuring the just-created `creators` row is visible). No `workspace_id` JWT claim is added (tenancy stays server-side via `private.current_workspace_id()`).

**Identity convergence:** each method can independently create/sign in a user. To attach a second method to an **already-authenticated** creator (e.g. a WhatsApp user adding Google), the client supports `supabase.auth.linkIdentity(...)`. The **in-app UI** for proactive linking is deferred (§11); Slice 3 ships the auth client capability and the data model that tolerates it, not a settings screen.

### 4.2 Onboarding gate (Hybrid)

A single **post-auth branch** helper is invoked from **both** trigger points — the inline WhatsApp `verifyOtp` success handler **and** the redirect callback — so the gate logic lives in one place:

1. **Post-auth redirect (first-login path):** after `bootstrap` returns `{created}` (or `/onboarding/status` reports incomplete), navigate to `/kocmax/$slug/onboarding` resumed at `onboarding_step`, instead of home.
2. **Cached guard (defence in depth):** `kocmax.$slug.tsx` `beforeLoad` reads the onboarding flag from a **cached** `/me` (TanStack Query); if `onboarding_completed=false` and the target is not an auth/onboarding route → redirect into the wizard. Cached ⇒ **no extra network round-trip per navigation** after first load.
3. Extend the guard's `isAuthRoute` check (`kocmax.$slug.tsx:11`) so onboarding routes require a session but are **excluded** from the incomplete→wizard redirect (else infinite loop).

*Alternatives rejected:* callback/branch-only (bypassable by typing a URL); guard-only (adds a network hop to every navigation).

## 5. Data model & migrations

### 5.1 Migration `0003_onboarding.sql`

```sql
ALTER TABLE public.creators
  ADD COLUMN onboarding_step      integer NOT NULL DEFAULT 1,
  ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN phone                text,                     -- E.164; mirrors auth.users.phone; NULL for email/Google-only users
  ADD COLUMN referral_code        text UNIQUE,
  ADD COLUMN referred_by          uuid REFERENCES public.creators(id);

CREATE INDEX creators_phone_idx ON public.creators (phone);

-- status currently unconstrained; constrain it (default stays 'active')
ALTER TABLE public.creators
  ADD CONSTRAINT creators_status_chk
  CHECK (status IN ('active','suspended','pending_review'));

-- self-scoped profile writes via the user client (points stay service-role)
CREATE POLICY creators_self_update ON public.creators
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
```

- **`phone`:** nullable text mirroring `auth.users.phone` (the source of truth for uniqueness, already enforced by Supabase auth on the phone identity). Stored on `creators` so the profile/display layer and `/me` can read it without joining `auth.users`. Indexed for lookup; not separately UNIQUE-constrained (auth.users already guarantees one user per verified phone, and `creators.id` is 1:1 with the auth user).
- **`display_name` stays NOT NULL** but is now derived tolerantly at bootstrap (`email ?? E.164 phone ?? 'KOC'` — see §6), removing the email-only assumption.
- **Referral code:** short, human-shareable (e.g. 8-char base32 derived from `gen_random_uuid()`), generated app-side with retry-on-unique-collision (or a DB default). Backfill existing rows.
- **RLS boundary:** the new `UPDATE` policy lets a creator edit **only their own** profile fields. **`point_transactions` keeps no INSERT policy** — welcome/referral point awards go through the **service-role** path (`server/lib/supabase.ts` service client), so users can never mint points.

### 5.2 Migration `0003_grants.sql` (folds in the integration-403 fix — see §8)

```sql
GRANT SELECT ON public.workspaces, public.missions, public.redemption_gifts,
                public.creators, public.point_balances, public.point_transactions
  TO authenticated;
-- UPDATE on creators is governed by the RLS policy above; grant the editable
-- profile column-list (display_name, avatar_url, categories, social_handles,
-- onboarding_step, phone) UPDATE to authenticated.
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

**Extend `POST /api/me/bootstrap`** (`server/routes/me.ts`) — **null-email-tolerant, phone-primary:**
- Read identity from the verified JWT, which may carry **`phone` instead of `email`** (WhatsApp signups) or either/both.
- `display_name = email ?? formattedPhone ?? 'KOC'`; **persist `phone`** when the JWT has one.
- Initialise `onboarding_step=1` + generate `referral_code`.
- Accept an optional referral code from the signup link → resolve to a referrer and set `referred_by`.
- Return `{ created: boolean }` so the caller (inline handler or callback) can branch.

**`GET /api/me`** should surface `onboarding_step` / `onboarding_completed` / `phone` (the gate's cached source).

**Client:** make `WORKSPACE_SLUG` route-derived (`src/lib/api.ts:3`) so bootstrap/onboarding use the real `$slug`, not hardcoded `'demo'`.

## 7. Wizard UI

Route: `src/routes/kocmax.$slug.onboarding.tsx` (a stepper; Step 1 = the auth screen, so the wizard covers Steps 2–5). Reuses `ProgressBar` (5-step indicator), `FilterPills` (extended to **multi-select** for categories), `MissionCard` (Step 4 previews), `PointsBalanceCard` (Step 5 reveal). Copy hardcoded zh-Hant-HK, Acid Y2K design language.

- **Step 1 — Sign in (`登入`):** WhatsApp number field (`+852` default) → "用 WhatsApp 收驗證碼" → 6-digit code entry → verify. Below it, a quieter "其他登入方式": email magic-link + Continue with Google. This is the login screen, not part of the wizard stepper.
- **Step 2 — Categories (`你的範疇`):** multi-select chips (1–3: 美容/餐飲/生活/科技/旅遊/媽媽/寵物…), **skippable** → `PUT /onboarding/profile`.
- **Step 3 — Platforms (`你的平台`):** manual handle entry for IG / 小紅書 / TikTok / YouTube, **skippable** (honours "no form wall"; self-reported) → `POST /onboarding/social/connect`.
- **Step 4 — First Mission (`你的第一個任務`):** **preview** 3 recommended open missions via `GET /onboarding/recommended-missions`; CTA advances. **No real join** — the creator joins post-onboarding on the live mission screens (joins are Slice 4). Copy makes the "join right after" path clear.
- **Step 5 — Welcome Bonus (`迎新獎賞`):** calls `POST /onboarding/complete` → reveal **+100 積分**, show `referral_code` + share prompt (`邀請朋友，各得 200 分`), L0 Newcomer passport stub → navigate home.

The wizard resumes at the persisted `onboarding_step` if the user re-enters mid-flow.

## 8. The integration-403 fix (folded in)

The CI `integration` job (`server/test/rls.test.ts`) has been red on `main`: `/api/missions` and `/api/wallet/points/history` return 403 instead of 200. **Root cause (confirmed): a missing table-level `GRANT`**, not a seed/membership/RLS bug. No migration ever granted `SELECT` to `authenticated` on `missions`/`redemption_gifts`/`point_transactions`; they relied on Supabase's implicit auto-expose, whose default **flipped to `false` on 2026-05-30**. `point_balances` survived via an explicit publication add (so the *balance* tests pass). Production still works because the **cloud project predates the flip**; the **fresh CI local stack is post-flip**.

Fix = `0003_grants.sql` (§5.2) + pinning `auto_expose_new_tables=false`. This turns the two red tests green and hardens against drift. **It belongs in Slice 3** because Slice 3 adds new tables/columns and the first **write** paths, so getting grants + RLS write-policies right is this slice's responsibility.

## 9. Testing

- **Add the missing `/me/bootstrap` integration test** (currently untested), in **two identity shapes**: (a) a **phone-primary** user (JWT has `phone`, no email) → `creators` row created with `phone` set and a non-null `display_name`; (b) an **email** user (existing behaviour). Then `workspaceAuth` resolves them and `GET /me` returns the profile. This is the exact creator + workspace-membership path onboarding rides on.
- Onboarding endpoint tests: `status`, `profile` write (+ RLS self-scope), `social/connect`, `recommended-missions` filter, `complete` (welcome-points award + idempotency / no double-award).
- Gate tests: not-onboarded → redirected into wizard (from **both** the inline post-verify branch and the callback); completed → reaches home; onboarding routes excluded from the redirect loop.
- Keep all gates green (type-check, lint, build, unit + integration once grants land).

*Note:* the WhatsApp OTP send/verify round-trip itself is a Supabase↔Twilio integration — not unit-tested here; covered by a manual/staging smoke check once the sender is provisioned (§10).

## 10. User-gated setup (cannot be done by the agent)

External provider credentials + dashboard configuration. Two independent blocks:

**A. WhatsApp phone-OTP (PRIMARY) — Meta WABA + Twilio Verify:**
1. **Meta WhatsApp Business Account (WABA):** a verified business, a WhatsApp sender (a HK `+852` number or a Twilio-hosted sender), and an approved **Authentication-category** message template for the OTP (template approval has lead time — start early).
2. **Twilio:** create a **Verify Service**, enable the **WhatsApp channel** on it, and connect the WABA sender. Keep this OTP sender **separate** from any number used for conversational messaging (Slice 3.5) to protect sender quality rating.
3. **Supabase → Auth → Providers → Phone:** enable phone auth, set the SMS provider to **Twilio Verify**, paste Account SID / Auth Token / **Verify Service SID**, and enable the **WhatsApp** channel.
4. Note costs: HK WhatsApp Authentication messages ~**HKD 0.25/msg from 2026-07-01**; Twilio Verify ~**USD 0.05/verification**.

**B. Google OAuth (SECONDARY):**
1. Create a **Google Cloud OAuth 2.0 client** (Web), authorised redirect URI = the Supabase Auth callback (`https://<project>.supabase.co/auth/v1/callback`).
2. In **Supabase → Auth → Providers → Google**: enable + paste client id/secret.
3. In **Supabase → Auth → URL Configuration**: ensure the app callback `<origin>/kocmax/*/auth/callback` is in the redirect allow-list and Site URL is the real origin. (Also unblocks the secondary **magic-link** path — Slice 2's pending item. The primary WhatsApp path does **not** need this.)

Exact steps will be restated in the implementation plan / a `SETUP.md` note.

## 11. Deferred / out of scope

| Item | Owner slice |
|---|---|
| **Two-way / conversational WhatsApp messaging** (inbound webhooks, `whatsapp_conversations`/`messages`, dispatch, outbound session/template sends) — **hybrid reuse of the live Laravel `fimmick-crm` kocmax pipeline** (iSlash/SleekFlow/Woztell), with PDPO consent + pgmq/pg_cron worker plumbing on the Supabase side | **Slice 3.5 — Messaging** |
| In-app **identity-linking UI** (a settings screen to attach Google/email/phone to one creator via `linkIdentity`) | Slice 3.5+ |
| Real mission **join** write + ported `PointService` + referral **payout** crediting | Slice 4 |
| Social-handle **OAuth verification** + Matching-Agent recommendations | Slice 7 |
| Pre-signup **earnings simulator** (§6.3), progressive-enrichment nudges (§6.4), payout/FPS | Slice 5+ |
| **Apple & LINE** OAuth providers | Future |
| A real **i18n framework** (en / zh-HK) | Separate pass |

## 12. Risks & notes

- **Phone-primary identity (email may be null):** the `display_name`=email hack is removed; bootstrap must derive `display_name` and store `phone` from whichever identity the JWT carries. Covered by the two-shape bootstrap test (§9). Any other code assuming `creators.display_name == email` must be audited.
- **Account linking / duplicate humans:** the same person signing up via WhatsApp and later via Google creates **two creators** unless they link. Convergence UI is deferred (§11); until then, treat each verified identity as its own member. Note the risk for support/dedupe; do not auto-merge on matching phone/email (security).
- **Twilio Verify / Meta WABA provisioning is a hard external dependency:** template approval lead time, sender provisioning, and per-message cost (§10.A). The primary login is blocked until this is live — the secondary email/Google paths provide a fallback during provisioning.
- **PKCE migration (secondary paths only):** switching `flowType` to `pkce` changes how magic-link **and** Google resolve in the callback. Verify magic-link still completes end-to-end (it currently depends on implicit-hash parsing) before merge; this needs the Supabase redirect allow-list configured (§10.B). The **primary WhatsApp path is inline and unaffected.**
- **Gate caching:** the guard must read onboarding state from cache, not a fresh fetch per navigation, or every page transition pays a round-trip.
- **Referral self-referral / loops:** `referred_by` resolution must reject self-referral and unknown codes gracefully (no hard failure of signup).
- **Idempotency:** `/onboarding/complete` must never double-award welcome points on retry/double-submit.
- **OTP sender vs messaging sender:** keeping the Twilio Verify OTP sender separate from the Slice 3.5 conversational sender avoids a quality-rating downgrade bleeding from one into the other.
