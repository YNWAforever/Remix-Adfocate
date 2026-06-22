# B2 — Richer Authoring + Workspace-Scoped Review (design)

**Date:** 2026-06-22
**Slice:** B2 (brand/advertiser side, second slice — follows B1 Mission Authoring)
**Status:** Approved design, pre-plan
**Author:** Willy Lai + Claude

---

## 1. Context & premise

The Creator Activation Funnel and B1 (Mission Authoring) are shipped. B1 gave Fimmick/Adfocate
staff the ability to create / edit / publish / close / delete missions per workspace inside
`/admin`, but:

- **Auth is a single shared `ADMIN_SECRET`** (`x-admin-secret` header → `serviceClient()` which
  bypasses RLS), workspace-agnostic. `server/routes/admin.ts` and `src/lib/admin.ts` both note
  this is interim.
- **Authoring is thin.** The mission brief a creator sees is only four fields
  (`deliverables[]`, `requirements[]`, `platforms[]`, `effort` — migration `0011`). The B1 editor
  collects these as plain newline-delimited textareas. There is no audience/guardrail/messaging
  content, no preview, no way to clone a mission.
- **Operator review is cross-workspace.** `/admin/applications`, `/admin/engaged`,
  `/admin/submissions` query `mission_submissions` with `missions!inner` but **no
  `workspace_id` filter** — they list across every brand at once.

B2 closes both gaps in one slice, in **two build phases**:

1. **Richer authoring** — more brief fields, chip/array editors, draft preview, duplicate.
2. **Workspace-scoped review + per-mission drill-in** — a global workspace switcher that scopes
   every `/admin` tab, plus a per-mission "Manage" view to run a mission end-to-end.

### Non-negotiable framing

- **Workspace scoping in B2 is convenience filtering, NOT a security boundary.** The shared
  `ADMIN_SECRET` still authorizes every workspace; the switcher just narrows what a single trusted
  operator sees. **Real per-workspace authorization is B3** (external brand/staff logins +
  `workspace_members` roles). The admin gate stays isolated so B3 is a wrapper swap, not a route
  rewrite.
- `missions.created_by` stays **null** (B3 fills it once real `auth.uid` accounts exist).
- Brief content is **single-language** — the `missions` table has single `title`/`description`
  columns (no `_en`/`_zh`), and the new fields follow that pattern. Only *labels* are bilingual.

### Roadmap position

| Slice | Scope | Status |
|-------|-------|--------|
| B1 | Mission authoring (create/edit/publish/close/delete) | DONE |
| **B2** | **Richer authoring + workspace-scoped review + per-mission drill-in** | **this spec** |
| B3 | Real staff/brand auth + `workspace_members` roles (replaces shared secret) | next |
| B4 | Brand dashboard home + analytics | later |

---

## 2. Goals / non-goals

**Goals**
- Staff can author a brief rich enough that a creator knows the audience, guardrails, key
  messages, and where to find reference/brand assets.
- Editing arrays is chip-based, not newline-parsing.
- Staff can preview the exact creator-facing brief before publishing.
- Staff can duplicate an existing mission into a new draft (across workspaces).
- A global workspace switcher scopes every `/admin` tab to one brand.
- Staff can open one mission and run it end-to-end (accept/decline applicants, approve/reject
  submissions) without leaving the mission.

**Non-goals (explicit, deferred)**
- Real per-workspace authorization / external brand logins → **B3**.
- Brand dashboard home + analytics → **B4**.
- Bilingual brief *content* (only labels are translated).
- Scheduling / publish-later, mission templates (not selected during brainstorming).
- Pagination of admin lists (counts are low, and workspace scoping *reduces* per-view rows; add
  later if needed).

---

## 3. Phase 1 — Richer authoring

### 3.1 Data model — migration `0019_mission_brief_rich.sql`

Additive, mirroring `0011_mission_brief.sql`'s style.

**Codebase-verified:** `0004_grants.sql` grants table-level `select on public.missions to
authenticated` (no column list) and `0002_harden_rls.sql`'s `missions_workspace` policy is
table-level (no column scope). Both apply automatically to new columns, so **no grant or RLS
change is needed** for creators to read the new fields. (There is no separate "creator" role —
only `authenticated` / `anon` / `service_role`; admin writes use `service_role`, which bypasses
RLS/grants entirely.)

```sql
-- 0019_mission_brief_rich.sql
-- Slice B2: richer mission brief. Additive, nullable-or-defaulted; existing grants + RLS cover.
alter table public.missions
  add column target_audience text,
  add column dos             text[] not null default '{}',
  add column donts           text[] not null default '{}',
  add column key_messages    text[] not null default '{}',
  add column reference_links text[] not null default '{}';
```

