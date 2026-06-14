# Adfocate 2.0 — Deployment Config Runbook

The code is deployed; these are the **dashboard / env steps a human must do** (the agent can't). Do the 🔴 items before relying on the feature they gate.

> 🟢 **Item 0 done (2026-06-14):** migrations 0003–0007 applied to cloud via the SQL editor; all tables/functions/grants/RLS verified present and `redemption_codes` confirmed secret (RLS default-deny). The migration *tracker* still reads 0001+0002 — see the item 0 note about a future `supabase db push`.

**Constants**
- Production origin: `https://adfocate-2.vercel.app`
- Supabase project ref: `mhkoayftiuojxlrkollf`
- Vercel project: `adfocate-2`

| # | Item | Gates | Status |
|---|------|-------|--------|
| 0 | Apply migrations **0003 → 0007** to the cloud DB | all backend features (onboarding, missions, redemption, earnings) | 🟢 done (2026-06-14, SQL editor) |
| 1 | Supabase Site URL + redirect allow-list → `/auth/callback` | Google + email-magic-link login | 🔴 pending |
| 2 | Google OAuth client + redirect → `/auth/callback` | "Sign in with Google" | 🔴 pending |
| 3 | Twilio + Meta WABA → Supabase Phone provider | WhatsApp OTP (primary login) | 🔴 pending |
| 4 | `ADMIN_SECRET` env in Vercel | operator approve/reject endpoints | 🟢 set (per user) |
| 5 | `SUPABASE_SERVICE_KEY` env in Vercel | all backend writes | 🟢 set (prod API works) |
| 6 | Replace `public/og.png` placeholder | branded WhatsApp/social preview | 🟡 nice-to-have |
| 7 | Disable Vercel **preview** Deployment Protection | headless preview testing | ⚪ optional |

### Login-method flags (staged rollout)
The login page only shows a method once its provider is live, via Vercel env flags (default **off**). **Email magic-link is always shown** (it only needs item 1). As you finish items 2/3, flip the matching flag and redeploy:
- `VITE_ENABLE_GOOGLE = "true"` → shows "用 Google 登入" (needs item 2)
- `VITE_ENABLE_WHATSAPP = "true"` → makes WhatsApp the primary method + landing CTA (needs item 3)

So **stage 1 = item 1 only → email magic-link works, no broken buttons**. Set the flags in **Vercel → Settings → Environment Variables** (Production), then redeploy.

---

## 0. 🔴🔴 Supabase cloud — apply migrations 0003 → 0007
The cloud project `mhkoayftiuojxlrkollf` has only migrations **0001 + 0002** applied. **0003** (onboarding), **0004** (grants), **0005** (mission_submissions), **0006** (redemption), **0007** (earnings) were only ever applied locally and in CI (CI spins up its own throwaway Supabase), **never pushed to cloud** — the CLI isn't linked to the project. Until applied, the production API 500s on onboarding / missions / redemption / earnings routes.

**Apply strictly in numeric order** (0003 → 0004 → 0005 → 0006 → 0007). Either:
- **Supabase SQL editor** — paste each `supabase/migrations/000X_*.sql` in order and run; **or**
- **CLI** — `supabase link --project-ref mhkoayftiuojxlrkollf` then `supabase db push` (pushes all pending local migrations).

> ⚠️ Order matters: 0004 grants reference tables from 0003/0005, and 0007 redefines the `approve_submission` function from 0005. After applying, confirm via **Supabase → Database → Migrations** (or `supabase migration list`) showing 0001–0007.

**Slice 5 follow-on:** before any gift is redeemable in prod, load its code pool via `POST /api/admin/gifts/:id/codes` with the `x-admin-secret` header (item 4). Seed `stock_remaining` to equal the loaded code count.

> **✅ Done 2026-06-14** (applied via SQL editor). Verified on cloud: all five migrations' tables/columns/functions exist; grants correct (`authenticated` self-reads, `service_role` writes, `redeem_gift` executable, `approve_submission` service-only); RLS enabled everywhere; `redemption_codes` has RLS on + 0 policies → codes secret.
> **Two caveats from the SQL-editor route:**
> 1. The `supabase_migrations.schema_migrations` tracker still lists only 0001+0002 (the editor doesn't write tracker rows). If you ever `supabase link` + `supabase db push`, it'll try to re-apply 0003–0007 and fail on "already exists" — first reconcile by inserting tracker rows, or apply future migrations via the editor too.
> 2. Optional hardening: the cloud project's legacy `auto_expose_new_tables=true` auto-granted `authenticated` SELECT on `redemption_codes` (RLS still blocks all rows, so it's not a leak). To match intent: `revoke select on public.redemption_codes from authenticated;`.

## 1. 🔴 Supabase — Site URL + redirect allow-list
The entry redesign moved the auth callback to a single `/auth/callback` (was `/kocmax/$slug/auth/callback`). Until this matches, Google/magic-link login fails after the redirect.

**Supabase → Authentication → URL Configuration**
- **Site URL:** `https://adfocate-2.vercel.app`
- **Redirect URLs (allow-list):** add `https://adfocate-2.vercel.app/auth/callback`
  - (optional, to test on previews) also add `https://*-ynwaforevers-projects.vercel.app/auth/callback`

> This supersedes the older per-slug `/kocmax/*/auth/callback` entry from Slices 2–3 — one clean entry now.

## 2. 🔴 Google Cloud — OAuth client
**Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Web)**
- **Authorized redirect URI:** the Supabase callback, i.e. `https://mhkoayftiuojxlrkollf.supabase.co/auth/v1/callback`
- Copy the **Client ID + Secret** → **Supabase → Authentication → Providers → Google** (enable, paste both).
- App-side return URL is already `https://adfocate-2.vercel.app/auth/callback` (item 1).

