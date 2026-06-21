# Brand/Advertiser Side — Slice B1: Mission Authoring (Design)

**Date:** 2026-06-22
**Status:** Design approved (brainstorming) — pending spec review → implementation plan
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
An operator can, entirely in-app: pick a brand workspace, create a mission as a Draft, edit it freely, publish it live to creators, and close it — with economic terms protected once creators engage, and with Drafts/Closed missions never leaking to creators.

---

## 2. Architecture decisions (locked during brainstorming)

1. **Authoring home:** a new **"Missions" tab in `/admin`** (alongside Applications/Engaged/Submissions/Creators). Stays behind the existing `x-admin-secret` gate for now.
2. **Workspace scope:** **pick from existing workspaces** via a dropdown. Creating/onboarding new brand workspaces is out of B1.
3. **Lifecycle:** **Draft → Active → Closed.** Draft is hidden from creators; Publish makes it live; Close stops new joins (existing participations stay reviewable).
4. **Edit safety:** Draft & Active-but-empty = fully editable. Once **engaged** (a creator has joined/applied/submitted): **lock economic terms** (`points_reward`, `cash_reward`, `cpm_rate`, `cpm_budget_pool`, `mission_type`, `access_type`, `required_level`); quota can only increase (≥ `filled`); deadline can only extend; brief/description stay editable.
5. **Write path (Approach 1):** thin secret-gated admin REST routes (`serviceClient`) + a **pure `server/lib/missionAuthoring.ts`** module holding slug/validation/field-lock logic (mirrors `missionMatch.ts`/`hookGen.ts`). Lifecycle transitions are plain status updates — no RPCs (the existing RPCs solve `auth.uid`-scoped concurrency B1 doesn't have, and PL/pgSQL validation is hard to test).

---

## 3. Data model — migration `0018_mission_authoring.sql`

`missions.status` is currently free `text not null default 'active'` with **no** check constraint. All existing rows are `'active'`.

```sql
-- Lifecycle constraint (matches codebase convention: every other status col has a CHECK)
alter table public.missions
  add constraint missions_status_chk check (status in ('draft','active','closed'));

-- Authoring / audit columns
alter table public.missions
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists published_at timestamptz,
  add column if not exists closed_at    timestamptz,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;
```

- `created_by` = **self-serve forward hook** (B3). Nullable now (the secret-gated operator has no `auth.uid`), populated once real staff/brand accounts land.
- `updated_at` is set by the PATCH handler on each edit; `published_at`/`closed_at` set on their transitions.
- Operator writes use `serviceClient` (bypasses RLS) → **no new RLS policy** for authoring. New columns inherit existing `missions` grants. Creator reads keep their existing workspace-scoped RLS; status filtering is enforced at the API layer (§5).

---

## 4. Server API — secret-gated admin endpoints

Mounted under `/admin` with the existing `x-admin-secret` middleware and `serviceClient`. New file `server/routes/adminMissions.ts` (or extend `server/routes/admin.ts`), registered in `server/app.ts`. **All relative imports use the `.js` extension** (ESM rule).

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /admin/workspaces` | brand picker | `{ id, slug, name }[]` |
| `GET /admin/missions?workspace=&status=` | authoring list (all statuses) | each row annotated `engaged: boolean` + counts (`filled`, `quota`) for lock state; `status` optional (defaults to all) |
| `GET /admin/missions/:id` | full record for edit form | any status |
| `POST /admin/missions` | create **Draft** | body = mission fields + `workspace_id`; `validateMission(_, 'draft')`; slug-unique-per-workspace check; inserts `status='draft'` |
| `PATCH /admin/missions/:id` | edit | computes `hasEngagement`; `validateEdit(existing, patch, hasEngagement)`; sets `updated_at` |
| `POST /admin/missions/:id/publish` | Draft→Active | `validateMission(_, 'publish')` must pass; sets `status='active'`, `published_at=now()` |
| `POST /admin/missions/:id/close` | Active→Closed | sets `status='closed'`, `closed_at=now()` |

**Status codes:** `401 no_admin` (existing) · `404` not found · `422` validation / locked-field errors (per-field messages: `{ error, code:'validation', fields: Record<field,msg> }`) · `409` invalid lifecycle transition (publish a non-draft; close a non-active).

**`hasEngagement(mission)`** = `filled > 0` **OR** any `mission_submissions` row exists for the mission (covers `applied` applications that don't bump `filled`). Computed in the route via a count query.

---

## 5. Visibility guards (load-bearing)

Introducing `draft`/`closed` is unsafe unless every creator-facing mission read filters to `active`. Audit result:

| Read path | Today | Change in B1 |
|---|---|---|
| `GET /missions` (creator list) | returns **all** statuses (no filter) | **add `.eq("status","active")`** |
| `GET /missions/:slug` (creator detail) | no status filter | **return 404 if `status != 'active'`** for the creator client |
| `server/lib/assistant/tools.ts` mission tool | returns all when no `status` arg | **default to `active`** |
| `/match` (`server/routes/match.ts:33`) | already `.eq("status","active")` ✅ | none |
| `server/routes/onboarding.ts:91` | already `.eq("status","active")` ✅ | none |
| join / apply / submit RPCs (`0005`/`0010`/`0017`) | already `if m.status <> 'active' then raise 'closed'` ✅ | none — **Close auto-blocks new joins for free** |

The new **operator** endpoints are the only place that may read/write non-active missions. (Optional defense-in-depth: add `status='active'` to the creator `missions` SELECT RLS policy — decided during planning after inspecting the exact policy; API guards are the primary mechanism.)

---

## 6. Pure module — `server/lib/missionAuthoring.ts`

Pure (no DB), unit-tested, server-side source of truth.

- **`isValidSlug(slug): boolean`** — `^[a-z0-9][a-z0-9-]*$`. (Titles are zh-HK, so slug is an operator-entered english identifier, not derived from the title.)
- **`suggestSlug(missionType): string`** — kebab default from the mission type for the create form (operator can override). Uniqueness-per-workspace is a DB check in the route, not here.
- **`validateMission(input, mode): { ok, errors: Record<field,string> }`**
  - `mode:'draft'` — lenient: `workspace_id`, `title`, valid `slug`.
  - `mode:'publish'` — strict, additionally: `category`, `mission_type`, `access_type ∈ {open,application}`, `required_level ∈ {L0,L1,L2,L3,L4}`, `quota ≥ 1`, `deadline ≥ today`, non-empty `description`, **and reward-by-type**:
    | mission_type | required reward |
    |---|---|
    | `koc_trial`, `ugc`, `clipping`, `brand_ambassador` | `points_reward > 0` and/or `cash_reward > 0` |
    | `performance_cpm` | `cpm_rate > 0` **and** `cpm_budget_pool > 0` |
    | `affiliate`, `live_commerce` | `points_reward` and/or `cash_reward > 0` |
- **`validateEdit(existing, patch, hasEngagement): { ok, errors }`** — if `!hasEngagement`, nothing locked (even when Active-but-empty). If `hasEngagement`: reject any change to the locked set (`points_reward`, `cash_reward`, `cpm_rate`, `cpm_budget_pool`, `mission_type`, `access_type`, `required_level`); enforce `quota ≥ max(existing.quota, filled)`; enforce `deadline ≥ existing.deadline`.

`required_level` reuses the canonical level set from Slice 1's leveling (`L0..L4`).

---

## 7. Frontend — `/admin` Missions tab

- **Tab:** add "Missions" → `/admin/missions` in `src/components/admin/AdminTabs.tsx`.
- **List route** (`admin.missions`): workspace picker (`fetchWorkspaces`) + status filter (All/Draft/Active/Closed) + **"New mission"** button. Rows: title, slug, type badge, **status badge**, reward summary, `filled/quota`, deadline, **engaged** indicator. Row actions: **Edit**, **Publish** (drafts only), **Close** (active only).
- **Editor route** (`new` + `:id`, mirroring `operator.missions.$missionId`): four sections — **Basics** (workspace read-only on edit, title zh-HK, slug, category, `mission_type`, `access_type`, `required_level`), **Rewards** (conditional by `mission_type`: points/cash vs `cpm_rate`+`cpm_budget_pool`), **Logistics** (quota, deadline), **Brief** (description, deliverables[], requirements[], platforms[], effort).
- **`src/lib/admin.ts` additions** (extend `adminFetch` pattern): `fetchWorkspaces`, `fetchAdminMissions(workspace, status)`, `fetchAdminMission(id)`, `createMission(body)`, `updateMission(id, patch)`, `publishMission(id)`, `closeMission(id)` + `AdminMissionRow`/`MissionDraftInput` types.
- **Behaviour:** on edit when `engaged`, locked fields render **disabled with reason** ("Locked — creators have already engaged"); quota `min = filled`; deadline `min = current`. **Save** = create/update draft; **Publish**/**Close** are consequential → confirm dialog. Server `422` → per-field errors; `409` → transition-error toast. Form chrome follows existing internal `/admin` convention; mission **content** fields are free-text zh-HK.

---

## 8. Testing

- **Unit — `server/lib/missionAuthoring.test.ts`:** `isValidSlug`/`suggestSlug`; `validateMission` draft-vs-publish over the full reward-by-type matrix, level/deadline/quota rules; `validateEdit` locked-field rejection per field, quota-only-increase (≥ `filled`), deadline-only-extend, no-engagement = nothing locked.
- **Integration — `server/test/missionAuthoring.test.ts`** (local stack): create draft → in admin list, **not** in creator `GET /missions`; publish → visible; publish-missing-fields → 422; publish non-draft / close non-active → 409; edit locked field after a join → 422, edit brief after a join → 200; quota-below-filled → 422; slug collision per workspace → 422; **visibility guards** (draft not listed/joinable/detail-404; closed not joinable; assistant tool excludes drafts); `?workspace=` scoping.
- **Frontend route tests** (like `admin.applications.test.tsx`): list + filter + New routing; editor conditional reward fields; disabled locked fields on engaged edit; 422 → per-field errors. Router/secret mocks per existing conventions.
- **Gates:** `npm run type-check` (TanStack route codegen — not bare tsc), lint, build, `check:esm` (new server files need `.js` imports), full unit + integration green.

---

## 9. Scope boundaries

**Explicitly OUT of B1:**
- Real staff/brand auth & per-workspace roles (B3) — stays on shared secret; `created_by` left null.
- Creating/editing workspaces/brands — pick from existing only.
- Brand-scoped review re-scoping (B2), dashboard/analytics (B4), billing (B5).
- Mission cover-image/asset upload (not in current schema).
- Hard delete — missions are closed, never deleted (referential integrity with `mission_submissions`).
- Scheduled auto-publish — publish is a manual action.

**Forward hooks baked in for self-serve (B3):** `created_by` column; the already-isolated admin gate (swap secret→JWT/role later with no route rewrites); workspace-param'd queries (`?workspace=`).

---

## 10. Deploy ordering (from prior incidents)

Apply migration `0018` to **prod first** (Supabase), then deploy via **Git** (never local `vercel --prod` — it mis-bundles the API). The new status values + visibility guards + endpoints must not ship ahead of the schema, or `/admin/missions` and creator reads break.