**Production apply (required):** after applying `0019` to prod, run `notify pgrst, 'reload
schema';` so PostgREST refreshes its schema cache — otherwise reads of the new columns 500/omit
them until the next reload. (Documented pattern from `0009`/`0010`/`0011`/`0017`; a past slice had
a brief outage from skipping it.) Apply the migration **before** the code that selects the new
columns deploys.

Field semantics:

| Column | Type | Meaning | Render |
|--------|------|---------|--------|
| `target_audience` | `text` | Who the content should speak to | paragraph |
| `dos` | `text[]` | Must-do guardrails | ✓ checklist |
| `donts` | `text[]` | Must-not-do guardrails | ✗ checklist |
| `key_messages` | `text[]` | Core talking points | bulleted list |
| `reference_links` | `text[]` | Example posts + brand assets (URLs) | link list |

### 3.2 Backend — validation (`server/lib/missionAuthoring.ts`, pure)

- Extend `MissionInput` and `MissionRecord` (and the frontend mirror types) with the five fields.
- Extend the `MissionInput` type (lines ~19-38) and `MissionRecord` with the five fields
  (`target_audience?: string | null`, `dos?/donts?/key_messages?/reference_links?: string[]`),
  then extend `validateMission(input, mode, today?)` and `validateEdit(existing, patch,
  hasEngagement)` (these are the real signatures):
  - New fields are **optional even at publish** — they enrich, they do not gate. (Publish gating
    stays exactly as B1.)
  - Normalize arrays in this **order**: (1) trim each entry, (2) drop now-empty entries, (3) cap
    count at **≤ 12** items, (4) enforce per-item length **≤ 200** chars (messaging/guardrails) →
    error if exceeded. `target_audience`: trim, cap **≤ 500** chars.
  - `reference_links`: each entry validated as an `http(s)` URL. **Reuse `normalizePortfolioUrl()`
    from `server/lib/profileMedia/service.ts`** (a TS helper that parses via the `URL` constructor
    and checks protocol) — import it (with the `.js` extension) rather than re-implementing. Invalid
    → `fields: { reference_links: "..." }` (422).
  - On any normalization failure return `{ ok: false, errors }` with field-keyed messages (Chinese,
    locale `zh`), matching B1's `validation` shape.

### 3.3 Backend — endpoints (`server/routes/adminMissions.ts`)

- Add the five columns to `MISSION_COLS`, `EDITABLE_COLS`, and the `POST /missions` insert map
  (defaulting arrays to `[]`, `target_audience` to `null`).
- **New `POST /admin/missions/:id/duplicate`** (exact step order):
  1. Load the source mission (any status) → `404 { code: "not_found" }` if missing.
  2. `workspace_id = body.workspace_id ?? source.workspace_id`. If `body.workspace_id` was
     supplied, check it exists in `workspaces` → `404 { code: "not_found" }` if not.
  3. Fetch existing slugs for the **target** workspace; compute the slug via pure helper
     `nextDuplicateSlug(base, existingSlugs)` → `<base>-copy`, `-copy-2`, `-copy-3`, … (first free).
  4. Build a new draft: copy all editable + brief fields; `status='draft'`, `filled=0`,
     `published_at=null`, `closed_at=null`, fresh `created_at`/`updated_at`, `created_by=null`.
  5. Insert. On a racy `23505` (another op took the slug between steps 3-5): **re-fetch slugs,
     recompute, retry once**; if it still collides → `422 { code: "validation", fields: { slug } }`.
  6. Return `{ mission }` (201).
  - Cross-workspace note: only the mission's own brief fields are copied (they are
    workspace-agnostic). No applicants/submissions/assets are carried over.

### 3.4 Frontend — authoring (`src/routes/admin.missions.*`, `src/lib/admin.ts`)

- `src/lib/admin.ts`: extend `AdminMission` + `MissionDraftInput` (+ `MissionPatch`) with the five
  fields; add `duplicateMission(id, body?)`.
- **`ArrayInput`** — a reusable chip add/remove component (text entry + Enter/comma to add, × to
  remove) used for `deliverables`, `requirements`, `key_messages`, `dos`, `donts`,
  `reference_links`. Replaces B1's newline `<textarea>` parsing.
- **Platforms** — a known-set multi-select (`xiaohongshu`, `instagram`, `tiktok`, `youtube`) with
  a custom-add escape hatch, written through `platformLabelKey` for display.
