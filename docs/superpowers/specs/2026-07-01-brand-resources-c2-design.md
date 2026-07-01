# Brand Resources (C2) — Design

**Date:** 2026-07-01
**Slice:** C2 (Content pillar, from the SaaS-CMS roadmap `C1 → N1 → P1 → G1 → C2 → Q1`)
**Depends on:** C1 Content Hub (migration `0021_content_hub.sql`), Brand Portal Slice 1 (`requireBrand()`, `brand_users`)
**Migration:** `0027_brand_resources.sql`

## 1. Summary

Brands currently get no in-app help content — the brand portal has only Overview and
Missions. Creators, by contrast, have `/news` (C1 Content Hub) and the Academy (`/guide`).
C2 gives brands an equivalent: a read-only **guide/help hub** at `/brand/resources`
(mission-writing tips, budget/wallet explainer, payout FAQ, platform best-practices),
authored by staff through the **existing** `/admin` Content tab — no new authoring UI.

This is a precedent, not a follow-on: no brand-facing content exists today.

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| Content model | Extend `content_items` with a new `audience` column (`'creator'` \| `'brand'`), NOT a new table and NOT overloading `kind` |
| Authoring | Reuse the existing staff `/admin` Content tab — no new authoring UI |
| Organization | **Flat list, no categories** for v1 (brand topics don't fit the creator categories `platform-news`/`creator-tips`; adding brand-specific categories to the shared table is deferred until there's a concrete need) |
| Targeting | **Global** — every brand workspace sees the same guides (no per-workspace targeted resources; that's a different, not-yet-scoped idea) |
| RLS | **No change** — the existing `content_items_read_published` policy (`to authenticated using (status='published' and workspace_id is null)`) already covers brand users, who are Supabase Auth users like anyone else. Audience gating happens at the route/query level, mirroring how `kind` is already handled today |

### Out of scope (deferred)

Brand-specific categories/topics, per-workspace targeted resources, related-articles
(no tags/categories on brand content yet), search, "mark as read," push/email digest of
new guides, Academy-style level-gated tracks for brands.

## 3. The gap this design must close

`server/routes/content.ts` (creator `/news` feed) currently has **no audience filter** —
it lists any `published` + `workspace_id IS NULL` row, filtered by `kind` only if the
caller passes `?kind=`. Without an explicit fix, the moment a brand-audience row exists
it would leak straight into the creator news feed by default. This design modifies that
existing route (not just adds a new one) to close the gap.

## 4. Migration `0027_brand_resources.sql` (additive)

```sql
alter table public.content_items
  add column audience text not null default 'creator' check (audience in ('creator','brand'));

create index content_items_audience_status_pub_idx
  on public.content_items (audience, status, published_at desc);
```

No RLS policy changes. No changes to `content_categories`/`content_tags` (brand guides
ship with `category_id = null`). No new RPC — `content_increment_views(p_slug)` already
matches on `slug + status + workspace_id is null` and works unchanged for brand rows.

## 5. Server

### 5.1 Admin authoring (modified)

- `server/lib/contentAuthoring.ts`: extend `validateContentInput`/`validateContentEdit`
  to accept an optional `audience: 'creator' | 'brand'` field, defaulting to `'creator'`
  when omitted (fully backward-compatible with existing admin tests/callers).
- `server/routes/adminContent.ts`: add `audience` to the editable-fields allowlist and
  to the select/return column list, so staff can set and see it. No lifecycle change
  (draft/scheduled/published/archived flow is untouched).

### 5.2 Creator route (modified — closes the leak)

`server/routes/content.ts`: add a hard `.eq("audience", "creator")` to both the list
query (`GET /`) and the detail query (`GET /:slug`), independent of any `kind`/`category`
query params. This is a behavior change for existing rows too, but since the migration
defaults every existing row to `'creator'`, there is no regression for current content.

### 5.3 New brand-facing route

New `server/routes/brandResources.ts`, closely mirroring `content.ts`:

- `GET /resources` — list, hard `.eq("audience", "brand")`, `status='published'`,
  ordered `pinned_rank` then `published_at desc`, same pagination shape as `/news`
  (`page`, `pageSize=20`) for consistency even though brand-guide volume will be small.
- `GET /resources/:slug` — detail, hard `.eq("audience","brand")`, calls
  `content_increment_views` (unchanged RPC). **No "related" section** in v1 (no
  tags/categories on brand content) — return `{ item }` only, no `related: []` filler.
- Uses `makeUserClient(bearer(c))`, same as other brand routes.

Mounted inside `server/routes/brand.ts` under the existing `requireBrand()` guard —
this only gates "is this a valid brand user," not workspace, since the content is
global (`workspace_id is null`, same convention C1 already established).

## 6. Client & UI

- `src/lib/brand.ts`: add `brandKeys.resources(page?)` / `brandKeys.resource(slug)`,
  `fetchBrandResources(page?)`, `fetchBrandResource(slug)` via the existing `brandFetch`
  helper (bearer JWT injection, `BrandAuthError`/`AdminRequestError` handling — unchanged).
- `src/routes/brand.resources.index.tsx` — list page, mirrors `_app.news.index.tsx`
  (card grid, pinned-first ordering, empty state).
- `src/routes/brand.resources.$slug.tsx` — detail page, mirrors `_app.news.$slug.tsx`
  (cover image, `<Markdown>` body render, no related-articles block).
- `src/components/brand/BrandNav.tsx`: add a third nav item "Resources" (icon: `BookOpen`)
  → `/brand/resources`, after Overview/Missions.
- i18n (`src/lib/i18n.dict.ts`): `app.brand.resources.{title,empty,loading,error}` in
  en + zh-HK, following the existing `app.brand.*` key-naming convention.

## 7. Invariants & testing

**Invariants**
- A `creator`-audience row is never returned by `/api/brand/resources` (list or detail).
- A `brand`-audience row is never returned by `/api/content` (creator `/news`, list or
  detail), regardless of `kind`/`category` query params.
- Existing content behavior for all pre-migration rows is unchanged (default `audience='creator'`).
- Admin authoring lifecycle (draft/scheduled/published/archived, media upload) is
  untouched for both audiences.

**Unit**
- `contentAuthoring.test.ts`: `audience` accepts `'creator'`/`'brand'`, defaults to
  `'creator'` when omitted, rejects any other value.
- `content.test.ts` (creator route, regression): a seeded `audience='brand'` row is
  absent from list output and 404s (or is simply absent) on direct slug fetch.

**Integration** (local Supabase stack; add to the explicit `test:integration` list)
- `brandResources.test.ts`: brand user lists/reads `audience='brand'` published items;
  a `creator`-audience item seeded alongside is invisible via `/brand/resources`;
  unauthenticated/non-brand caller → 401/403 (mirrors existing brand route tests);
  view-count increments on detail fetch.

**Route-stub**
- `-brand.resources.index.test.tsx` / `-brand.resources.$slug.test.tsx` — mirror the
  existing brand route-stub pattern (mock `@/lib/brand`, no router-nav assumptions).

**House rules**
- `.js` extensions on relative imports in new `server/**` files (`npm run check:esm`).
- `npm run type-check` after adding routes (TanStack route-tree codegen).
- New integration test file added to the explicit `test:integration` list in `package.json`.

## 8. File manifest

**New (server):** `supabase/migrations/0027_brand_resources.sql`,
`server/routes/brandResources.ts`, `server/test/brandResources.test.ts`.
**Modified (server):** `server/lib/contentAuthoring.ts` (+ test), `server/routes/adminContent.ts`,
`server/routes/content.ts` (+ test), `server/routes/brand.ts` (mount).
**New (client):** `src/routes/brand.resources.index.tsx`, `src/routes/brand.resources.$slug.tsx`
(+ route-stub tests).
**Modified (client):** `src/lib/brand.ts` (+ test), `src/components/brand/BrandNav.tsx`,
`src/lib/i18n.dict.ts`.

## 9. Sequencing, deployment & dependencies

- Independent of any other in-flight work — no shared files with the last few merged
  slices (G1 Campaigns, Brand Portal 1-4) beyond `content_items`, which none of them touch.
- **Prod apply (after merge):** apply `0027` to `mhkoayftiuojxlrkollf` via raw SQL /
  Supabase MCP `execute_sql` (tracker drift precedent — a `db push` would conflict),
  then `notify pgrst, 'reload schema'`. No new env vars, no new cron entry.
- **Never** `vercel --prod` from local (mis-bundles the API) — deploy via Git.
