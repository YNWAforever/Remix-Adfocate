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
| 1 | Supabase Site URL + redirect allow-list → `/auth/callback` **and** `/auth/reset-password` | Google + email-magic-link login + password reset | 🔴 pending |
| 2 | Google OAuth client + Supabase provider, then `VITE_ENABLE_GOOGLE` | "Sign in with Google" (creator login + `/admin` staff sign-in) | 🔴 pending |
| 3 | Twilio + Meta WABA → Supabase Phone provider | WhatsApp OTP (primary login) | 🔴 pending |
| 4 | `ADMIN_SECRET` env in Vercel | operator approve/reject endpoints | 🟢 set (per user) |
| 5 | `SUPABASE_SERVICE_KEY` env in Vercel | all backend writes | 🟢 set (prod API works) |
| 6 | Replace `public/og.png` placeholder | branded WhatsApp/social preview | 🟡 nice-to-have |
| 7 | Disable Vercel **preview** Deployment Protection | headless preview testing | ⚪ optional |
| 8 | Production SMTP sender on the Supabase project | *delivery* of magic-link + password-reset emails | 🔴 pending |
| 9 | — nothing to configure — | email + password sign-in / sign-up | 🟢 works on the current Auth config |

### Login-method flags (staged rollout)
The login page only shows a method once its provider is live, via Vercel env flags (default **off**; both are also listed in `.env.example`). **Email+password and the email magic-link are always shown** — neither has a flag. As you finish items 2/3, flip the matching flag and redeploy:
- `VITE_ENABLE_GOOGLE = "true"` → shows "用 Google 登入" (needs item 2)
- `VITE_ENABLE_WHATSAPP = "true"` → makes WhatsApp the primary method + landing CTA (needs item 3)

So **stage 0 = nothing configured → email+password sign-in and sign-up already work** (item 9), and **stage 1 = item 1 (+ item 8 for delivery) → the magic link and password reset work too** — no broken buttons at either stage. Set the flags in **Vercel → Settings → Environment Variables** (Production), then redeploy: `VITE_*` values are inlined at build time, so changing one without a rebuild changes nothing.

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
  - also add `https://adfocate-2.vercel.app/auth/reset-password` — where the password-reset email lands. Supabase refuses any `redirectTo` that isn't on this list, so the reset mail would otherwise bounce the user back to the Site URL with an error instead of the new-password form.
  - (optional, to test on previews) also add `https://*-ynwaforevers-projects.vercel.app/auth/callback`

> This supersedes the older per-slug `/kocmax/*/auth/callback` entry from Slices 2–3 — one clean entry now.
> The staff console signs in to the same path with a query string (`/auth/callback?next=/admin`); if that particular redirect is ever rejected, add it to the list verbatim.

## 2. 🔴 Google Cloud — OAuth client
Five steps: two in Google Cloud, one in Supabase, one already done in code, one in Vercel. **The creator-facing button stays hidden until the last one** — see the note below before concluding it is broken.

1. **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Web)** — create (or edit) the web client.
2. **Authorized redirect URI:** the *Supabase* callback, i.e. `https://mhkoayftiuojxlrkollf.supabase.co/auth/v1/callback`. Google never redirects to the app directly; Supabase receives the code and then sends the browser on to the app.
3. Copy the **Client ID + Secret** → **Supabase → Authentication → Providers → Google** (enable, paste both, save).
4. App-side return URL is already `https://adfocate-2.vercel.app/auth/callback` (the `redirectTo` passed to `signInWithOAuth` in `src/routes/_app.login.tsx`), and it must be on item 1's allow-list.
5. **Vercel → Settings → Environment Variables** (Production) → `VITE_ENABLE_GOOGLE = "true"`, then **redeploy**.

> **No button ≠ broken.** Until step 5, `GOOGLE_LOGIN` is `false` (`src/lib/features.ts`) and the login page simply does not render the Google button at all. Nothing on the creator page reports an error, because nothing is shown.
> **Exception:** the `/admin` staff sign-in (`src/components/admin/StaffAuthGate.tsx`) uses the same Google provider but is **not** flag-gated — it is always visible, so it stays genuinely broken until steps 1–3 are done.

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

## 8. 🔴 Supabase — production email sender (SMTP)
Every emailed link goes through the project's email sender: the **magic link** and the **password-reset link** both. Supabase's built-in sender is a development convenience with a low hourly cap (the local config here caps sends at `[auth.rate_limit] email_sent = 2`/hour), so mail is slow, throttled or silently undelivered until a real sender is attached.

- Attach a production SMTP sender (SendGrid / Resend / SES — the commented `[auth.email.smtp]` block in `supabase/config.toml` uses SendGrid) in the cloud project's **Supabase → Authentication** email/SMTP settings.
- Use a From address on a domain you control, otherwise the mail lands in spam.

> **Blast radius:** password **sign-in and sign-up never send email** (item 9), so they are unaffected by this item. Password **reset** and the **magic link** are unreliable until it is done — treat "reset link never arrived" as this item, not as a bug in the reset flow.

## 9. 🟢 Email + password — nothing to configure
The newest login method needs **no external provider and no feature flag**. It already works on the Auth config in `supabase/config.toml`:
- `[auth] enable_signup = true` → `signUp()` is permitted.
- `[auth.email] enable_confirmations = false` → **sign-up returns a session immediately**. There is deliberately no "check your email to confirm" step; a new account lands straight in onboarding.
- `[auth] minimum_password_length = 6` is *looser* than the 8-character minimum the app asks for, so there is nothing to relax in the dashboard — the stricter rule is the app's own.
- `[auth.email] otp_expiry = 3600` → an emailed reset link is good for one hour.

Its only external dependencies are on the **reset** path: item 1 (the `/auth/reset-password` redirect must be allow-listed) and item 8 (the mail has to actually be delivered).

> `supabase/config.toml` drives local + CI only; nothing here pushes it to cloud. If password sign-up ever fails in production with a confirmation prompt, check **enable signup** and **confirm email** in the cloud project's Auth settings — they may have drifted from this file.

---

### Quick verification after items 1–3 / 8
1. Open `https://adfocate-2.vercel.app/` → branded landing.
2. WhatsApp OTP: enter a `+852` number → receive code → land in onboarding/home.
3. Google / email magic-link → returns to `/auth/callback` → signed in (no error).
4. **Password sign-up** (needs nothing configured): new email + an 8-character password → account created → straight into onboarding, **no confirmation email**.
5. **Password sign-in:** sign out, sign back in with the same pair → lands in home/onboarding.
6. **Wrong password:** the form reports that the email and password did not match, and no session is created.
7. **Password reset** (needs items 1 + 8): "forgot your password" → mail arrives → its link opens `/auth/reset-password` (not an error page — that would mean the allow-list entry is missing) → set a new password → signed in, and the old password no longer works.
