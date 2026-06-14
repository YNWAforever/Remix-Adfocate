# Adfocate 2.0 — Slugless Brand-at-Root Entry & Information Architecture (Design)

> **Status:** design approved (2026-06-14), spec written. Next: `writing-plans`.
> **Branch:** `feat/slugless-entry-ia` (off `main` @ merged Slice 4).
> **Motivation:** the entry URLs confuse visitors. This redesign fixes how people arrive at the app.

## 1. Problem

Today the app has no usable front door:

1. **The bare root `/` renders a 404** ("404 — 找不到頁面"). `src/routes/__root.tsx` is just `<Outlet/>` + a 404 fallback; there is no root index route and no redirect.
2. **The only working entry is `/kocmax/demo`**, where `demo` is a hardcoded placeholder default (`src/lib/api.ts`) backed by seed data named "Demo Brand." It reads like a throwaway dev URL.
3. **Blank link previews.** It is a pure client-rendered SPA; every path serves the same empty `index.html` shell (`<div id="root">`) with title "KOCmax" and **no `<meta description>` / OG tags**. Because the product is distributed by **WhatsApp links and QR codes**, every share unfurls as a featureless "KOCmax" with no description or image — a primary source of "where do I go / what is this?" confusion.

The app is built genuinely multi-workspace (`/kocmax/$slug`, 12 child routes) but there is no workspace discovery; a visitor must already know the slug.

## 2. Goal

Give the **launch brand** a clean, shareable front door served at the **apex with no visible slug**, while keeping the multi-workspace plumbing for future brands. Concretely: a branded landing at `/`, the app served at root-level paths, real link-preview metadata, and a proper 404.

## 3. Decisions (resolved in brainstorming)

1. **Tenancy reality:** one real brand soon (a specific launch client); multi-brand is later.
2. **Apex behavior:** a **branded landing page** at `/` (not a bare redirect, not login-as-root).
3. **URL shape:** **slugless at root** — serve the launch brand at the apex on the current Vercel host; a custom domain can drop in front later with no code change. Keep the multi-workspace plumbing underneath.
4. **Collapse now:** *remove the visible `/kocmax/$slug` URL tree now* rather than maintaining two parallel URL trees for a brand that does not exist yet. The resolver + `X-Workspace-Slug` header + multi-workspace DB/API all stay. When brand #2 lands, a tenant URL scheme (path or subdomain) is re-added then — the launch brand keeps the apex (Shopify "primary domain" model).

## 4. Architecture

### 4.1 Workspace resolution (the abstraction)
Introduce a single resolver so callers never depend on *how* the workspace is determined:

```
resolveWorkspace(): string   // returns the active workspace slug
```

For now it returns a configured `DEFAULT_WORKSPACE` (a constant / `VITE_DEFAULT_WORKSPACE` env, default `"demo"`). The slug is **never shown in the URL**, so the internal value is cosmetic; renaming the DB workspace is optional and out of scope here. Later, `resolveWorkspace` can additionally read a custom-domain→workspace map or a path/subdomain for multi-tenant — **callers (the `X-Workspace-Slug` header in `src/lib/api.ts`) do not change.**

`src/lib/api.ts` keeps `setWorkspaceSlug`/`getWorkspaceSlug`; the root layout calls `setWorkspaceSlug(resolveWorkspace())` instead of `setWorkspaceSlug(params.slug)`.

### 4.2 Route tree — re-rooted
The existing screens move from `/kocmax/$slug/*` to root-level paths. Final tree:

```
/                       → branded landing (NEW)
/login                  → WhatsApp + email + Google auth
/auth/callback          → PKCE / magic-link exchange
/onboarding             → onboarding wizard
/missions               → mission list
/missions/$missionSlug  → mission detail (join / submit)
/my                     → My Missions
/wallet                 → points history
/redemption             → redemption shop
/explore                → FAQ / how-to
/privacy   /tnc         → policy pages
```