- `target_audience` — a single text input/area.
- **Draft preview** — a `預覽` toggle in the editor that renders the creator-facing brief
  (`MissionBrief` + `MissionFacts`) from current form state, no save required. **Note:** these
  components take a `mission: Mission` (the DB type from `lib/queries/kocmax`), not a plain props
  bag — the preview casts the `MissionDraftInput` form state to `Mission` (field names align). The
  frontend `Mission` type must be extended with the five new fields (see §3.5) so the cast and the
  render both type-check.
- **Duplicate** — a `複製` action on each Missions-list row → `duplicateMission` → navigate to the
  new draft's editor.

### 3.5 Creator-facing rendering (`MissionBrief.tsx`)

Render each new field **only when it has content** (null / empty array → section hidden, matching
existing brief behavior):

- `target_audience` → a "目標受眾 / Target audience" paragraph block.
- `dos` / `donts` → two checklists (✓ / ✗).
- `key_messages` → a bulleted "重點訊息 / Key messages" list.
- `reference_links` → a "參考及素材 / Reference & assets" list of links (`rel="noopener"`,
  `target="_blank"`).

Extend the frontend `Mission` type (`lib/queries/kocmax`) with the five fields so `MissionBrief`
can read them. Section *labels* are added to **`src/lib/i18n.dict.ts`** under both locales
(`en` and `zh` — the locale codes are `"en" | "zh"`, not `"zh-HK"`), following the existing
`app.mission.brief*` key pattern (e.g. `app.mission.briefAudience`, `briefDos`, `briefDonts`,
`briefKeyMessages`, `briefReferences`). `MissionBrief` already pulls every label via
`useI18n()`'s `t()`, so the new sections follow suit.

---

## 4. Phase 2 — Workspace scoping + drill-in

### 4.1 Global workspace switcher

- A `WorkspaceSwitcher` in the `/admin` shell header, sourced from `GET /admin/workspaces`, with a
  leading **「全部 / All workspaces」** option.
- Current selection held by a small `useAdminWorkspace` hook/context:
  - Persisted to `sessionStorage` (survives reload, cleared on tab close — matches the secret's
    lifetime).
  - Reflected as a `?ws=<id>` search param so the selection is shareable / deep-linkable. URL is
    the source of truth on load; sessionStorage is the fallback default.
