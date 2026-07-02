# C1.5 — Academy → DB Migration (design spec)

**Date:** 2026-07-02
**Slice:** C1.5 (Content pillar) — the deferred Academy-to-DB migration from the CMS/SaaS roadmap
in [[adfocate-cms-content-hub-c1-status]] (`C1 → N1 → P1 → G1 → C2 → Q1`, with C1.5 as the
"Academy migration" that C1 explicitly left untouched).
**Depends on:** C1 Content Hub (`0021`), the AI-assistant KB (`0016`), staff auth (`0020`),
content `audience` column (`0027`).
**Migration:** `0028_academy_content.sql` (next free number; `0027` is the latest).

---

## 1. Goal & intent

Move **all four** Academy systems out of hardcoded source and into one new DB table
`academy_content`, so that **the DB is the single source of truth** for the authenticated
`/guide` creator surface and the AI-assistant knowledge base. Staff author/edit everything in
`/admin` with no code deploy; `/guide` reads from the DB; the AI-KB re-ingests from the DB.

The four systems and their current homes:

| System | Count | Current source | Consumers today |
|--------|-------|----------------|-----------------|
| Guide docs (help articles) | 8 | `content/help/*.zh-HK.md` (markdown + frontmatter) imported via `src/data/guideDocs.ts` (`?raw`) | `/guide` doc pages **and** the AI-KB (`scripts/ingest-kb.ts`) |
| Academy tracks | 9 (`a1`–`a9`) | `src/data/academy.ts` (`academyTracks`) | `/guide` track cards + detail (level-gated) |
| Playbooks | 6 | `src/data/academy.ts` (`playbooks`) | `/guide` index + public `_site` marketing pages |
| Resources | 8 (`r1`–`r8`) | `src/data/academy.ts` (`resources`) | `/guide` index + public `_site` marketing pages |

zh-HK is primary. English (`title_en`/`excerpt_en`/track teaser `_en`) is **preserved** at
migration where it already exists in the i18n dictionary (see §3). Only long-form `body_en`
(the markdown help bodies, which are zh-only today) is legitimately left null.

---

## 2. Deviations from the approved sketch (discovered during grounding)

The approved verbal design was sound in direction (dedicated table, DB-as-truth) but grounding
against the real code surfaced six corrections that are folded into this spec:

1. **English is NOT deferred for short labels.** The approved sketch said "`title_en` null for
   now." But the English strings already exist in `src/lib/i18n.dict.ts` (`app.guide.doc.*`,
   `app.guide.teaser.a1–a9`). Seeding `title_en`/`excerpt_en`/teaser `_en` from those existing
   values costs nothing and avoids a **live bilingual regression** for `lang='en'` creators.
   Only `body_en` (long markdown) stays null. The migrated i18n keys are removed in the same PR
   to avoid two sources of truth.
2. **Cleanup is scoped, not a blanket delete.** `src/data/academy.ts` is re-exported through
   `src/data/mockData.ts` (lines 421–446) and consumed by **public, unauthenticated marketing
   pages** — `_site.creators.tsx` (`academyTracks.slice(0,4)`, `resources.slice(0,4)`) and
   `_site.playbooks.tsx` (`playbooks`). Those pages cannot call the authenticated creator API.
   A blanket delete hard-fails `tsc --noEmit`. So marketing keeps a **static** showcase (§7);
   only the authenticated `/guide` surface + the KB become DB-sourced.
3. **KB prune on unpublish/archive** is a new required behavior (§6). Today the md file set is
   fixed; once staff can archive a guide doc, its `kb_documents`/`kb_chunks` rows would persist
   and leak into AI answers unless the ingest reconciles deletions.
4. **`metadata` jsonb keeps bilingual `{en,zh}` objects** (§4) — playbook `levels`/`creatorAngle`,
   resource `type`, track `duration` — because the UI renders them via `localized()`. Flattening
   to scalars would drop English.
5. **Track has two distinct level fields**: `required_level` (the gate, e.g. `L2`) and a display
   label `levelLabel` (e.g. `L2+`, `L0–L1`) that the card/detail render verbatim. The display
   label is not derivable from the gate and lives in `metadata`. Track `description` maps to
   `excerpt_zh/en` so the unlocked detail page is non-empty.