A **root app layout** (replacing `kocmax.$slug.tsx`) holds the theme, the auth gate, and the onboarding gate, resolving the workspace via `resolveWorkspace()` instead of a path param. The auth gate's path checks change from `/kocmax/$slug/login` etc. to `/login`, `/auth/callback`, `/onboarding`.

The `/kocmax/$slug/*` URL tree is removed in this slice (collapse). Multi-tenant support is re-added when a real second brand exists.

### 4.3 Apex landing (`/`)
A lightweight, on-brand (Acid Y2K theme tokens) hero in zh-Hant-HK:
- brand name + one-line value proposition (e.g. 「加入 KOCmax · 完成任務賺積分換獎賞」),
- a primary CTA **「用 WhatsApp 加入」** → `/login`,
- a secondary link to browse missions / learn more.

**Signed-in returning creators who hit `/` are redirected into their app home** (so the landing is only for cold/anonymous visitors). Reuses existing theme/components; no new design system.

### 4.4 Link-preview metadata (the blank-WhatsApp fix)
Add static metadata to `index.html` (single brand → static is sufficient, no SSR):
- `<meta name="description">`,
- Open Graph: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`,
- `twitter:card` = `summary_large_image`,
- `<html lang="zh-Hant-HK">`.

Requires an **OG image asset** (branded 1200×630 card) committed under `public/`. *(User provides or approves the image.)*

### 4.5 Unknown paths / 404
Keep a real 404 (HTTP-appropriate) for genuinely unknown routes, upgraded to a branded page with a "回首頁" link. **Never** fall back to rendering the brand for an unknown path.

## 5. Auth-redirect implications (user-gated, simplified)
The OAuth/magic-link callback moves from `/kocmax/$slug/auth/callback` to a single **`/auth/callback`**. This *replaces and simplifies* the still-pending Supabase redirect-allowlist configuration:
- Supabase Auth → **Site URL** = the apex origin,
- **Redirect allow-list** = `<origin>/auth/callback` (one entry, no per-slug wildcard),
- Google OAuth client redirect updated to match.

`src/lib/auth-flow.ts` `finishAuth(slug, navigate)` is updated so post-auth navigation targets root paths (`/onboarding` or `/`), with the slug sourced from `resolveWorkspace()`.

## 6. Out of scope (deferred)
- **Custom domain** (`members.<brand>.com`): an additive, infra-only step later — the resolver already makes it a drop-in. Not built here.
- **Multi-tenant tenant URLs** (`/kocmax/$slug` or subdomains): re-added when brand #2 lands.
- **Per-route SSR/dynamic OG**: unnecessary for one brand; static OG covers it.
- **Workspace picker / discovery**: not needed for a single brand.
- **Renaming the `demo` DB workspace**: optional cosmetic; the slug is no longer user-visible.

## 7. Risks & mitigations
- **Broken inbound links** to old `/kocmax/demo/*` URLs (existing WhatsApp/QR shares): add Vercel/router redirects from `/kocmax/demo` and `/kocmax/demo/*` → the equivalent root paths so live links keep working.
- **Auth allow-list mismatch** during cutover: the `/auth/callback` change requires the Supabase + Google dashboard updates (§5) to land with the deploy, or login breaks. Flag as a release-gated step.
- **Internal `<Link>` churn:** every `to="/kocmax/$slug/..."` reference must be updated to the root path; missed ones break navigation. Caught by type-check (TanStack typed routes) + a full nav smoke test.
- **OG image missing:** ship a placeholder if the branded asset is not ready, so previews are at least non-blank.

## 8. Success criteria
- Visiting the apex shows a branded landing (not a 404); a returning signed-in creator is taken into the app.
- The whole app works at clean root paths with no slug visible; old `/kocmax/demo/*` links redirect in.
- A WhatsApp share of the apex (and any deep link) unfurls with a real title, description, and image.
- `type-check`, `lint`, `build`, and the existing test suites stay green; the auth gate + onboarding gate behave at the new paths.