- Every tab's list fetcher passes `?workspace=<id>` when a workspace is selected; **All** omits the
  param (preserves today's cross-workspace behavior).

### 4.2 Backend scoping

Add an **optional** `?workspace=` filter to the three currently-unscoped endpoints, via the
`missions!inner` join:

| Endpoint | Change |
|----------|--------|
| `GET /admin/applications` | `.eq("missions.workspace_id", ws)` when `ws` present |
| `GET /admin/engaged` | `.eq("missions.workspace_id", ws)` when `ws` present |
| `GET /admin/submissions` | `.eq("missions.workspace_id", ws)` when `ws` present |
| `GET /admin/missions` | already supports `?workspace=` (B1) |
| `GET /admin/creators/review` | **does not currently filter by workspace** (verified — `listCreatorReviewQueue` in `server/lib/operatorCrm/repo.ts` queries `creators` with no `workspace_id` filter). Add a `workspace` field to `CreatorReviewQueueFilters`, accept `?workspace=` in the route, and apply `.eq("workspace_id", ws)` to the `creators` query. Independent of the existing `mission_id` filter. |

No new auth — the secret still grants all workspaces; this is filtering only.

### 4.3 Mission drill-in — "Manage" tab

- `/admin/missions/$missionId` gains a tab toggle **編輯 / 管理** (Edit / Manage), deep-linkable via
  `?tab=manage`. Edit = the B1 editor; Manage = the drill-in.
- **New `GET /admin/missions/:id/activity`** → `{ mission, applicants[], submissions[], engaged[],
  fill: { filled, quota } }`, assembled by a **pure, tested shaper** `shapeMissionActivity` in a new
  `server/lib/missionActivity.ts` (style of `shapeEngagedRoster`). One query of
  `mission_submissions` for the mission, bucketed by status:
  - `applicants` = `status='applied'`; `submissions` = `status in ('submitted','under_review')`;
    `engaged` = `status in ('joined','approved')` (read list); `fill` from `mission.filled` /
    `mission.quota`.
  - **Enrichment:** `applicants`/`submissions` rows must be run through `enrichAdminMissionRows`
    (as `/admin/applications` and `/admin/submissions` already do) so the Manage-tab cards share the
    exact row shape (`Application`/`Submission`) the existing tabs render.
  - Response type sketch (export from the shaper): `{ mission: AdminMission; applicants:
    Application[]; submissions: Submission[]; engaged: EngagedCreator[]; fill: { filled: number;
    quota: number } }`.
  - **ESM rule:** the new `missionActivity.ts` (and any new server helper) must use the `.js`
    extension on every relative import (the project's documented ESM rule — a prior outage came from
    omitting it).
- Manage tab UI:
  - Header: status + fill/quota progress.
  - Applicants — **accept / decline in place**, reusing `POST /admin/applications/:id/accept` and
    `/decline`.
  - Submissions — **approve / reject in place**, reusing `POST /admin/submissions/:id/approve`
    (with `quality_rating`) and `/reject`.
  - Engaged — read list.
- All mutations invalidate the mission-activity TanStack key (and the relevant tab keys).

---

## 5. Data flow

```
Frontend (TanStack Query)
  → adminFetch(path)  [x-admin-secret header, ?workspace / ?ws params]
  → Hono /admin routes  [shared-secret middleware → serviceClient(), bypasses RLS]
  → Supabase (missions, mission_submissions, workspaces, creators)
```

- Workspace selection flows purely as a query param; no server-side session.
- Mutations invalidate the affected TanStack keys. From the Manage tab, accept/decline/approve/
  reject invalidate the new `["admin-mission-activity", missionId]` key **and** the matching list
  keys (`adminKeys.applications`, `adminKeys.submissions(status)`, `adminKeys.engaged`) so the tabs
  stay consistent. `duplicate`/`publish`/`close` invalidate `adminMissionKeys.list(workspace,
  status)` (and `.detail(id)`). New keys live in the existing `adminKeys` / `adminMissionKeys`
  objects in `src/lib/admin.ts`.

---

## 6. Error handling

- Reuse `AdminRequestError` / `AdminAuthError` (`src/lib/admin.ts`). `401` → `clearAdminSecret()`.
- Validation → `422 { error, code: "validation", fields }` (B1 shape); rendered field-inline.
- Bad lifecycle transition → `409 { code: "invalid_transition" }`.
- Unique-slug clash (`23505`) → `422 { fields: { slug } }`; duplicate endpoint retries once then
  surfaces 422.
- `reference_links` URL validation failure → `422 { fields: { reference_links } }`.
- DB / RPC errors → `500 { code: "db_error" }` / `400 { code: "rpc_error" }`, as today.

---

## 7. Testing

**Unit (Vitest, TDD where pure):**
- `validateMission` / `validateEdit` — new fields: normalization (trim/drop-empty/caps), optional
  at publish, `reference_links` URL validation.
- `nextDuplicateSlug` — base, first collision, multiple collisions, cross-workspace isolation.
- `shapeMissionActivity` — bucketing by status, fill computation, empty mission.

**Integration (`server/test`, local stack):**
- `POST /admin/missions/:id/duplicate` — clone fields, draft reset, slug suffixing, cross-workspace
  target, source-not-found 404.
- `GET /admin/missions/:id/activity` — buckets + fill; reuse-path accept→engaged transitions.
- Workspace-filtered `applications` / `engaged` / `submissions` — `?workspace=` narrows; omitted =
  all.
- Brief round-trip — create draft with new fields → publish → creator read renders them.

**Frontend route tests (`src/routes/-admin.missions.*.test.tsx`, etc.):**
- `ArrayInput` add/remove; platforms multi-select.
- Draft-preview toggle renders the brief from form state.
- `WorkspaceSwitcher` scoping (selection → fetchers receive `?workspace`; persisted to `?ws`).
- Manage tab: accept/decline + approve/reject call the right endpoints and invalidate.

**Gates:** `npm run type-check` (runs `tsr generate` — required for new routes), `npm run lint`,
`npm run build`, `npm run test`, integration suite.

---

## 8. Build order (two phases, one spec)

1. **Phase 1 — Richer authoring.** Migration `0019` → validation → endpoints (incl. duplicate) →
   editor (ArrayInput, platforms, audience/brief fields, preview, duplicate) → creator-facing
   render. Ship + review.
2. **Phase 2 — Scoping + drill-in.** `useAdminWorkspace` + `WorkspaceSwitcher` → backend
   `?workspace=` filters → `/missions/:id/activity` + shaper → Manage tab (act-in-place). Ship +
   review.

---

## 9. Forward hooks for B3

- `created_by` column already present (stays null until B3).
- Admin gate stays isolated (`adminRoutes.use("*", secret-check)`) — B3 swaps secret → JWT/role
  with no route-handler rewrites.
- Every list endpoint is already `?workspace=`-parameterized after B2 — B3 turns the convenience
  filter into an enforced, role-scoped boundary.