6. **`body_zh` is seeded frontmatter-stripped** (§4/§5) — this also fixes a latent bug where the
   current `/guide` doc page renders the raw `---` frontmatter block as a stray `<hr>`.

---

## 3. Title / label sourcing (resolves the i18n-vs-frontmatter ambiguity)

Two title sources disagree for guide docs, so we pin them explicitly:

- **Guide-doc `title_zh`/`title_en`** ← the **i18n dictionary** values (`app.guide.doc.<slug>`),
  because that is exactly what the `/guide` UI renders today (`t(doc.titleKey)`). Verbatim:

  | slug | `title_zh` | `title_en` | category |
  |------|-----------|-----------|----------|
  | `account` | 帳戶 | Account | account |
  | `leveling` | 等級制度 | Levels | start |
  | `missions` | 任務 | Missions | missions |
  | `submission` | 提交內容 | Submitting Content | missions |
  | `points` | 積分 | Points | rewards |
  | `redemption` | 兌換 | Redemption | rewards |
  | `wallet` | 錢包 | Wallet | rewards |
  | `profile` | 個人檔案 | Profile | account |

  *(The md frontmatter carries a different, longer zh title, e.g. `帳號與登入`. That title is used
  today only as the KB document title; after migration the KB title becomes `title_zh`. This is an
  internal metadata change only — KB retrieval quality depends on the body chunks, not the title —
  and is accepted.)*

- **Track `title_zh`/`title_en`** ← the `LocalizedText` in `academyTracks` (both langs present).
- **Track teaser** ← `app.guide.teaser.a1–a9` (both langs) → stored as `metadata.teaser_zh/_en`.
- **Playbook `industry`/`creatorAngle`, resource `title`/`type`** ← the `LocalizedText` objects
  in `academy.ts` (both langs) → stored bilingually (§4).

**i18n keys removed in this PR** (now DB-sourced): `app.guide.doc.*` (8), `app.guide.teaser.a1–a9`
(9). **Kept as UI chrome** (never seeded): `app.guide.title`, `sectionGuides`, `sectionPlaybooks`,
`sectionAcademy`, `read`, `progress`, `unlockAt`, `verifyToUnlock`, `cat.{start,missions,rewards,
account}`, `docNotFound`, `trackNotFound`. Removing keys in matched en/zh pairs keeps the
`i18n.test.tsx` parity guard green.

---

## 4. Data model — `academy_content` (migration `0028`)

```sql
create table public.academy_content (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('guide_doc','track','playbook','resource')),
  slug           text not null unique,
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  title_zh       text not null,
  title_en       text,
  excerpt_zh     text,                 -- track description lands here; doc/playbook/resource may use it
  excerpt_en     text,
  body_zh        text not null default '',   -- guide_doc markdown (frontmatter-stripped); empty for others
  body_en        text,                        -- null now (long-form zh-only today)
  category       text,                 -- guide_doc only: start | missions | rewards | account
  required_level text check (required_level is null or required_level in
                   ('L0','L1','L2','L3','L4','L5','L6')),  -- track gate; null = ungated
  emoji          text,
  color          text,
  sort           int  not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  published_at   timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index academy_content_kind_status_sort_idx on public.academy_content (kind, status, sort);

-- Reuse the existing 0021 touch function; do NOT redefine it (would clobber content_items).
create trigger academy_content_touch
  before update on public.academy_content
  for each row execute function public.content_touch_updated_at();

-- RLS: authenticated read published; all writes service-role. NO workspace_id (content is global),
-- so there is no `workspace_id is null` clause. Grants are REQUIRED (a past prod incident was
-- caused by a missing service_role grant, not RLS).
alter table public.academy_content enable row level security;
create policy academy_content_read_published on public.academy_content
  for select to authenticated using (status = 'published');
grant select on public.academy_content to authenticated;
grant all    on public.academy_content to service_role;
-- anon gets no grant (creator route uses makeUserClient with a JWT = authenticated role).
```

