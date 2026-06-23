# Adfocate Content Hub (CMS Slice C1) — Design

**Date:** 2026-06-23
**Status:** Approved (design, revised after adversarial spec review); pending implementation plan
**Slice:** C1 — Content Hub (editorial CMS core)
**Repo:** `adfocate-2` (Vite + TanStack Router + Hono + Supabase)

> **Revision note (2026-06-23):** This spec was adversarially reviewed against the live
> codebase (10-agent workflow, 40 confirmed findings). Two decisions resulted:
> (1) **content is stored as markdown** and rendered with the repo's existing
> `react-markdown` + `rehype-sanitize` stack — not Editor.js block JSON; and
> (2) the **Academy migration is deferred to a follow-up slice (C1.5)** — C1 ships
> net-new articles + announcements only and does not touch `/guide` or the KB ingest.
> All other confirmed corrections (auth model, migration numbering, mounting, cron
> registration, pagination, view RPC, delete policy, CHECK constraints, storage) are folded in below.

---

## 1. Context & Motivation

Adfocate is a creator-rewards platform with a staff `/admin` surface that today manages
Missions, Applications, Engaged creators, Submissions, Creators, Workspaces, and staff
Google-SSO (B3a, PR #37 — **merged to main**). It has **no DB-backed editorial content system** — the only "content"
is the Academy (static markdown in `content/help/*.zh-HK.md` + TS data in `src/data/`), editable
only by shipping code.

The broader goal is a 50+友-style CMS spanning **content management, customer engagement, and
personalisation** for **both creators and brands**, decomposed into independently-shippable slices:

- **Content pillar:** **C1 — Content Hub** (this spec), C1.5 — Academy-to-DB migration, C2 — Brand resources
- **Engagement pillar:** N1 — Notifications & Announcements, G1 — Campaigns & Challenges, Q1 — Community/Q&A
- **Personalisation pillar:** P1 — Segments & Curation

C1 is the keystone: net-new authoring is the clearest gap (even the 50+友 reference lacks it —
there articles are bulk-imported by scripts), and the engagement/personalisation slices reference
the content + taxonomy that C1 establishes.

### Goal

Let admin staff author, organise, schedule, and publish **bilingual articles and announcements**
in markdown from `/admin`, surfaced to logged-in creators in a News feed and a Home strip.

### Non-goals (YAGNI for C1)

- **Academy migration (deferred to C1.5)** — see §12 for the entanglement that must be designed first.
- Brand/workspace-scoped content (C2), audience segments & targeting (P1), notifications/broadcasts (N1),
  campaigns (G1), community/Q&A (Q1).
- Revision history, multi-step approval workflow beyond draft→publish, advanced rich blocks
  (callouts/embeds as first-class), YouTube embeds, full-text/trigram search, image host-CDN proxying.

---

## 2. Architecture Overview

| Layer | Addition |
|---|---|
| DB | Migration `0021_content_hub.sql` (see §8 for numbering): `content_items`, `content_categories`, `content_tags`, `content_item_tags`; indexes; RLS; grants; `content-media` storage bucket; RPCs `content_increment_views`, `content_publish_scheduled` |
| Pure logic | `server/lib/contentAuthoring.ts` — input validation, slug helpers (`slugify`/`nextDuplicateSlug`), status-transition guard, cover/image URL validation. No I/O → fully unit-tested |
| Admin API | `server/routes/adminContent.ts` (`Hono<AdminEnv>`), **sub-mounted inside `adminRoutes`** so it inherits the staff-auth middleware (Supabase JWT → `staff_users` via `resolveStaff`; `x-admin-secret` break-glass); reads `c.get("staff")`; writes via `serviceClient()` |
| Creator read API | `server/routes/content.ts` (Hono), **mounted on the `guarded` group** (`workspaceAuth`); reads via `makeUserClient(jwt)` under RLS — mirrors `match.ts`/`missions.ts` |
| Cron | new `/api/cron/publish-scheduled` handler in `cron.ts` + a `vercel.json` crons entry; `Authorization: Bearer ${CRON_SECRET}` guard like `social-refresh` |
| Admin UI | `/admin/content` list + `/admin/content/:id` markdown editor; new "Content" tab in `AdminTabs` |
| Creator UI | `/news` feed + `/news/:slug` detail; Home announcement strip |
| Rendering | **Reuse `src/components/Markdown.tsx`** (`react-markdown` + `rehype-sanitize`) — no new renderer, no new sanitizer dependency, no `dangerouslySetInnerHTML` |

Conventions followed (verified against the codebase): pure-module + Hono-route split like
`missionAuthoring.ts`/`adminMissions.ts`; `serviceClient()` for admin writes; `makeUserClient(jwt)`
for creator reads behind RLS; typed `{error, code}` JSON; `.js` ESM extension on every new relative
server import (enforced by `check:esm`); `npm run type-check` (runs `tsr generate`) for new TanStack routes.

---

## 3. Data Model

### 3.1 `content_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | as in existing tables |
| `kind` | text NOT NULL | CHECK in (`article`,`announcement`) |
| `slug` | text NOT NULL UNIQUE | global namespace in C1 (see §3.4); `slugify()`+`nextDuplicateSlug()` |
| `status` | text NOT NULL default `draft` | CHECK in (`draft`,`scheduled`,`published`,`archived`) |
| `title_zh` | text NOT NULL | zh-HK primary |
| `title_en` | text NULL | optional |
| `excerpt_zh` | text NULL | dek / feed summary / meta description |
| `excerpt_en` | text NULL | |
| `body_zh` | text NOT NULL default `''` | **markdown (GFM)**, primary |
| `body_en` | text NULL | optional markdown; null → falls back to zh on render |
| `cover_image_url` | text NULL | validated https (see §4) |
| `category_id` | uuid NULL FK → `content_categories(id)` ON DELETE SET NULL | single category |
| `author_id` | uuid NULL | staff attribution from `c.get("staff").userId` (B3a merged); null when the break-glass secret is used |
| `workspace_id` | uuid NULL FK → `workspaces(id)` | **null = global creator content**; reserved for C2 |
| `pinned` | boolean NOT NULL default false | feed/home curation |
| `pinned_rank` | int NULL | lower = higher priority among pinned |
| `views` | int NOT NULL default 0 | denormalized, best-effort counter |
| `scheduled_for` | timestamptz NULL | publish-at when `status='scheduled'` |
| `published_at` | timestamptz NULL | set on publish |
| `archived_at` | timestamptz NULL | |
| `created_at` | timestamptz NOT NULL default now() | |
| `updated_at` | timestamptz NOT NULL default now() | via trigger; also the optimistic-concurrency token (§4) |

**CHECK constraints:** `status <> 'scheduled' OR scheduled_for IS NOT NULL`.

**Indexes:** `unique(slug)`; `(kind, status, published_at desc)`; `(category_id)`;
partial `(scheduled_for) where status='scheduled'`; partial `(pinned_rank) where pinned`.

### 3.2 Taxonomy

- `content_categories`: `id`, `slug` unique, `label_zh` NOT NULL, `label_en`, `sort int default 0`, `created_at`.
- `content_tags`: `id`, `slug` unique, `label_zh` NOT NULL, `label_en`, `created_at`.
- `content_item_tags`: `content_id` FK ON DELETE CASCADE, `tag_id` FK ON DELETE CASCADE, PK(`content_id`,`tag_id`).

### 3.3 Body format

Body is **GFM markdown** (`body_zh`/`body_en`), authored in a markdown editor and rendered by the
existing `Markdown.tsx` (`react-markdown` + `rehype-sanitize`). Images use markdown image syntax;
`rehype-sanitize` strips dangerous protocols/attributes at render. `remark-gfm` is added if
`Markdown.tsx` does not already enable it (verify during implementation). No raw HTML is honoured
(rehype-sanitize's default schema drops it).

### 3.4 Slug namespace

C1 uses a single global `unique(slug)` and a single detail route `GET /content/:slug` → one row.
**Note for C2:** when workspace-scoped content lands, migrate to `unique(workspace_id, slug)` (the
missions precedent, `0001:47`) and scope slug lookups accordingly.

---

## 4. Security Model

1. **Render safety** — all content renders through `Markdown.tsx` (`react-markdown` + `rehype-sanitize`),
   the repo's existing, XSS-tested path (`Markdown.test.tsx`). **No `dangerouslySetInnerHTML`** of stored
   content; **no new sanitizer dependency.** Markdown is admin-authored behind the secret gate and
   defense-checked again at render.
2. **Write validation** — `contentAuthoring.ts` validates lengths, required fields, status transitions,
   and that `cover_image_url` (and the editor's uploaded image URLs) are `https` under the `content-media`
   bucket origin (derived at runtime from `SUPABASE_URL`, exact hostname match — not `endsWith`) or an
   explicit env-configured allowlist; otherwise `validation_error`.
3. **RLS & grants (authenticated-only — there is no anon path in this stack).** All four new tables
   `enable row level security`. `content_items`: `for select to authenticated using (status='published'
   and workspace_id is null)`. Taxonomy tables: `for select to authenticated`. **All writes are
   service-role only.** Add `grant select` on the four tables `to authenticated` (mirrors `0016:101`);
   the creator read route uses `makeUserClient(jwt)` so RLS applies as the caller. Drafts/scheduled/archived
   and workspace-scoped rows are invisible to creators.
4. **Admin gate** — `adminContent.ts` is sub-mounted via `adminRoutes.route("/", adminContentRoutes)` so it
   inherits `admin.ts`'s staff-auth middleware: a Supabase JWT is resolved to a `staff_users` row via
   `resolveStaff()` (with `STAFF_EMAIL_ALLOWLIST` first-login auto-promotion), and `x-admin-secret` is kept as
   a one-release break-glass. The middleware sets `c.get("staff")` (`{userId, email, viaSecret?}`); the client
   `StaffAuthGate` (Google SSO) supplies the JWT and `adminFetch` attaches it. Writes use `serviceClient()`
   (the staff JWT authenticates the caller; the service client performs the privileged write). `author_id` is
   set from `c.get("staff").userId` (null under break-glass).
5. **Integrity & concurrency guards** — slug unique at DB; publish requires `title_zh` + non-empty `body_zh`;
   schedule requires `scheduled_for` strictly in the future; **slug is editable only while `draft`, frozen
   once published** (avoids `/news/:slug` 404s and broken shares); **optimistic concurrency** — `PATCH`
   sends the last-seen `updated_at`; a mismatch returns `409 conflict` (no silent last-write-wins).
6. **RPCs** — `content_increment_views(p_slug)` is `SECURITY DEFINER SET search_path=public`, increment-only,
   published-only; `revoke all from public, anon`, `grant execute to authenticated`. `content_publish_scheduled()`
   is service-role only (`revoke from public/anon/authenticated`, used by the cron via `serviceClient()`).

---

## 5. API Surface

### Admin (sub-mounted under the `/admin` secret gate; `serviceClient()`)

- `GET /admin/content` — list with filters `kind`, `status`, `category`, `tag`, `q` (title ILIKE), `page`.
- `GET /admin/content/:id` — full record incl. drafts and both locales.
- `POST /admin/content` — create (defaults to `draft`).
- `PATCH /admin/content/:id` — edit (requires last-seen `updated_at`; `409` on conflict; slug only while draft).
- `POST /admin/content/:id/publish` | `/schedule` (body `scheduled_for`) | `/unpublish` | `/archive`.
- `DELETE /admin/content/:id` — **only for `draft`/never-published rows**; published content must be `archive`d
  (avoids dangling `/news/:slug` links and cascade surprises).
- `GET/POST/PATCH/DELETE /admin/content/categories`, `/tags` — deleting a category that still has items is
  rejected with a clear error (FK is `SET NULL`, but we guard in-app).
- `POST /admin/content/media` — server-side image upload via `serviceClient().storage` into the public
  `content-media` bucket; returns `getPublicUrl`. (This is a **new** pattern — there is no signed-upload
  precedent in the repo; the avatar bucket relies on browser-side folder-ownership RLS, which the
  secret-gated admin route cannot use because it has no Supabase JWT.)

### Creator read (mounted on `guarded`; `makeUserClient(jwt)`; published+global only via RLS)

- `GET /content` — list: `kind`, `category`, `tag`, `page`; locale-aware shape.
- `GET /content/:slug` — detail; the handler fires `content_increment_views(slug)` **once, server-side**
  (not a client effect — dodges StrictMode/refetch double-count).

### Pagination contract (both surfaces)

Offset-based, `pageSize = 20`. Response `{ items, page, pageSize, total }`. Canonical sort:
`pinned_rank asc nulls last, published_at desc, id desc` (id breaks ties deterministically).

### Error contract

Typed `{ error, code }` JSON: `validation_error`, `not_found`, `conflict` (slug or stale `updated_at`),
`db_error`. Fail-soft on optional/late-migrated columns (the `42703` pattern). Creator reads degrade to an
empty list rather than 500.

### Related items (detail page)

Up to **4** published-global items sharing ≥1 tag with the current item (fallback: same `category_id`),
excluding self, ordered `published_at desc`, fetched through the same RLS-scoped read path (published-only).

---

## 6. Creator-Facing Surfaces

1. **News feed** — `_app.news.index.tsx` (`/news`, label 「資訊」/Updates): paginated published
   **articles + announcements**, category filter, pinned-first. Card list in the `lg:max-w-5xl` grid style.
2. **Detail** — `_app.news.$slug.tsx`: renders `body` via `Markdown.tsx`, shows related items, increments
   views server-side, bilingual with zh fallback.
3. **Home** — pinned-announcement strip + a few latest cards on `_app.home` (reuses `pinned`/`pinned_rank`).

**UX states & i18n:** define empty-feed copy, loading skeletons, and read-failure copy. All new strings go
in `i18n.dict.ts` under `app.news.*` and `app.admin.content.*` in **both** the `en` and `zh-HK` blocks
(including the new `app.admin.tabContent` tab label). The markdown editor targets sighted staff
(full a11y of a rich editor is out of C1 scope; the markdown textarea + preview is keyboard-usable).

**Not touched in C1:** `/guide`, the Academy data (`src/data/academy.ts`, `guideDocs.ts`), `eligibility()`
gating, `guideProgress.ts`, and `scripts/ingest-kb.ts`. See §12.

---

## 7. Media / Storage

New public `content-media` Supabase Storage bucket. Admin image uploads go **through the server**
(`POST /admin/content/media`) using `serviceClient().storage` (service role bypasses storage RLS), which
returns a `getPublicUrl`. `cover_image_url` and inline markdown image URLs are validated to the bucket
origin / https allowlist (§4.2). Logged-out users never reach these surfaces, so public-read of the bucket
is acceptable; the bucket holds only editorial imagery.

---

## 8. Rollout (codebase lessons baked in)

- **Migration numbering:** staff-auth (PR #37) is **merged to main** and `0020_staff_auth.sql` is on disk, so
  this slice is **`0021_content_hub.sql`** (the next free sequential number; verify before applying).
- **Tracker drift:** apply to prod via **Supabase MCP raw SQL / `execute_sql`** (the tracker sits at `0017`;
  `0018`/`0019` were applied via raw SQL, **not** `apply_migration` — re-applying via `apply_migration` would
  conflict). Apply **before deploy**, then `notify pgrst, 'reload schema'` (the deploy-before-migrate 500 lesson).
- **Cron:** add a `vercel.json` `crons` entry, e.g. `{ "path": "/api/cron/publish-scheduled", "schedule": "*/10 * * * *" }`
  (without it the publish step never fires in prod; the only existing cron is weekly). Guard with
  `Authorization: Bearer ${CRON_SECRET}` exactly like `social-refresh`; call `content_publish_scheduled()` via `serviceClient()`.
- **ESM:** `.js` extension on every new relative server import (`check:esm` guards CI).
- **Type-check:** run `npm run type-check` after adding `/news` + `/admin/content` routes.
- **Deps:** no new sanitizer. Add `remark-gfm` only if `Markdown.tsx` lacks it.

---

## 9. Testing Strategy

- **Unit (Vitest):** `contentAuthoring.ts` — input/length validation, status transitions (illegal ones
  rejected), slug + `nextDuplicateSlug`, cover/image URL validation (rejects non-https, wrong host,
  `javascript:`), schedule-needs-future, slug-frozen-after-publish. Extend `Markdown.test.tsx` to assert a
  malicious markdown payload (`[x](javascript:...)`, raw `<script>`, `<img onerror>`) renders inert.
- **Integration (`server/test`, `--no-file-parallelism`, needs `.env.test.local`):** admin CRUD; lifecycle
  (draft→schedule→publish→archive→unpublish; illegal transitions rejected); optimistic-concurrency `409`;
  delete-only-when-draft; **RLS visibility** (a creator `makeUserClient` sees only published-global; draft/
  scheduled/archived/workspace-scoped hidden); `content_publish_scheduled` flips overdue scheduled rows;
  `content_increment_views` increments once and is published-only; pagination shape + sort order; category
  delete-guard.
- **Frontend route tests:** news list + detail render markdown; Home announcement strip; empty/loading states.

---

## 10. Component Boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `contentAuthoring.ts` | validate input, slug, transitions, URL checks (pure) | — |
| `adminContent.ts` | admin CRUD / lifecycle / media endpoints (secret-gated) | `contentAuthoring`, `serviceClient` |
| `content.ts` (creator read) | published list/detail, view increment | `makeUserClient`, RLS |
| `cron.ts` (extended) | publish scheduled items | `serviceClient`, `CRON_SECRET` |
| `Markdown.tsx` (reused) | safe markdown rendering | `react-markdown`, `rehype-sanitize` |
| `/admin/content` routes | list + markdown editor UI + "Content" tab | admin API |
| `/news` routes | feed + detail | creator read API, `Markdown.tsx` |
| migration `0021` | schema, RLS, grants, bucket, RPCs | — |

Each unit is independently testable; the pure module holds all logic so routes stay thin.

---

## 11. Build Order (for the implementation plan)

1. Migration `0021` (schema, CHECKs, indexes, RLS `to authenticated`, grants, `content-media` bucket, two RPCs).
2. `contentAuthoring.ts` + unit tests (TDD).
3. `adminContent.ts` admin API + media upload + integration tests; sub-mount under `adminRoutes`.
4. `content.ts` creator read API + RLS/pagination integration tests; mount on `guarded`.
5. `cron.ts` `publish-scheduled` handler + `vercel.json` entry + test.
6. `/admin/content` list + markdown editor UI + "Content" tab + i18n keys.
7. `/news` feed + detail (reusing `Markdown.tsx`) + Home announcement strip + UX states + i18n keys.
8. Type-check, lint, build, full test suite; apply migration to prod (raw SQL via MCP) + `reload schema`; deploy.

---

## 12. Deferred — C1.5 Academy-to-DB migration (design constraints captured)

The review showed the Academy is **three** systems, not one markdown corpus — migrating it safely is its
own slice. When C1.5 is designed, account for:

- **`/guide` renders three datasets:** 8 markdown docs (`guideDocs.ts`), playbooks + resources, and
  level-gated track cards (`academyTracks` in `academy.ts`). Only the 8 docs are markdown bodies.
- **Doc titles live in `i18n.dict.ts`** (`app.guide.doc.*`, both locales) keyed by `titleKey` — **not** in
  the `.md` frontmatter (which is zh-only). A migration must pull both-locale titles from i18n.
- **Slugs must equal existing `guideDocs` ids** (`account`/`leveling`/`missions`/`points`/`profile`/
  `redemption`/`submission`/`wallet`) to preserve `guideProgress.ts` localStorage read-state.
- **Gating is `eligibility()` in `src/lib/missionMeta.ts`** (consumed by `AcademyTrackCard.tsx` and
  `_app.guide.track.$trackId.tsx`) keyed off `AcademyTrack.requiredLevel` — there is **no** `academyGating.ts`.
  Track metadata (`requiredLevel`, `level`, `duration`, `emoji`, `description`) has no home in `content_items`.
- **Doc grouping is `guideDocs.category`** (`start`/`missions`/`rewards`/`account` via `CATEGORY_ORDER`),
  not tracks — `content_items` has no column for it; needs a category mapping + within-group ordering.
- **`scripts/ingest-kb.ts` reads `content/help/*.md` directly** to build the AI Assistant KB
  (`kb_documents`/`kb_chunks`). Removing the static loaders would silently break `npm run ingest:kb`; C1.5
  must either keep the `.md` files canonical or rewire ingest to read `content_items`.
- **`markdownToBlocks` is unnecessary** under the markdown-storage decision — docs migrate body-as-markdown,
  but frontmatter must be stripped before storage (today it's rendered raw via `?raw`).

Other deferred enhancements: callouts/YouTube embeds as first-class (with sandbox + 11-char id validation),
full-text/trigram title search, revision history, image CDN/host proxying.