## 3. 🔴 WhatsApp OTP (Twilio + Meta WABA → Supabase Phone)
Primary login is WhatsApp phone-OTP. Needs a real sender.
- **Meta:** a WhatsApp Business Account (WABA) + approved **Authentication** message template (zh-Hant), phone number registered.
- **Twilio:** Verify service (WhatsApp channel) or Programmable Messaging with the WABA sender; note Account SID, Auth Token, Message Service SID.
- **Supabase → Authentication → Providers → Phone:** enable, select **Twilio**, paste SID / Auth Token / Message Service SID.
- HK numbers are `+852…`; cost ≈ HKD 0.25/msg (from 2026-07-01) + Twilio Verify ≈ USD 0.05/verification.

> Until this is live, WhatsApp login won't send codes. Email-magic-link + Google (items 1–2) are the usable interim methods.

## 4. 🟢 Vercel — `ADMIN_SECRET`
**Vercel → Project `adfocate-2` → Settings → Environment Variables** → `ADMIN_SECRET` = a long random string (Production). Guards `/api/admin/submissions/*` (mission approve/reject). Send it as the `x-admin-secret` header when approving. Redeploy after adding. *(Reported done.)*

## 5. 🟢 Vercel — `SUPABASE_SERVICE_KEY`
Already set (the production API performs service-role writes — `/me/bootstrap`, awards). Listed for completeness. The other required envs: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the client `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## 6. 🟡 Branded OG image
Replace `public/og.png` (currently a plain 1200×630 placeholder) with the branded share card, then redeploy. Fixes the WhatsApp/social link preview image.

## 7. ⚪ Vercel preview Deployment Protection
Preview deployments sit behind Vercel SSO (a login wall), which blocks automated/headless testing of preview URLs. **Vercel → Project → Settings → Deployment Protection** → relax for Preview if you want shareable/testable preview links. Production is unaffected.

---

### Quick verification after items 1–3
1. Open `https://adfocate-2.vercel.app/` → branded landing.
2. WhatsApp OTP: enter a `+852` number → receive code → land in onboarding/home.
3. Google / email magic-link → returns to `/auth/callback` → signed in (no error).
