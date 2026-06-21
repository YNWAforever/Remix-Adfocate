# Brand/Advertiser Side — Slice B1: Mission Authoring (Design)

**Date:** 2026-06-22
**Status:** Design approved (brainstorming) + revised after adversarial spec review — pending user spec review → implementation plan
**Phase:** Brand/Advertiser side, Slice **B1** (first slice)

---

## 1. Context & goal

The Creator Activation Funnel is fully shipped. The next product phase is the **brand/advertiser side**. Today a "brand" is only a `workspaces` row (`name`, `slug`, `theme`, `plan`); workspaces have **no owner/members/roles**, and **mission creation does not exist anywhere** — every mission is hand-seeded in `supabase/seed.sql`. The "operator" is a single shared `ADMIN_SECRET` (`x-admin-secret` header, `serviceClient`, workspace-agnostic). `src/lib/admin.ts` already notes this is interim: *"real per-workspace role auth lands with the Brand Dashboard."*

### Pivotal product decision
**Agency-operated, designed for self-serve later.** Phase 1 = Fimmick/Adfocate staff author missions on behalf of brand clients per workspace. The data model carries forward hooks so external brand logins (Slice B3) layer on without rework.

### Brand-side decomposition (for reference; only B1 is in scope here)
| Slice | Delivers | Depends on |
|---|---|---|
| **B1 (this spec)** | Staff create/edit/publish a mission per workspace — full brief, rewards, quota, deadline, Draft→Active→Closed lifecycle. *Greenfield.* | — |
| B2 | Re-scope existing operator review (applications/submissions/engaged) to a selected workspace + per-mission management. | B1 |
| B3 | Real staff/brand auth + `workspace_members` roles (replaces the shared secret). | — |
| B4 | Brand dashboard home + analytics. | B1+B2 |
| B5 | Billing/plans. | later |

### B1 success criteria
An operator can, entirely in-app: pick a brand workspace, create a mission as a Draft, edit it freely, publish it live to creators, and close it — with economic terms protected once creators engage, and with Drafts/Closed missions never leaking to creators through **any** read path.

---

## 2. Architecture decisions (locked during brainstorming)

1. **Authoring home:** a new **"Missions" tab in `/admin`** (alongside Applications/Engaged/Submissions/Creators). Stays behind the existing `x-admin-secret` gate for now.
2. **Workspace scope:** **pick from existing workspaces** via a dropdown. Creating/onboarding new brand workspaces is out of B1.
3. **Lifecycle:** **Draft → Active → Closed.** Draft is hidden from creators; Publish makes it live; Close stops new joins (existing participations stay reviewable). No reopen in B1.
4. **Edit safety (three tiers):**
   - **Frozen at publish** (immutable once `status != 'draft'`, regardless of engagement): `slug`, `mission_type`. (Slug is the per-workspace creator URL key — `missions.ts:67` + the `0001` unique constraint; `mission_type` defines the whole reward model.)
   - **Locked on engagement** (immutable once a creator has engaged): `points_reward`, `cash_reward`, `cpm_rate`, `cpm_budget_pool`, `access_type`, `required_level`.
   - **Constrained on engagement:** `quota ≥ max(existing.quota, filled)` (can only grow, never below `filled`); `deadline ≥ existing.deadline` (can only extend).
   - **Always editable:** `title`, `description`, `category`, `deliverables[]`, `requirements[]`, `platforms[]`, `effort`.