### `metadata` jsonb shapes (typed, bilingual preserved)

- **guide_doc:** `{}` — `category`/`emoji` are top-level columns.
- **track:** `{ "duration": {"en":…,"zh":…}, "levelLabel": "L2+", "teaser_zh": …, "teaser_en": … }`
  - gate lives in the `required_level` column; `levelLabel` is display-only.
  - `description` → `excerpt_zh/excerpt_en`; `body_zh` starts empty (no lesson body exists today —
    the track detail page renders `excerpt` when `body` is empty).
- **playbook:** `{ "levels": [{"en":…,"zh":…}], "creatorAngle": {"en":…,"zh":…}, "ideas": [zh strings], "measurementFocus": "zh string" }`
  - `ideas` and `measurementFocus` are genuinely zh-only in source (English deferred, documented).
- **resource:** `{ "type": {"en":…,"zh":…}, "fileUrl": null }`
  - `fileUrl` is an authoring-only future field, **all null at seed**; `/guide` does not render
    resources as links until `fileUrl` exists (resources have no detail route today).

### Slugs

Preserved verbatim where they exist: guide docs (`account`, `leveling`, `missions`, `submission`,
`points`, `redemption`, `wallet`, `profile`), tracks (`a1`–`a9`), resources (`r1`–`r8`).
**Playbooks have no existing id** (the UI keys them on `industry.en`), so mint deterministic
slugs: `pb-beauty`, `pb-food`, `pb-travel`, `pb-retail`, `pb-health`, `pb-finance`. Document that
these are new (no legacy id to preserve); the `/guide` index and localStorage progress key on the
new slug, not `industry.en`.

### Seed (inline in the migration, 31 rows)

All 31 rows seeded `status='published'`, `insert … on conflict (slug) do nothing` (idempotent
re-apply), `published_at = now()`, explicit `sort` integers per kind so `/guide` order is
deterministic and matches today's array order (docs by category then array order; tracks `a1..a9`;
resources `r1..r8`; playbooks in current order). `required_level` per track from `academy.ts`
(`a1`=L0, `a2`=L1, `a3/a4/a5`=L2, `a6/a8/a9`=L3, `a7`=L4). Guide-doc `body_zh` = the md file body
**with the `^---\n…\n---\n` frontmatter stripped** (same fence the current loader strips). A seed
assertion/test verifies no `body_zh` begins with `---`.

---

## 5. Server API

All new server files carry the `.js` extension on relative imports (CI-guarded by
`scripts/check-esm-extensions.mjs`). Error envelope matches the content-hub convention:
`{ error, code, fields? }` with stable codes (`validation_error`, `conflict`, `not_found`,
`db_error`). Status codes: 201 create, 200 success, 404 not-found, 409 conflict (stale
`updated_at` **or** duplicate-slug `23505`), 422 validation, 500 db-error.

### Creator reads — `server/routes/academy.ts`
Mounted on the **guarded** group (`guarded.route("/academy", academyRoutes)` in `server/app.ts`),
reads via `makeUserClient(c.get("jwt"))` so RLS enforces published-only. Degrade to empty, never
500 (mirror `content.ts`).
- `GET /api/academy` → index bundle `{ docs, tracks, playbooks, resources }`, localized by
  `?lang` (default `zh-HK`). `docs` are list-shaped **without `body`** (list is light); tracks/
  playbooks/resources are returned in full (small).
- `GET /api/academy/doc/:slug` → one published guide_doc incl. `body`; 404 if absent.
- `GET /api/academy/track/:slug` → one published track (for the detail page); 404 if absent.
- Playbooks/resources are display-only (no detail route).

### Staff authoring — `server/routes/adminAcademy.ts`
Sub-mounted under `adminRoutes` (`adminRoutes.route("/", adminAcademyRoutes)`), so it **inherits
the staff-auth middleware** — it must NOT re-implement auth. Writes via `serviceClient()`. Mirrors
`adminContent.ts` (COLS/EDITABLE arrays; `c.req.json().catch(() => ({}))`; `transition()` helper
for publish/unpublish/archive; optimistic concurrency via `updated_at` → 409; `23505` → 409).
- `GET /api/admin/academy` (all statuses, optional `?kind`), `GET /:id`, `POST` (201),
  `PATCH /:id`, `POST /:id/{publish,unpublish,archive}`, `DELETE /:id`.

