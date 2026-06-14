# Adfocate 2.0 — Deployment Config Runbook

The code is deployed; these are the **dashboard / env steps a human must do** (the agent can't). Do the 🔴 items before relying on the feature they gate.

**Constants**
- Production origin: `https://adfocate-2.vercel.app`
- Supabase project ref: `mhkoayftiuojxlrkollf`
- Vercel project: `adfocate-2`

| # | Item | Gates | Status |
|---|------|-------|--------|
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