5. **Write path (Approach 1):** thin secret-gated admin REST routes (`serviceClient`) + a **pure `server/lib/missionAuthoring.ts`** module holding slug/validation/field-lock logic (mirrors `missionMatch.ts`/`hookGen.ts`). Lifecycle transitions are plain status updates — no RPCs (the existing RPCs solve `auth.uid`-scoped concurrency B1 doesn't have, and PL/pgSQL validation is hard to test).

---

## 3. Data model — migration `0018_mission_authoring.sql`

`missions.status` is currently free `text not null default 'active'` with **no** check constraint. All existing rows are `'active'`.

```sql
-- Lifecycle constraint (matches the convention used by most status cols;
-- note creators.status (0001:24) and redemption_gifts.status (0001:62) have none — the CHECK is still desirable)
alter table public.missions
  add constraint missions_status_chk check (status in ('draft','active','closed'));

-- Authoring / audit columns
alter table public.missions
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists published_at timestamptz,
  add column if not exists closed_at    timestamptz,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;
```

- `created_by` = **self-serve forward hook** (B3). It stays **`null` permanently for every B1-authored mission** (the secret-gated operator has no `auth.uid`); B3 attributes only missions created after real staff/brand accounts land. Documented so the forward hook isn't mistaken for live attribution.
- `updated_at` is set by the PATCH handler on each edit; `published_at`/`closed_at` set on their transitions.
- Operator writes use `serviceClient` (bypasses RLS) → **no new RLS policy** for authoring. New columns inherit existing `missions` grants. Creator reads keep their existing workspace-scoped RLS; status filtering is enforced at the API layer (§5).
- **Migration naming:** the repo uses the `00NN_` sequence (last is `0017_`), so `0018_` is correct for the repo. A few timestamped migrations also exist; during planning, confirm the prod migration-tracker state so the apply doesn't land out of order.

---

## 4. Server API — secret-gated admin endpoints

Mounted under `/admin` with the existing `x-admin-secret` middleware and `serviceClient`. New file `server/routes/adminMissions.ts`, registered in `server/app.ts`. **All relative imports use the `.js` extension** (ESM rule — relative server imports without `.js` caused a prior prod outage).

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /admin/workspaces` | brand picker | `{ id, slug, name }[]`, **all** workspaces ordered by `name` (no status/type column to filter brands; demo/test workspaces appear — eligibility filtering deferred to B3) |
| `GET /admin/missions?workspace=&status=` | authoring list (all statuses) | each row annotated `engaged: boolean` + `filled`/`quota`; ordered by `updated_at desc`; `status` optional (defaults to all). Pagination deferred (low mission counts); add `page/page_size` later if needed |
| `GET /admin/missions/:id` | full record for edit form | any status |
| `POST /admin/missions` | create **Draft** | body + `workspace_id`; `validateMission(_, 'draft')`; slug-unique-per-workspace check; inserts `status='draft'` |
| `PATCH /admin/missions/:id` | edit | computes `hasEngagement`; `validateEdit(existing, patch, hasEngagement)`; sets `updated_at`. Rejected on `status='closed'` (409 `invalid_transition`) |
| `POST /admin/missions/:id/publish` | Draft→Active | `validateMission(full, 'publish')` must pass; sets `status='active'`, `published_at=now()` |
| `POST /admin/missions/:id/close` | Active→Closed | sets `status='closed'`, `closed_at=now()` |
| `DELETE /admin/missions/:id` | discard a junk **Draft** | allowed **only** when `status='draft'` AND zero `mission_submissions` rows; else 409. Active/Closed are never deleted (referential integrity) |

**Error-body shape (pinned):**
- `422` validation / locked-field / frozen-field errors → `{ error: <human summary>, code: 'validation', fields: Record<column, msg> }` where `fields` keys are **DB column names** (so the module's `errors` map maps 1:1 onto `fields`).
- `409` invalid lifecycle transition (publish a non-draft; close a non-active; edit/delete a closed mission; delete a non-draft) → `{ error, code: 'invalid_transition' }`.
- `404` not found · `401 no_admin` (existing secret gate).

**`hasEngagement(mission)`** = `filled > 0` **OR** `exists(mission_submissions WHERE mission_id = :id AND status IN ('applied','joined','submitted','under_review','approved'))`. Terminal `declined`/`rejected`/`expired` rows do **not** count — a mission whose applicants all dropped out stays fully editable. `filled` is monotonic (RPCs only ever `filled = filled + 1`, never decrement), so the quota floor uses raw `filled`. Computed in the route via a count query.

---

## 5. Visibility guards (load-bearing — verified exhaustively against the repo)

Introducing `draft`/`closed` is unsafe unless **every** creator-facing mission read filters to `active`. Full audit of `missions` read sites:

| Read path | Today | Change in B1 |
|---|---|---|
| `GET /missions` list — `server/routes/missions.ts:27` | returns **all** statuses (no filter) | **add `.eq("status","active")`** |
| `GET /missions/:slug` detail — `server/routes/missions.ts` | no status filter | **return 404 if `status != 'active'`** for the creator client |
| `POST /api/copilot/hook-generator` — `server/routes/copilot.ts:27` (reads `title, description, category` by slug) | **no status filter** — a creator could pull a non-active mission's brief & generate hooks | **add `.eq("status","active")`**; treat the no-row case (PGRST116) as the existing 404 |
| `/match` — `server/routes/match.ts:33` | already `.eq("status","active")` ✅ | none |
| `server/routes/onboarding.ts:91` | already `.eq("status","active")` ✅ | none |
| Assistant `get_my_missions` — `server/lib/assistant/tools.ts` | reads the **caller's own** `mission_submissions` (embeds `missions`); its `status` arg is **submission** status, not mission lifecycle | **none** — no unengaged-mission leak is possible (a draft can only surface if the creator already engaged it, which the lifecycle prevents) |
| join / apply / submit RPCs (`0005`/`0010`/`0017`) | already `if m.status <> 'active' then raise 'closed'` ✅ | none — **Close auto-blocks new joins for free** |

The new **operator** endpoints (§4) are the only place that may read/write non-active missions. (Optional defense-in-depth: add `status='active'` to the creator `missions` SELECT RLS policy — decided during planning after inspecting the exact policy; API guards are the primary mechanism.)

---

## 6. Pure module — `server/lib/missionAuthoring.ts`

Pure (no DB, no `new Date()` / no ambient clock), unit-tested, server-side source of truth.

- **`isValidSlug(slug): boolean`** — `^[a-z0-9][a-z0-9-]*$`. (Titles are zh-HK, so slug is an operator-entered english identifier, not derived from the title.) Empty/invalid slug → `fields.slug` 422; uniqueness-per-workspace is a DB check in the route (`fields.slug` 422 on collision).
- **`suggestSlug(missionType): string`** — kebab default from the mission type for the create form (operator can override).
- **Level set:** allowed `required_level ∈ {L0,L1,L2,L3,L4,L5,L6}` — the canonical seven-level set from `src/lib/levels.ts` (`LEVELS`, also the DB `level_ordinal` gate in `0005` and server `LEVEL_IDS` in `trust.ts`/`passport.ts`). **Do not cross-import** the frontend `src/lib/levels.ts` into the server bundle (prior ESM cross-tree-import outage); duplicate the literal `['L0','L1','L2','L3','L4','L5','L6']` in the server module with a comment naming `src/lib/levels.ts` as canonical.
- **`validateMission(input, mode): { ok, errors: Record<column,string> }`** (the `errors` map = the route's `fields` body)
  - `mode:'draft'` — requires `workspace_id`, `title`, valid `slug`, **and `mission_type`** (the column is `NOT NULL` with no default — omitting it would hit Postgres `23502` and surface as a generic 500 instead of the promised 422). Everything else may be sparse.
  - `mode:'publish'` — strict, additionally: `category`, `access_type ∈ {open,application}`, `required_level ∈ {L0..L6}`, `quota ≥ 1`, `deadline ≥ today`, non-empty `description`, **and reward-by-type**:
    | mission_type | required reward |
    |---|---|
    | `koc_trial`, `ugc`, `clipping`, `brand_ambassador` | `points_reward > 0` and/or `cash_reward > 0` |
    | `performance_cpm` | `cpm_rate > 0` **and** `cpm_budget_pool > 0` |
    | `affiliate`, `live_commerce` | `points_reward > 0` and/or `cash_reward > 0` |
  - **`deadline ≥ today`:** `today` is an **injected `YYYY-MM-DD` string in `Asia/Hong_Kong`**, passed into the pure module by the route (never `new Date()` inside) — keeps it deterministic/testable and aligned with the DB RPCs' `current_date` comparison and the HK business timezone.
- **`validateEdit(existing, patch, hasEngagement): { ok, errors }`**
  - **Frozen-at-publish:** if `existing.status != 'draft'`, reject any change to `slug` or `mission_type`.
  - **Locked-on-engagement:** if `hasEngagement`, reject any change to `points_reward`, `cash_reward`, `cpm_rate`, `cpm_budget_pool`, `access_type`, `required_level`.
  - **Constrained-on-engagement:** if `hasEngagement`, enforce `quota ≥ max(existing.quota, filled)` and `deadline ≥ existing.deadline`.
  - Draft, or Active-but-unengaged: everything editable **except** the frozen-at-publish pair once published.

---

## 7. Frontend — `/admin` Missions tab

- **Tab:** add "Missions" → `/admin/missions` in `src/components/admin/AdminTabs.tsx`.
- **List route** (`admin.missions`): workspace picker (`fetchWorkspaces`) + status filter (All/Draft/Active/Closed) + **"New mission"** button. Rows: title, slug, type badge, **status badge**, reward summary, `filled/quota`, deadline, **engaged** indicator. Row actions: **Edit**, **Publish** (drafts only), **Close** (active only), **Delete** (drafts only). Empty state when the workspace has no missions / no workspaces exist.
- **Editor route** (create + edit modes; a **new** form route under the `/admin` layout — note `operator.missions.$missionId` is a read-only review screen, not a reuse target). Four sections:
  - **Basics:** workspace (read-only on edit), title (zh-HK), slug (english kebab; pre-filled via `suggestSlug`; **disabled once published**), category, `mission_type` (**disabled once published**), `access_type`, `required_level` (L0–L6).
  - **Rewards:** conditional by `mission_type` — points/cash fields, or `cpm_rate` + `cpm_budget_pool` for `performance_cpm`. **Off-type reward fields are nulled on save** (e.g. cpm fields cleared when type != `performance_cpm`) so no stale values persist.
  - **Logistics:** quota (`min = filled` when engaged), deadline (`min = current` when engaged).
  - **Brief:** description; deliverables / requirements / platforms as **plain newline-delimited textareas** parsed to `string[]` on save (there is no existing array-input component — `MissionBrief.tsx` renders arrays read-only — and a chip/array editor is deferred polish, not B1); `effort` as an optional enum select (`low`/`medium`/`high`, matching the `0011` check; not required at publish).
- **`category` source:** the editor dropdown reuses a **single shared category constant** so authored values match the creator mission filter and the matcher category-fit (`missionMatch.ts:96`). B1 consolidates the currently-divergent hardcoded lists into one constant (e.g. `src/lib/missionCategories.ts`) used by both the editor and the creator filter. Stored as zh-HK text.
- **`src/lib/admin.ts` additions** (extend `adminFetch` pattern): `fetchWorkspaces`, `fetchAdminMissions(workspace, status)`, `fetchAdminMission(id)`, `createMission(body)`, `updateMission(id, patch)`, `publishMission(id)`, `closeMission(id)`, `deleteMissionDraft(id)` + `AdminMissionRow`/`MissionDraftInput` types.
- **Behaviour:** on edit, frozen/locked fields render **disabled with reason** ("Locked — published" / "Locked — creators have already engaged"). **Save** = create/update draft; **Publish**/**Close**/**Delete** are consequential → confirm dialog. Server `422` → per-field errors keyed by `fields`; `409` → transition-error toast. Form chrome follows the existing internal `/admin` convention; mission **content** fields are free-text zh-HK.

---

## 8. Testing

- **Unit — `server/lib/missionAuthoring.test.ts`:** `isValidSlug`/`suggestSlug`; `validateMission` draft-mode requires `mission_type`; publish-mode over the **full reward-by-type matrix** (all 7 types incl. the `affiliate`/`live_commerce` "points>0 and/or cash>0" threshold), level set **L0–L6**, deadline-vs-injected-HK-today, quota<1; `validateEdit` frozen-at-publish (slug/mission_type), locked-on-engagement per field, quota `≥ max(existing,filled)`, deadline-only-extend, **all-declined mission stays fully editable**, draft = nothing frozen.
- **Integration — `server/test/missionAuthoring.test.ts`** (local stack): create draft (sparse, no reward) → in admin list, **not** in creator `GET /missions`; publish → visible; publish-missing-fields → 422 with `fields`; publish non-draft / close non-active / edit closed → 409; edit slug or mission_type after publish → 422; edit economic field after a join → 422, edit brief after a join → 200; quota-below-filled → 422; slug collision per workspace → 422 `fields.slug`; delete draft → ok, delete active → 409; **visibility guards**: draft not in creator list, detail 404, **hook-generator on a draft/closed slug → 404**, not joinable (RPC 'closed'); `?workspace=` scoping. *(Removed: the earlier "assistant tool excludes drafts" test — the assistant reads caller-scoped submissions and proves nothing here.)*
- **Frontend route tests** (like `admin.applications.test.tsx`): list + filter + New routing; editor conditional reward fields; disabled slug/mission_type on a published mission; disabled economic fields on an engaged mission; 422 → per-field errors. Router/secret mocks per existing conventions.
- **Gates:** `npm run type-check` (TanStack route codegen — not bare tsc), lint, build, `check:esm` (new server files need `.js` imports), full unit + integration green.

---

## 9. Scope boundaries

**Explicitly OUT of B1:**
- Real staff/brand auth & per-workspace roles (B3) — stays on shared secret; `created_by` stays null on all B1-authored missions.
- Creating/editing workspaces/brands — pick from existing only.
- Brand-scoped review re-scoping (B2), dashboard/analytics (B4), billing (B5).
- Mission cover-image/asset upload (not in current schema).
- A rich chip/tag array editor for deliverables/requirements/platforms (newline textareas in B1).
- Hard delete of Active/Closed missions (only zero-submission **Drafts** are deletable); no reopen of Closed.
- Scheduled auto-publish — publish is a manual action.

**Forward hooks baked in for self-serve (B3):** `created_by` column; the already-isolated admin gate (swap secret→JWT/role later with no route rewrites); workspace-param'd queries (`?workspace=`).

---

## 10. Deploy ordering (from prior incidents)

Apply migration `0018` to **prod first** (Supabase; confirm tracker ordering per §3), then deploy via **Git** (never local `vercel --prod` — it mis-bundles the API). The new status values + visibility guards (incl. `copilot.ts`) + endpoints must not ship ahead of the schema, or `/admin/missions` and creator reads break.

---

## Appendix — adversarial review disposition (2026-06-22)

A 5-lens adversarial review (completeness, consistency, codebase-grounding, scope, ambiguity) + synthesis ran against the draft spec (34 raw findings: 1 critical, 11 high). Incorporated above: **must-fix** — copilot.ts visibility leak (critical), corrected assistant-tool row, level set L0..L6, draft-mode `mission_type` required; **should-fix** — `hasEngagement` excludes terminal states, slug/mission_type frozen-at-publish, error-body shape pinned, category single-source, reward-threshold typo, HK-timezone `today` injection, server-side level-constant duplication, migration-comment correction; **optional** — Closed/Draft edit & delete behavior, admin list sort, `effort` enum, off-type reward nulling, empty-slug contract, workspaces-returns-all, migration naming, newline-textarea array inputs, `created_by` permanent-null honesty.