### Validation — `server/lib/academyAuthoring.ts` (pure, unit-tested)
`validateAcademyInput` / `validateAcademyEdit`: require `title_zh`; valid `kind`; **`required_level`
∈ canonical LEVELS ids** when present (reject `L2+`, `L5`-typos-that-aren't-canonical, etc.) —
critical because `levelIndex()` returns `0` (= ungated/qualified) for any unknown id, so a bad
`required_level` silently opens a gated track to everyone; kind-appropriate `metadata` shape; slug
format. Validation runs at **write time**, not only via the DB CHECK.

---

## 6. AI-KB ingest rewrite — `scripts/ingest-kb.ts`

Replace `loadArticles()` (filesystem) with `loadFromDb()` reading `academy_content` where
`kind='guide_doc'` and `status='published'`, building the same `SourceDoc`:
`{ sourceType: 'article', sourceRef: slug, title: title_zh, locale: 'zh-HK', content: body_zh }`.
Because `body_zh` is already frontmatter-stripped, `content = body_zh` directly (no regex). The
chunk/embed/upsert/`content_hash` pipeline is unchanged and idempotent; the `onConflict`
`(source_type, source_ref, locale)` key is stable (slug reused), so existing `kb_documents` rows
**upsert in place** and `content_hash` equality skips re-embedding when the body is byte-for-byte
unchanged.

**New prune step (required):** after upserting the published set, delete `kb_documents where
source_type='article' and source_ref not in (<published guide_doc slugs>)` (FK cascade clears
`kb_chunks`). This prevents an unpublished/archived doc from leaking into AI answers via
`match_kb_chunks`. Playbooks/resources/tracks are not ingested (no prose body) — matching today's
articles-only behavior.

Requires `AI_GATEWAY_API_KEY` + `AI_GATEWAY_EMBED_MODEL` at runtime (else `embedTexts` throws /
answers go empty — same caveat as C1/AI-assistant).

---

## 7. Client + `/guide` UI

### New client module — `src/lib/academy.ts`
`academyKeys` (`bundle`, `doc(slug)`, `track(slug)`, admin `list(kind)`/`item(id)`) + fetchers
(`fetchAcademyBundle`, `fetchAcademyDoc`, `fetchAcademyTrack` via `apiFetch`; admin CRUD via
`adminFetch`) + types (`AcademyDoc`, `AcademyTrack`, `AcademyPlaybook`, `AcademyResource`,
`AdminAcademyRow`). The `GuideCategory` type moves here from the deleted `guideDocs.ts`.

### `/guide` routes → `useQuery`
The three routes currently import hardcoded data synchronously; swapping to `useQuery` introduces
first-render states that must be handled explicitly:
- **Index** (`_app.guide.index.tsx`): fetch the bundle; render section skeletons while
  `isLoading`; empty-state per section; the read-progress badge (`readCount/total`) must not run
  against an in-flight empty array.
- **Doc detail** (`_app.guide.doc.$slug.tsx`) & **track detail** (`_app.guide.track.$trackId.tsx`):
  gate the "not found" branch on `query.isSuccess` (not merely `!doc`) so a valid slug does not
  false-positive into not-found during pending.
- **Preserved exactly:** `eligibility(required_level, me.data.level, me.data.is_trusted ?? false)`
  gating (raw level, fail-closed defaults) — `required_level` now from the DB row; `guideProgress`
  localStorage read-tracking (keyed on `creatorId` + slug; slugs unchanged for docs). The track
  detail renders `excerpt` when `body` is empty; the card unlock copy uses `metadata.levelLabel`.

### Admin authoring UI
New "Academy" item in `adminNavItems.ts` (Library group; `BookOpen`-style icon; new i18n label
key). A kind-aware `AcademyEditor.tsx`: markdown body editor for `guide_doc`/`track` (reuse the
`ContentEditor` `set()`/bilingual-toggle/`<Markdown>` preview patterns), structured sub-forms for
playbook (`levels`, `creatorAngle`, `ideas` list, `measurementFocus`) and resource (`type`,
`fileUrl`). List + editor wired through `academyKeys`/`adminFetch`.

### Marketing decoupling (public `_site` pages)
Extract a small **static** `src/data/marketingShowcase.ts` holding only what the public pages
render (the 6 playbooks + the track/resource subsets `_site.creators`/`_site.playbooks` slice);
update the `mockData.ts` re-exports and both `_site` pages to import from it. These marketing pages
stay static by design (unauthenticated; must not hit the creator API; marketing copy need not be
live-authored). `localized()` stays in `legacyAdfocateContent.ts` (used by 9 `_site` files).

### Deletions (after seed verified)
`src/data/academy.ts`, `src/data/guideDocs.ts`, `content/help/*.md` (8), and their tests
(`academy.test.ts`, `guideDocs.test.ts`); the `?raw` imports; the migrated `app.guide.doc.*` /
`app.guide.teaser.*` i18n keys (en+zh). Verify no dangling importers (`mockData.ts`, `_site.*`,
`GuideDocList` `GuideCategory` type all updated first) so `tsc --noEmit` + `check:esm` pass.

---

## 8. Testing

- **Pure unit** — `academyAuthoring.test.ts` (validators, incl. the `required_level` canonical-id
  guard that replaces the deleted `academy.test.ts` invariant).
- **Integration** — `academy.test.ts` (creator reads: published-only via RLS, bundle shape, doc
  body, 404); `adminAcademy.test.ts` (CRUD, staff-auth gating, validation 422, duplicate-slug 409,
  stale-`updated_at` 409, transitions).
- **Seed assertions** — row counts (8 / 9 / 6 / 8 = 31); no `body_zh` starts with `---`; every
  track `required_level` ∈ canonical LEVELS ids.
- **Frontend** — guide index/doc/track render from mocked query data: loading skeleton, empty
  state, gating locked/unlocked (verify-to-unlock vs need-XP), and not-found only after
  `isSuccess`.
- **KB** — `loadFromDb()` builds correct `SourceDoc[]`; the prune step removes orphaned
  `kb_documents` for unpublished slugs.
- Full gate: `check:esm` + `tsr generate` + `tsc --noEmit` + `vite build` + lint + unit +
  integration all green.

---

## 9. Rollout

Ordered (KB depends on the table being populated first):
1. Apply `0028_academy_content.sql` (inline seed, all 31 rows published) to prod
   `mhkoayftiuojxlrkollf` via **raw SQL / `execute_sql`** — NOT `db push` (the cloud migration
   tracker is out of sync; `0018`–`0027` were applied out-of-tracker). File header notes it is
   applied out-of-tracker.
2. `NOTIFY pgrst, 'reload schema';` so PostgREST sees the new table + RLS immediately.
3. Deploy code via **Git** (never `vercel --prod` from local — mis-bundles the API).
4. Run `npm run ingest:kb` **once** on prod (with `AI_GATEWAY_API_KEY` + `AI_GATEWAY_EMBED_MODEL`
   set). `body_zh` must equal the previously-ingested stripped article text byte-for-byte so
   `content_hash` matches and existing `kb_chunks` are reused (no needless re-embed); the prune
   step clears any now-unpublished docs.
5. Smoke: `/guide` renders all four sections from the DB; a staff edit in `/admin` reflects on
   `/guide`; the AI assistant answers from the re-ingested KB; unpublishing a doc removes it from
   both `/guide` and (after the next ingest) the KB.

---

## 10. Deferred / out of scope

- English long-form `body_en` for the 8 help docs (zh-only today; UI falls back via `localized()`
  / `pick()`).
- `scheduled_for` publishing for academy content (add later if needed).
- Playbook `ideas[]` / `measurementFocus` English (zh-only in source).
- Resource `fileUrl` downloads (field seeded null; no detail route yet).
- Server-side read-progress (stays client-only localStorage, MVP).
