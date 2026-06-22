# B2 — Richer Authoring + Workspace-Scoped Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Fimmick/Adfocate staff a richer mission-authoring brief (audience, do's/don'ts, key messages, reference links) with chip editors, draft preview, and mission duplication; then a global workspace switcher that scopes every `/admin` tab plus a per-mission "Manage" drill-in to run a mission end-to-end.

**Architecture:** Two build phases in one slice. Phase 1 adds five additive columns to `missions` (migration `0019`), extends the pure `missionAuthoring` validators + a new `nextDuplicateSlug` helper, adds a `POST …/duplicate` endpoint, and rebuilds the editor with a reusable `ArrayInput` chip component + a draft preview that reuses the creator-facing `MissionBrief`. Phase 2 adds an `?workspace=` filter to the three cross-workspace review endpoints, a `useAdminWorkspace` context + `WorkspaceSwitcher`, and a `GET …/:id/activity` endpoint (pure `shapeMissionActivity` shaper) powering a Manage tab with act-in-place accept/decline/approve/reject. Workspace scoping is **convenience filtering only** — the shared `ADMIN_SECRET` still authorizes all workspaces; real per-workspace auth is B3.

**Tech Stack:** React 19 + TanStack Router/Query, Hono server, Supabase (Postgres + RLS), Vitest + React Testing Library, Vite. ESM with `.js` extensions on relative server imports.

**Spec:** [`docs/superpowers/specs/2026-06-22-brand-b2-richer-authoring-scoped-review-design.md`](../specs/2026-06-22-brand-b2-richer-authoring-scoped-review-design.md)

---

## Pre-flight (before Task 1)

- [ ] **Branch off updated `main`.** The current working branch is `feat/brand-mission-authoring` (B1, locally unmerged). Fetch, confirm B1 (PR #35) is in `origin/main`, then branch B2 off it. Move the uncommitted spec file along.

```bash
cd "/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2"
git stash push -- docs/superpowers/specs/2026-06-22-brand-b2-richer-authoring-scoped-review-design.md docs/superpowers/plans/2026-06-22-brand-b2-richer-authoring-scoped-review.md 2>/dev/null || true
git fetch origin
git checkout main && git pull origin main
git log --oneline -3   # expect the B1 mission-authoring merge present
git checkout -b feat/brand-b2-richer-authoring-scoped-review
git stash pop 2>/dev/null || true
git add docs/superpowers/specs/2026-06-22-brand-b2-richer-authoring-scoped-review-design.md docs/superpowers/plans/2026-06-22-brand-b2-richer-authoring-scoped-review.md
git commit -m "docs(brand): B2 design spec + implementation plan"
```

- [ ] **Confirm local stack + env for integration tests.** Integration tests skip silently without Supabase env. Confirm `.env.test.local` exists (local Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_SECRET`). Run `supabase start` if using the local stack. Export it into the shell before running integration tests, e.g. `set -a; . ./.env.test.local; set +a`.

---

## File Structure

**New files**
| Path | Responsibility |
|------|----------------|
| `supabase/migrations/0019_mission_brief_rich.sql` | Add 5 additive brief columns to `missions`. |
| `server/lib/missionActivity.ts` | Pure `shapeMissionActivity` — bucket one mission's submissions into applicants/submissions/engaged + fill. |
| `server/lib/missionActivity.test.ts` | Unit tests for the shaper. |
| `src/components/admin/ArrayInput.tsx` | Reusable chip add/remove input (Enter/comma to add, × to remove). |
| `src/components/admin/ArrayInput.test.tsx` | Unit test for ArrayInput. |
| `src/components/admin/PlatformPicker.tsx` | Known-set platform toggles + custom-add (writes `string[]`). |
| `src/components/admin/AdminWorkspaceContext.tsx` | `useAdminWorkspace` — selected workspace, backed by `?ws=` + sessionStorage. |
| `src/components/admin/WorkspaceSwitcher.tsx` | Header `<select>` bound to `useAdminWorkspace`. |
| `src/components/admin/WorkspaceSwitcher.test.tsx` | Unit test for the switcher + context. |
| `src/components/admin/MissionManage.tsx` | Manage-tab drill-in: applicants/submissions/engaged with act-in-place actions. |

**Modified files**
| Path | Change |
|------|--------|
| `server/lib/missionAuthoring.ts` | +5 fields on `MissionInput`/`MissionRecord`; brief normalize + validate helpers; `nextDuplicateSlug`. |
| `server/routes/adminMissions.ts` | +5 cols in `MISSION_COLS`/`EDITABLE_COLS`/insert; normalize on write; `POST …/duplicate`; `GET …/:id/activity`. |
| `server/routes/admin.ts` | `?workspace=` filter on `/applications`, `/engaged`, `/submissions`. |
| `server/lib/operatorCrm/repo.ts` | `workspace` on `CreatorQueueFilters` + `.eq("workspace_id", …)`. |
| `server/routes/adminOperatorCrm.ts` | Read `?workspace=` for the creators-review queue. |
| `src/lib/admin.ts` | +5 fields on `AdminMission`/`MissionDraftInput`; `duplicateMission`; `fetchMissionActivity`; workspace-aware fetchers + query keys. |
| `src/lib/queries/kocmax.ts` | +5 fields on frontend `Mission` type. |
| `src/lib/i18n.dict.ts` | +5 `app.mission.brief*` label keys (en + zh). |
| `src/components/MissionBrief.tsx` | Render the 5 new sections (only when populated). |
| `src/components/admin/MissionEditor.tsx` | ArrayInput swap, PlatformPicker, target_audience, draft preview. |
| `src/components/admin/AdminTabs.tsx` | Workspace-aware count queries. |
| `src/routes/admin.tsx` | Wrap in `AdminWorkspaceProvider`; mount `WorkspaceSwitcher`. |
| `src/routes/admin.missions.index.tsx` | 複製 (duplicate) row action; workspace-scoped list. |
| `src/routes/admin.missions.$missionId.tsx` | 編輯/管理 tab toggle (`?tab=manage`). |
| `src/routes/admin.applications.tsx`, `admin.engaged.tsx`, `admin.submissions.tsx`, `admin.creators.tsx` | Pass selected workspace to fetchers/keys. |

**Tests modified:** `server/lib/missionAuthoring.test.ts`, `server/test/missionAuthoring.test.ts`, `server/test/admin.test.ts`, `src/components/-MissionBrief.test.tsx`, `src/routes/-admin.missions.editor.test.tsx`, `src/routes/-admin.missions.index.test.tsx`.

---

# PHASE 1 — Richer Authoring

## Task 1: Migration `0019_mission_brief_rich.sql`

**Files:**
- Create: `supabase/migrations/0019_mission_brief_rich.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0019_mission_brief_rich.sql
-- Slice B2: richer mission brief. Additive, nullable-or-defaulted.
-- Existing table-level grants (0004) + RLS policy (0002, missions_workspace) cover new columns,
-- so no grant/RLS change is needed for creators (role `authenticated`) to read these.
alter table public.missions
  add column target_audience text,
  add column dos             text[] not null default '{}',
  add column donts           text[] not null default '{}',
  add column key_messages    text[] not null default '{}',
  add column reference_links text[] not null default '{}';
```

- [ ] **Step 2: Apply to the local stack**

Run:
```bash
supabase db reset   # or: psql "$SUPABASE_DB_URL" -f supabase/migrations/0019_mission_brief_rich.sql
```
Expected: migration applies cleanly; `missions` now has the 5 new columns.

- [ ] **Step 3: Verify columns exist**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "\d public.missions" | grep -E 'target_audience|dos|donts|key_messages|reference_links'
```
Expected: five rows listed (`target_audience text`, `dos text[]`, `donts text[]`, `key_messages text[]`, `reference_links text[]`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0019_mission_brief_rich.sql
git commit -m "feat(brand): migration 0019 — richer mission brief columns"
```

> **Production note (do NOT do during dev — record for the deploy runbook):** Apply `0019` to prod **before** deploying the code that selects the new columns, then run `notify pgrst, 'reload schema';` so PostgREST refreshes its cache. Skipping the reload caused a brief outage in a prior slice.

---

## Task 2: Brief fields — types, normalization, validation (pure, TDD)

**Files:**
- Modify: `server/lib/missionAuthoring.ts`
- Test: `server/lib/missionAuthoring.test.ts`

Reuses `normalizePortfolioUrl` (throws `ProfileMediaError` on bad/non-http(s) URL) from `server/lib/profileMedia/service.ts`. That module only imports `node:crypto` + pure `./types.js`, and `missionAuthoring.ts` is server-only (imported solely by `server/routes/adminMissions.ts`), so the import never reaches the browser bundle.

**Decision (resolves a spec ambiguity):** trim + drop-empty + cap-count-to-12 are **silent normalization** (applied on write); per-item length > 200 and bad `reference_links` URLs are **errors** (422). `target_audience` empty → `null`; length > 500 → error (never silently truncated — silent data loss is worse than a clear error).

- [ ] **Step 1: Write failing unit tests**

Append to `server/lib/missionAuthoring.test.ts`:

```typescript
import {
  normBriefArray,
  normAudience,
  normalizeBrief,
} from "./missionAuthoring";

describe("brief normalization", () => {
  it("trims, drops empties, caps at 12 items", () => {
    const raw = ["  a ", "", "  ", ...Array.from({ length: 13 }, (_, i) => `x${i}`)];
    const out = normBriefArray(raw);
    expect(out[0]).toBe("a");
    expect(out).toHaveLength(12);
    expect(out.includes("")).toBe(false);
  });

  it("normAudience empties to null and trims", () => {
    expect(normAudience("   ")).toBeNull();
    expect(normAudience(null)).toBeNull();
    expect(normAudience("  hello ")).toBe("hello");
  });

  it("normalizeBrief returns the 5 cleaned fields", () => {
    const out = normalizeBrief({
      target_audience: "  20-30 urban  ",
      dos: [" be authentic ", ""],
      donts: ["no profanity"],
      key_messages: ["fresh", "  fast "],
      reference_links: [" https://ex.com/a ", ""],
    });
    expect(out).toEqual({
      target_audience: "20-30 urban",
      dos: ["be authentic"],
      donts: ["no profanity"],
      key_messages: ["fresh", "fast"],
      reference_links: ["https://ex.com/a"],
    });
  });
});

describe("validateMission — brief fields", () => {
  const base = {
    workspace_id: "w1", title: "T", slug: "ugc-1", mission_type: "ugc",
  };

  it("accepts missing brief fields at publish (they do not gate)", () => {
    const r = validateMission(
      { ...base, description: "d", category: "社交", access_type: "open", required_level: "L0",
        quota: 5, deadline: "2099-01-01", points_reward: 100 },
      "publish",
      "2026-06-22",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a reference_links entry that is not an http(s) URL", () => {
    const r = validateMission({ ...base, reference_links: ["not a url"] }, "draft");
    expect(r.ok).toBe(false);
    expect(r.errors.reference_links).toBeTruthy();
  });

  it("accepts a bare-domain reference link (normalizePortfolioUrl prepends https)", () => {
    const r = validateMission({ ...base, reference_links: ["example.com/post"] }, "draft");
    expect(r.errors.reference_links).toBeUndefined();
  });

  it("rejects a key_messages item longer than 200 chars", () => {
    const r = validateMission({ ...base, key_messages: ["x".repeat(201)] }, "draft");
    expect(r.errors.key_messages).toBeTruthy();
  });

  it("rejects target_audience longer than 500 chars", () => {
    const r = validateMission({ ...base, target_audience: "x".repeat(501) }, "draft");
    expect(r.errors.target_audience).toBeTruthy();
  });
});

describe("validateEdit — brief fields", () => {
  const existing = { status: "active" as const, slug: "ugc-1", mission_type: "ugc" };
  it("allows editing brief fields after publish", () => {
    const r = validateEdit(existing, { key_messages: ["new point"] }, false);
    expect(r.ok).toBe(true);
  });
  it("flags a bad reference link in a patch", () => {
    const r = validateEdit(existing, { reference_links: ["javascript:alert(1)"] }, false);
    expect(r.ok).toBe(false);
    expect(r.errors.reference_links).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run server/lib/missionAuthoring.test.ts`
Expected: FAIL — `normBriefArray`/`normAudience`/`normalizeBrief` not exported; brief errors absent.

- [ ] **Step 3: Implement**

At the **top** of `server/lib/missionAuthoring.ts`, add the import (this is now the file's only import):

```typescript
import { normalizePortfolioUrl } from "./profileMedia/service.js";
```

After the existing constants block, add:

```typescript
export const MAX_BRIEF_ITEMS = 12;
export const MAX_BRIEF_ITEM_LEN = 200;
export const MAX_AUDIENCE_LEN = 500;

export function normBriefArray(items: string[] | null | undefined): string[] {
  return (items ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_BRIEF_ITEMS);
}

export function normAudience(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

export function normalizeBrief(input: MissionInput): {
  target_audience: string | null;
  dos: string[];
  donts: string[];
  key_messages: string[];
  reference_links: string[];
} {
  return {
    target_audience: normAudience(input.target_audience),
    dos: normBriefArray(input.dos),
    donts: normBriefArray(input.donts),
    key_messages: normBriefArray(input.key_messages),
    reference_links: normBriefArray(input.reference_links),
  };
}

// Errors only on PRESENT + invalid brief fields. Absent fields never error (they enrich, not gate).
function briefErrors(input: MissionInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const has = (k: keyof MissionInput) => Object.prototype.hasOwnProperty.call(input, k);

  if (has("target_audience")) {
    const aud = normAudience(input.target_audience);
    if (aud && aud.length > MAX_AUDIENCE_LEN) errors.target_audience = `目標受眾不可超過 ${MAX_AUDIENCE_LEN} 字`;
  }
  for (const f of ["dos", "donts", "key_messages"] as const) {
    if (has(f)) {
      const items = normBriefArray(input[f]);
      if (items.some((x) => x.length > MAX_BRIEF_ITEM_LEN)) errors[f] = `每項不可超過 ${MAX_BRIEF_ITEM_LEN} 字`;
    }
  }
  if (has("reference_links")) {
    const items = normBriefArray(input.reference_links);
    for (const link of items) {
      if (link.length > MAX_BRIEF_ITEM_LEN) { errors.reference_links = `每項不可超過 ${MAX_BRIEF_ITEM_LEN} 字`; break; }
      try { normalizePortfolioUrl(link); } catch { errors.reference_links = "請輸入有效的網址（http 或 https）"; break; }
    }
  }
  return errors;
}
```

Extend the `MissionInput` type with the 5 fields (after `effort`):

```typescript
  effort?: string | null;
  target_audience?: string | null;
  dos?: string[];
  donts?: string[];
  key_messages?: string[];
  reference_links?: string[];
```

In `validateMission`, just before `return { ok: ..., errors };`, merge brief errors:

```typescript
  Object.assign(errors, briefErrors(input));

  return { ok: Object.keys(errors).length === 0, errors };
```

In `validateEdit`, likewise just before its `return`:

```typescript
  Object.assign(errors, briefErrors(patch));

  return { ok: Object.keys(errors).length === 0, errors };
```

(`MissionRecord = MissionInput & {...}` already inherits the new fields — no separate edit needed.)

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run server/lib/missionAuthoring.test.ts`
Expected: PASS (all existing + new tests green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionAuthoring.ts server/lib/missionAuthoring.test.ts
git commit -m "feat(brand): brief field types, normalization, validation (B2 phase 1)"
```

---

## Task 3: `nextDuplicateSlug` helper (pure, TDD)

**Files:**
- Modify: `server/lib/missionAuthoring.ts`
- Test: `server/lib/missionAuthoring.test.ts`

- [ ] **Step 1: Write failing unit tests**

Append to `server/lib/missionAuthoring.test.ts`:

```typescript
import { nextDuplicateSlug } from "./missionAuthoring";

describe("nextDuplicateSlug", () => {
  it("appends -copy when free", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1"])).toBe("ugc-1-copy");
  });
  it("appends -copy-2 when -copy is taken", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1", "ugc-1-copy"])).toBe("ugc-1-copy-2");
  });
  it("finds the first free suffix among many collisions", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1-copy", "ugc-1-copy-2", "ugc-1-copy-3"])).toBe("ugc-1-copy-4");
  });
  it("treats the slug set as workspace-local (only what is passed in)", () => {
    expect(nextDuplicateSlug("ugc-1", [])).toBe("ugc-1-copy");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run server/lib/missionAuthoring.test.ts -t nextDuplicateSlug`
Expected: FAIL — `nextDuplicateSlug` not exported.

- [ ] **Step 3: Implement** — add to `server/lib/missionAuthoring.ts`:

```typescript
/** First free `<base>-copy`, `<base>-copy-2`, … given the slugs already used in the TARGET workspace. */
export function nextDuplicateSlug(base: string, existingSlugs: string[]): string {
  const used = new Set(existingSlugs);
  const first = `${base}-copy`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${base}-copy-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run server/lib/missionAuthoring.test.ts -t nextDuplicateSlug`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionAuthoring.ts server/lib/missionAuthoring.test.ts
git commit -m "feat(brand): nextDuplicateSlug helper (B2 phase 1)"
```

---

## Task 4: Backend endpoints — brief columns, normalize on write, duplicate

**Files:**
- Modify: `server/routes/adminMissions.ts`
- Test: `server/test/missionAuthoring.test.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `server/test/missionAuthoring.test.ts` (uses the file's existing `adminreq`/seed helpers — match the patterns already in that file; the snippets below assume an `adminreq(path, init)` that sets `x-admin-secret`, and a way to create a workspace/mission — reuse what the file already defines):

```typescript
describe("B2: brief fields round-trip + duplicate", () => {
  it("creates a draft with brief fields and reads them back", async () => {
    const create = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-brief", title: "Brief", mission_type: "ugc",
        target_audience: "  20-30 城市女性 ",
        dos: [" 真實分享 ", ""],
        donts: ["唔可以講粗口"],
        key_messages: ["新精華", " 快速見效 "],
        reference_links: [" example.com/post ", ""],
      }),
    });
    expect(create.status).toBe(201);
    const { mission } = await create.json();
    expect(mission.target_audience).toBe("20-30 城市女性");
    expect(mission.dos).toEqual(["真實分享"]);
    expect(mission.key_messages).toEqual(["新精華", "快速見效"]);
    expect(mission.reference_links).toEqual(["https://example.com/post"]);
  });

  it("rejects a bad reference link with 422 + fields.reference_links", async () => {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-badlink", title: "X", mission_type: "ugc",
        reference_links: ["not a url"],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.fields.reference_links).toBeTruthy();
  });

  it("duplicates a mission into a -copy draft, copying brief fields", async () => {
    const src = await (await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-dup", title: "Dup me", mission_type: "ugc",
        key_messages: ["copy this"],
      }),
    })).json();

    const dup = await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" });
    expect(dup.status).toBe(201);
    const { mission } = await dup.json();
    expect(mission.id).not.toBe(src.mission.id);
    expect(mission.slug).toBe("test-b2-dup-copy");
    expect(mission.status).toBe("draft");
    expect(mission.filled).toBe(0);
    expect(mission.key_messages).toEqual(["copy this"]);
  });

  it("suffixes -copy-2 when -copy already exists", async () => {
    const src = await (await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: WORKSPACE_ID, slug: "test-b2-dup2", title: "D2", mission_type: "ugc" }),
    })).json();
    await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" }); // -copy
    const dup2 = await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" }); // -copy-2
    expect((await dup2.json()).mission.slug).toBe("test-b2-dup2-copy-2");
  });

  it("404s when duplicating a missing mission", async () => {
    const res = await adminreq("/admin/missions/00000000-0000-0000-0000-0000000000ff/duplicate", { method: "POST" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });
});
```

> If `server/test/missionAuthoring.test.ts` does not already define `WORKSPACE_ID` / `adminreq` / a workspace seed, add them mirroring `server/test/admin.test.ts` (`adminreq` with `x-admin-secret`, and the seeded demo workspace id `00000000-0000-0000-0000-0000000000aa`). Confirm by reading the file's existing top-of-file setup before writing.

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm run test:integration -- server/test/missionAuthoring.test.ts` (or `RUN_INTEGRATION=1 npx vitest run server/test/missionAuthoring.test.ts`)
Expected: FAIL — new columns not selected/inserted; `/duplicate` route 404 (handler missing).

- [ ] **Step 3: Implement — extend columns + normalize on write**

In `server/routes/adminMissions.ts`, update the imports line to also pull the normalizer + slug helper:

```typescript
import {
  type MissionInput, type MissionRecord, validateMission, validateEdit,
  normalizeBrief, nextDuplicateSlug,
} from "../lib/missionAuthoring.js";
```

Extend `MISSION_COLS` (append the 5 columns):

```typescript
const MISSION_COLS =
  "id, workspace_id, slug, title, description, category, mission_type, access_type, required_level, " +
  "points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota, filled, status, " +
  "deliverables, requirements, platforms, effort, " +
  "target_audience, dos, donts, key_messages, reference_links, " +
  "created_at, updated_at, published_at, closed_at";
```

Extend `EDITABLE_COLS`:

```typescript
const EDITABLE_COLS: (keyof MissionInput)[] = [
  "slug", "title", "description", "category", "mission_type", "access_type", "required_level",
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "deadline", "quota",
  "deliverables", "requirements", "platforms", "effort",
  "target_audience", "dos", "donts", "key_messages", "reference_links",
];
```

In `POST /missions`, replace the brief-array lines in the `insert` map so brief fields are normalized at write time. Change the existing line:

```typescript
    deliverables: body.deliverables ?? [], requirements: body.requirements ?? [], platforms: body.platforms ?? [],
    effort: body.effort ?? null, status: "draft",
```
to:
```typescript
    deliverables: body.deliverables ?? [], requirements: body.requirements ?? [], platforms: body.platforms ?? [],
    effort: body.effort ?? null, status: "draft",
    ...normalizeBrief(body),
```

In `PATCH /missions/:id`, after the existing loop that copies `EDITABLE_COLS` into `updates`, normalize any brief fields that were present in the patch (so stored values match validation):

```typescript
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = patch[k];

  // Normalize brief fields that were actually sent (don't resurrect absent ones).
  const briefDefaults = normalizeBrief(patch);
  for (const k of ["target_audience", "dos", "donts", "key_messages", "reference_links"] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = briefDefaults[k];
  }
```

- [ ] **Step 4: Implement — `POST /missions/:id/duplicate`**

Add this handler in `server/routes/adminMissions.ts` (after the `DELETE /missions/:id` handler, before the re-export block):

```typescript
adminMissionRoutes.post("/missions/:id/duplicate", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();

  // 1. Load source (any status).
  const { data: src, error: sErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
  if (!src) return c.json({ error: "not_found", code: "not_found" }, 404);
  const source = src as unknown as Record<string, unknown> & { workspace_id: string; slug: string };

  // 2. Resolve target workspace.
  const body = await c.req.json<{ workspace_id?: string }>().catch(() => ({}) as { workspace_id?: string });
  const targetWs = body.workspace_id ?? source.workspace_id;
  if (body.workspace_id) {
    const { data: ws, error: wErr } = await svc.from("workspaces").select("id").eq("id", body.workspace_id).maybeSingle();
    if (wErr) return c.json({ error: wErr.message, code: "db_error" }, 500);
    if (!ws) return c.json({ error: "not_found", code: "not_found" }, 404);
  }

  // Pure draft-builder from a source row + chosen slug.
  const draftFrom = (slug: string) => {
    const base: Record<string, unknown> = {};
    for (const k of EDITABLE_COLS) base[k] = source[k as string];
    return {
      ...base,
      workspace_id: targetWs,
      slug,
      status: "draft",
      filled: 0,
      published_at: null,
      closed_at: null,
      created_by: null,
    };
  };

  const fetchSlugs = async () => {
    const { data, error } = await svc.from("missions").select("slug").eq("workspace_id", targetWs);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.slug as string);
  };

  // 3-5. Compute slug, insert, retry once on a racy unique clash.
  try {
    let slug = nextDuplicateSlug(source.slug, await fetchSlugs());
    let ins = await svc.from("missions").insert(draftFrom(slug)).select(MISSION_COLS).single();
    if (ins.error?.code === "23505") {
      slug = nextDuplicateSlug(source.slug, await fetchSlugs());
      ins = await svc.from("missions").insert(draftFrom(slug)).select(MISSION_COLS).single();
    }
    if (ins.error?.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "無法產生唯一 slug，請稍後再試" } }, 422);
    }
    if (ins.error) return c.json({ error: ins.error.message, code: "db_error" }, 500);
    return c.json({ mission: ins.data }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "duplicate failed", code: "db_error" }, 500);
  }
});
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `npm run test:integration -- server/test/missionAuthoring.test.ts`
Expected: PASS (brief round-trip, bad-link 422, duplicate -copy/-copy-2, missing-source 404).

- [ ] **Step 6: Commit**

```bash
git add server/routes/adminMissions.ts server/test/missionAuthoring.test.ts
git commit -m "feat(brand): brief columns + normalize-on-write + duplicate endpoint (B2 phase 1)"
```

---

## Task 5: Frontend client — types, fetcher, duplicate key

**Files:**
- Modify: `src/lib/admin.ts`

- [ ] **Step 1: Extend `AdminMission`** — add the 5 fields after `effort`:

```typescript
  effort: "low" | "medium" | "high" | null;
  target_audience: string | null;
  dos: string[];
  donts: string[];
  key_messages: string[];
  reference_links: string[];
```

- [ ] **Step 2: Extend `MissionDraftInput`** — add after `effort`:

```typescript
  effort?: "low" | "medium" | "high" | null;
  target_audience?: string | null;
  dos?: string[];
  donts?: string[];
  key_messages?: string[];
  reference_links?: string[];
```

(`MissionPatch = Partial<MissionDraftInput>` inherits these.)

- [ ] **Step 3: Add the `duplicateMission` fetcher** — after `deleteMissionDraft`:

```typescript
export function duplicateMission(id: string, body?: { workspace_id?: string }) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/duplicate`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}
```

- [ ] **Step 4: Run the type-check**

Run: `npm run type-check`
Expected: PASS (no type errors; `MissionEditor`'s `MissionDraftInput` usage still compiles since the new fields are optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin.ts
git commit -m "feat(brand): AdminMission/MissionDraftInput brief fields + duplicateMission (B2 phase 1)"
```

---

## Task 6: `ArrayInput` chip component (TDD)

**Files:**
- Create: `src/components/admin/ArrayInput.tsx`
- Test: `src/components/admin/ArrayInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArrayInput } from "./ArrayInput";

describe("ArrayInput", () => {
  it("adds a chip on Enter and clears the input", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={[]} onChange={onChange} placeholder="add" />);
    const input = screen.getByPlaceholderText("add");
    fireEvent.change(input, { target: { value: "  hello " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["hello"]);
  });

  it("does not add empty/whitespace values", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={[]} onChange={onChange} placeholder="add" />);
    const input = screen.getByPlaceholderText("add");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a chip by index", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={["a", "b"]} onChange={onChange} placeholder="add" />);
    fireEvent.click(screen.getByLabelText("remove b"));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/components/admin/ArrayInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useState, type KeyboardEvent } from "react";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

/** Chip add/remove input. Enter or comma adds the trimmed entry; × removes by index. */
export function ArrayInput({ value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...value, v]);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-sm"
            >
              {item}
              <button
                type="button"
                aria-label={`remove ${item}`}
                className="font-bold"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/components/admin/ArrayInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/ArrayInput.tsx src/components/admin/ArrayInput.test.tsx
git commit -m "feat(brand): ArrayInput chip component (B2 phase 1)"
```

---

## Task 7: Creator-facing render — `Mission` type, `MissionBrief`, i18n

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/components/MissionBrief.tsx`
- Test: `src/components/-MissionBrief.test.tsx`

- [ ] **Step 1: Extend the frontend `Mission` type** in `src/lib/queries/kocmax.ts` (add after `effort`):

```typescript
  effort?: "low" | "medium" | "high" | null; brand?: string | null;
  target_audience?: string | null;
  dos?: string[]; donts?: string[]; key_messages?: string[]; reference_links?: string[];
```

- [ ] **Step 2: Add i18n keys** to `src/lib/i18n.dict.ts`.

In the **`en`** block, after `"app.mission.briefEffort": "Estimated Effort",`:

```typescript
"app.mission.briefAudience": "Target Audience",
"app.mission.briefDos": "Do's",
"app.mission.briefDonts": "Don'ts",
"app.mission.briefKeyMessages": "Key Messages",
"app.mission.briefReferences": "Reference & Assets",
```

In the **`zh`** block, after `"app.mission.briefEffort": "預計投入",`:

```typescript
"app.mission.briefAudience": "目標受眾",
"app.mission.briefDos": "建議做法",
"app.mission.briefDonts": "避免事項",
"app.mission.briefKeyMessages": "重點訊息",
"app.mission.briefReferences": "參考及素材",
```

- [ ] **Step 3: Write the failing test** — append to `src/components/-MissionBrief.test.tsx`:

```tsx
it("renders the new B2 brief sections only when populated", () => {
  render(<MissionBrief mission={{
    ...base,
    target_audience: "20-30 城市女性",
    dos: ["真實分享"],
    donts: ["避免誇大"],
    key_messages: ["新精華"],
    reference_links: ["https://example.com/post"],
  }} />);
  expect(screen.getByText("20-30 城市女性")).toBeInTheDocument();
  expect(screen.getByText("真實分享")).toBeInTheDocument();
  expect(screen.getByText("避免誇大")).toBeInTheDocument();
  expect(screen.getByText("新精華")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "https://example.com/post" });
  expect(link).toHaveAttribute("target", "_blank");
});

it("hides B2 brief sections when empty", () => {
  render(<MissionBrief mission={{ ...base, description: "d" }} />);
  expect(screen.queryByText("目標受眾")).not.toBeInTheDocument();
  expect(screen.queryByText("重點訊息")).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run test — verify it fails**

Run: `npx vitest run src/components/-MissionBrief.test.tsx`
Expected: FAIL — new sections not rendered; `hasAny` doesn't account for new fields.

- [ ] **Step 5: Implement** in `src/components/MissionBrief.tsx`.

Near the top where existing locals are derived (`deliverables`, `requirements`, `platforms`, `effortKey`), add normalized locals:

```typescript
  const dos = mission.dos ?? [];
  const donts = mission.donts ?? [];
  const keyMessages = mission.key_messages ?? [];
  const referenceLinks = mission.reference_links ?? [];
  const audience = mission.target_audience?.trim() || "";
```

Extend the `hasAny` guard to include the new fields:

```typescript
  const hasAny =
    !!mission.description || deliverables.length > 0 || requirements.length > 0 ||
    platforms.length > 0 || !!effortKey ||
    !!audience || dos.length > 0 || donts.length > 0 ||
    keyMessages.length > 0 || referenceLinks.length > 0;
```

Add the new sections inside the returned fragment (after the existing `effort` section, using the same `<Section>` wrapper the component already defines):

```tsx
      {audience && <Section title={t("app.mission.briefAudience")}>{audience}</Section>}
      {dos.length > 0 && (
        <Section title={t("app.mission.briefDos")}>
          <ul className="space-y-1">
            {dos.map((d, i) => <li key={i}>✓ {d}</li>)}
          </ul>
        </Section>
      )}
      {donts.length > 0 && (
        <Section title={t("app.mission.briefDonts")}>
          <ul className="space-y-1">
            {donts.map((d, i) => <li key={i}>✗ {d}</li>)}
          </ul>
        </Section>
      )}
      {keyMessages.length > 0 && (
        <Section title={t("app.mission.briefKeyMessages")}>
          <ul className="list-disc space-y-1 pl-4">
            {keyMessages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </Section>
      )}
      {referenceLinks.length > 0 && (
        <Section title={t("app.mission.briefReferences")}>
          <ul className="space-y-1">
            {referenceLinks.map((url, i) => (
              <li key={i}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
```

- [ ] **Step 6: Run test — verify it passes**

Run: `npx vitest run src/components/-MissionBrief.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/i18n.dict.ts src/components/MissionBrief.tsx src/components/-MissionBrief.test.tsx
git commit -m "feat(brand): render richer brief sections for creators (B2 phase 1)"
```

---

## Task 8: `PlatformPicker` (TDD)

**Files:**
- Create: `src/components/admin/PlatformPicker.tsx`
- Test: `src/components/admin/PlatformPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlatformPicker } from "./PlatformPicker";

describe("PlatformPicker", () => {
  it("toggles a known platform on", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /instagram/i }));
    expect(onChange).toHaveBeenCalledWith(["instagram"]);
  });

  it("toggles a known platform off when already selected", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={["instagram"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /instagram/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("adds a custom platform via the escape-hatch input", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("其他平台…");
    fireEvent.change(input, { target: { value: "threads" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["threads"]);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/components/admin/PlatformPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (reuses `ArrayInput` for custom entries):

```tsx
import { ArrayInput } from "./ArrayInput";

const KNOWN = ["xiaohongshu", "instagram", "tiktok", "youtube"] as const;

type Props = { value: string[]; onChange: (next: string[]) => void };

export function PlatformPicker({ value, onChange }: Props) {
  const toggle = (p: string) =>
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);

  const custom = value.filter((p) => !KNOWN.includes(p as (typeof KNOWN)[number]));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {KNOWN.map((p) => {
          const on = value.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={`rounded-full border-2 border-[var(--color-ink)] px-3 py-0.5 text-sm ${
                on ? "bg-[var(--color-acid)]" : "bg-white"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      <ArrayInput
        value={custom}
        onChange={(next) => onChange([...value.filter((p) => KNOWN.includes(p as (typeof KNOWN)[number])), ...next])}
        placeholder="其他平台…"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/components/admin/PlatformPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/PlatformPicker.tsx src/components/admin/PlatformPicker.test.tsx
git commit -m "feat(brand): PlatformPicker known-set + custom (B2 phase 1)"
```

---

## Task 9: MissionEditor — chip editors, platforms, audience, preview

**Files:**
- Modify: `src/components/admin/MissionEditor.tsx`
- Test: `src/routes/-admin.missions.editor.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/routes/-admin.missions.editor.test.tsx` (match the file's existing render harness for `MissionEditor`):

```tsx
it("submits brief fields as arrays and audience as text", async () => {
  const onSave = vi.fn().mockResolvedValue({});
  renderEditor({ mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave });

  fireEvent.change(screen.getByLabelText(/標題/), { target: { value: "T" } });
  fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: "ugc-1" } });

  // target audience
  fireEvent.change(screen.getByLabelText(/目標受眾/), { target: { value: "20-30" } });
  // key messages via ArrayInput
  const km = screen.getByPlaceholderText(/重點訊息/);
  fireEvent.change(km, { target: { value: "新精華" } });
  fireEvent.keyDown(km, { key: "Enter" });

  fireEvent.click(screen.getByRole("button", { name: /儲存草稿/ }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const body = onSave.mock.calls[0][0];
  expect(body.target_audience).toBe("20-30");
  expect(body.key_messages).toEqual(["新精華"]);
});

it("renders a preview of the brief from form state", () => {
  renderEditor({ mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave: vi.fn() });
  fireEvent.change(screen.getByLabelText(/目標受眾/), { target: { value: "受眾甲" } });
  fireEvent.click(screen.getByRole("button", { name: /預覽/ }));
  expect(screen.getByText("受眾甲")).toBeInTheDocument();
});
```

> If `renderEditor` doesn't exist in the test file, define it once at the top mirroring the existing render pattern (wrap `<MissionEditor {...props} />` in any provider it needs — it uses `useI18n`, so wrap with the app's i18n provider as other component tests do, or rely on the default-locale dict).

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/routes/-admin.missions.editor.test.tsx`
Expected: FAIL — no `目標受眾` field, no `預覽` button, brief arrays not in submit body.

- [ ] **Step 3: Implement — form state + imports**

In `src/components/admin/MissionEditor.tsx`, add imports:

```tsx
import { useState } from "react";
import { ArrayInput } from "./ArrayInput";
import { PlatformPicker } from "./PlatformPicker";
import { MissionBrief } from "@/components/MissionBrief";
import { MissionFacts } from "@/components/MissionFacts";
import type { Mission } from "@/lib/queries/kocmax";
```

Replace the array fields in the `useState` form initializer. Currently:

```tsx
  deliverables: toLines(initial?.deliverables),
  requirements: toLines(initial?.requirements),
  platforms: toLines(initial?.platforms),
  effort: initial?.effort ?? "",
```
becomes (arrays held as real arrays now, not newline strings):

```tsx
  deliverables: initial?.deliverables ?? [],
  requirements: initial?.requirements ?? [],
  platforms: initial?.platforms ?? [],
  effort: initial?.effort ?? "",
  target_audience: initial?.target_audience ?? "",
  dos: initial?.dos ?? [],
  donts: initial?.donts ?? [],
  key_messages: initial?.key_messages ?? [],
  reference_links: initial?.reference_links ?? [],
```

`toLines`/`fromLines` are no longer used for these fields — remove them if nothing else references them (keep `numOrNull`).

- [ ] **Step 4: Implement — the brief inputs (replace the description-section array textareas)**

In Section 4 ("簡介"), replace the three newline `<textarea>`s for `deliverables`/`requirements`/`platforms` and add the new fields. Use `ArrayInput`/`PlatformPicker` and a label/`id` so the tests' `getByLabelText` works:

```tsx
        <label className="block text-sm font-bold" htmlFor="m-deliverables">交付內容</label>
        <ArrayInput value={f.deliverables} onChange={(v) => setF({ ...f, deliverables: v })} placeholder="新增交付項目…" />

        <label className="block text-sm font-bold">注意事項 / 要求</label>
        <ArrayInput value={f.requirements} onChange={(v) => setF({ ...f, requirements: v })} placeholder="新增要求…" />

        <label className="block text-sm font-bold">發佈平台</label>
        <PlatformPicker value={f.platforms} onChange={(v) => setF({ ...f, platforms: v })} />

        <label className="block text-sm font-bold" htmlFor="m-audience">目標受眾</label>
        <textarea
          id="m-audience"
          aria-label="目標受眾"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm"
          rows={2}
          value={f.target_audience}
          onChange={(e) => setF({ ...f, target_audience: e.target.value })}
        />

        <label className="block text-sm font-bold">建議做法（Do's）</label>
        <ArrayInput value={f.dos} onChange={(v) => setF({ ...f, dos: v })} placeholder="新增建議做法…" />

        <label className="block text-sm font-bold">避免事項（Don'ts）</label>
        <ArrayInput value={f.donts} onChange={(v) => setF({ ...f, donts: v })} placeholder="新增避免事項…" />

        <label className="block text-sm font-bold">重點訊息</label>
        <ArrayInput value={f.key_messages} onChange={(v) => setF({ ...f, key_messages: v })} placeholder="重點訊息…" />

        <label className="block text-sm font-bold">參考及素材連結</label>
        <ArrayInput value={f.reference_links} onChange={(v) => setF({ ...f, reference_links: v })} placeholder="https://…" />
```

- [ ] **Step 5: Implement — submit body**

In `submit()`, the brief arrays are already arrays in state, so the body maps them directly. Replace the old `fromLines(...)` lines and append the new fields:

```tsx
    deliverables: f.deliverables,
    requirements: f.requirements,
    platforms: f.platforms,
    effort: (f.effort || null) as MissionDraftInput["effort"],
    target_audience: f.target_audience.trim() || null,
    dos: f.dos,
    donts: f.donts,
    key_messages: f.key_messages,
    reference_links: f.reference_links,
```

- [ ] **Step 6: Implement — draft preview**

Add preview state near the top of the component:

```tsx
  const [preview, setPreview] = useState(false);
```

Build a `Mission`-shaped object from form state (place above the return):

```tsx
  const previewMission: Mission = {
    id: initial?.id ?? "preview",
    slug: f.slug || "preview",
    title: f.title || "（未命名任務）",
    description: f.description || undefined,
    category: f.category || undefined,
    mission_type: f.mission_type,
    access_type: f.access_type,
    points_reward: Number(f.points_reward || 0),
    cash_reward: numOrNull(f.cash_reward),
    required_level: f.required_level,
    deliverables: f.deliverables,
    requirements: f.requirements,
    platforms: f.platforms,
    effort: (f.effort || null) as Mission["effort"],
    target_audience: f.target_audience.trim() || null,
    dos: f.dos,
    donts: f.donts,
    key_messages: f.key_messages,
    reference_links: f.reference_links,
    deadline: f.deadline || undefined,
    quota: Number(f.quota || 0),
    filled: initial?.filled ?? 0,
    status: initial?.status ?? "draft",
  };
```

Add a preview toggle button and the rendered brief just above the save button:

```tsx
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
        >
          {preview ? "隱藏預覽" : "預覽"}
        </button>
        {preview && (
          <div className="space-y-3 rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
            <MissionFacts mission={previewMission} />
            <MissionBrief mission={previewMission} />
          </div>
        )}
```

- [ ] **Step 7: Run test + type-check**

Run: `npx vitest run src/routes/-admin.missions.editor.test.tsx && npm run type-check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/MissionEditor.tsx src/routes/-admin.missions.editor.test.tsx
git commit -m "feat(brand): editor chip inputs, platform picker, audience, draft preview (B2 phase 1)"
```

---

## Task 10: Missions list — duplicate action

**Files:**
- Modify: `src/routes/admin.missions.index.tsx`
- Test: `src/routes/-admin.missions.index.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/routes/-admin.missions.index.test.tsx` (mock `duplicateMission` in the existing `vi.mock("@/lib/admin", …)`):

```tsx
it("duplicates a mission and navigates to the new draft's editor", async () => {
  h.fetchAdminMissions.mockResolvedValue({ missions: [
    { id: "m1", slug: "ugc-1", title: "M1", status: "active", workspace_id: "w1", engaged: false },
  ] });
  h.duplicateMission.mockResolvedValue({ mission: { id: "m2" } });
  renderList();
  await screen.findByText("M1");
  fireEvent.click(screen.getByRole("button", { name: /複製/ }));
  await waitFor(() => expect(h.duplicateMission).toHaveBeenCalledWith("m1"));
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ to: "/admin/missions/$missionId", params: { missionId: "m2" } }),
  ));
});
```

> Add `duplicateMission: vi.fn()` to the hoisted `h` object and to the `@/lib/admin` mock, and `navigate: vi.fn()` if not already mocked (mirror how the file mocks `useNavigate`).

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/routes/-admin.missions.index.test.tsx`
Expected: FAIL — no 複製 button.

- [ ] **Step 3: Implement** — in `src/routes/admin.missions.index.tsx`:

Add `duplicateMission` to the `@/lib/admin` import. Add a mutation alongside `publish`/`close`/`remove`:

```tsx
  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateMission(id),
    onSuccess: (res) => {
      invalidate();
      navigate({ to: "/admin/missions/$missionId", params: { missionId: res.mission.id } });
    },
    onError: onErr,
  });
```

In each mission row's action group, add a duplicate button:

```tsx
            <button
              type="button"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-sm font-bold"
              onClick={() => duplicate.mutate(m.id)}
              disabled={duplicate.isPending}
            >
              複製
            </button>
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/routes/-admin.missions.index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.missions.index.tsx src/routes/-admin.missions.index.test.tsx
git commit -m "feat(brand): duplicate-mission action on the missions list (B2 phase 1)"
```

---

## Phase 1 gate

- [ ] **Run all gates:**

```bash
npm run lint && npm run type-check && npm run test && npm run build
npm run test:integration -- server/test/missionAuthoring.test.ts
```
Expected: all green. `type-check` runs `tsr generate` first (route codegen) — required even though Phase 1 adds no new routes.

- [ ] **Manual smoke (optional):** `npm run dev`, open `/admin/missions/new`, fill brief fields, toggle 預覽, save, then 複製 from the list and confirm the new `-copy` draft opens.

---

# PHASE 2 — Workspace Scoping + Drill-in

## Task 11: `useAdminWorkspace` context + `WorkspaceSwitcher` (TDD)

**Files:**
- Create: `src/components/admin/AdminWorkspaceContext.tsx`
- Create: `src/components/admin/WorkspaceSwitcher.tsx`
- Test: `src/components/admin/WorkspaceSwitcher.test.tsx`

State model: selected workspace id (`""` = All). Source of truth on load = URL `?ws=`, fallback = `sessionStorage["adfocate_admin_workspace"]`. `setWorkspace` writes both sessionStorage and the URL via `history.replaceState` (framework-agnostic, jsdom-testable — avoids per-route TanStack search schemas).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchWorkspaces: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  fetchWorkspaces: h.fetchWorkspaces,
  adminMissionKeys: { workspaces: ["admin-workspaces"] },
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));

import { AdminWorkspaceProvider, useAdminWorkspace } from "./AdminWorkspaceContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function Probe() {
  const { workspace } = useAdminWorkspace();
  return <div data-testid="ws">{workspace || "ALL"}</div>;
}

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminWorkspaceProvider>
        <WorkspaceSwitcher />
        <Probe />
      </AdminWorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/admin/missions");
    h.fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: "w1", name: "Brand A" }, { id: "w2", name: "Brand B" }] });
  });

  it("defaults to All and persists a selection to sessionStorage + URL", async () => {
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("ALL");
    await screen.findByRole("option", { name: "Brand A" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "w1" } });
    expect(screen.getByTestId("ws").textContent).toBe("w1");
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe("w1");
    expect(new URLSearchParams(window.location.search).get("ws")).toBe("w1");
  });

  it("reads the initial selection from the URL", async () => {
    window.history.replaceState(null, "", "/admin/missions?ws=w2");
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("w2");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/components/admin/WorkspaceSwitcher.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the context** — `src/components/admin/AdminWorkspaceContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const SS_KEY = "adfocate_admin_workspace";

function initialWorkspace(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("ws");
  if (fromUrl !== null) return fromUrl;
  return window.sessionStorage.getItem(SS_KEY) ?? "";
}

type Ctx = { workspace: string; setWorkspace: (id: string) => void };
const AdminWorkspaceContext = createContext<Ctx | null>(null);

export function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<string>(initialWorkspace);

  const setWorkspace = useCallback((id: string) => {
    setWorkspaceState(id);
    if (typeof window === "undefined") return;
    if (id) window.sessionStorage.setItem(SS_KEY, id);
    else window.sessionStorage.removeItem(SS_KEY);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ws", id);
    else url.searchParams.delete("ws");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const value = useMemo(() => ({ workspace, setWorkspace }), [workspace, setWorkspace]);
  return <AdminWorkspaceContext.Provider value={value}>{children}</AdminWorkspaceContext.Provider>;
}

export function useAdminWorkspace(): Ctx {
  const ctx = useContext(AdminWorkspaceContext);
  if (!ctx) throw new Error("useAdminWorkspace must be used within AdminWorkspaceProvider");
  return ctx;
}
```

- [ ] **Step 4: Implement the switcher** — `src/components/admin/WorkspaceSwitcher.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, adminMissionKeys, AdminAuthError } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

export function WorkspaceSwitcher() {
  const { secret, reportAuthError } = useAdminAuth();
  const { workspace, setWorkspace } = useAdminWorkspace();
  const ws = useQuery({
    queryKey: adminMissionKeys.workspaces,
    queryFn: fetchWorkspaces,
    enabled: !!secret,
    retry: false,
  });
  if (ws.error instanceof AdminAuthError) reportAuthError(ws.error);

  return (
    <select
      aria-label="workspace"
      className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-sm"
      value={workspace}
      onChange={(e) => setWorkspace(e.target.value)}
    >
      <option value="">全部 / All workspaces</option>
      {(ws.data?.workspaces ?? []).map((w) => (
        <option key={w.id} value={w.id}>{w.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Run test — verify it passes**

Run: `npx vitest run src/components/admin/WorkspaceSwitcher.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AdminWorkspaceContext.tsx src/components/admin/WorkspaceSwitcher.tsx src/components/admin/WorkspaceSwitcher.test.tsx
git commit -m "feat(brand): workspace switcher + useAdminWorkspace context (B2 phase 2)"
```

---

## Task 12: Workspace-aware client fetchers + query keys

**Files:**
- Modify: `src/lib/admin.ts`

All four list fetchers take an optional `workspace`; an empty/absent workspace omits the param (preserving today's all-workspaces behavior). Query keys include the workspace so caches don't collide.

- [ ] **Step 1: Update `adminKeys`** to be workspace-scoped:

```typescript
export const adminKeys = {
  applications: (workspace: string) => ["admin-applications", workspace] as const,
  submissions: (status: string, workspace: string) => ["admin-submissions", status, workspace] as const,
  engaged: (workspace: string) => ["admin-engaged", workspace] as const,
};
```

- [ ] **Step 2: Update the list fetchers** to accept `workspace` and append `?workspace=`:

```typescript
function wsq(workspace?: string) {
  return workspace ? `workspace=${encodeURIComponent(workspace)}` : "";
}

export function fetchApplications(workspace = "") {
  const qs = wsq(workspace);
  return adminFetch<{ applications: Application[] }>(`/admin/applications${qs ? `?${qs}` : ""}`);
}

export function fetchSubmissions(status = "submitted", workspace = "") {
  const parts = [`status=${encodeURIComponent(status)}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ submissions: Submission[] }>(`/admin/submissions?${parts.join("&")}`);
}

export function fetchEngagedUsers(workspace = "") {
  const qs = wsq(workspace);
  return adminFetch<{ creators: EngagedCreator[] }>(`/admin/engaged${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 3: Update `CreatorReviewQueueFilters` + `fetchCreatorReviewQueue`** — add a `workspace` field and serialize it. Locate the existing `CreatorReviewQueueFilters` type and `fetchCreatorReviewQueue` (~line 204) and add:

```typescript
// in the CreatorReviewQueueFilters type:
  workspace?: string;
```
```typescript
// in fetchCreatorReviewQueue's query-string builder, add:
  if (filters.workspace) params.set("workspace", filters.workspace);
```

- [ ] **Step 4: Type-check + adjust callers**

Run: `npm run type-check`
Expected: FAIL initially — `adminKeys.applications` / `.submissions` / `.engaged` are now functions; `AdminTabs.tsx` and the tab routes call them as values/old signatures. Those callers are fixed in Tasks 13–14; this is expected. Re-run after Task 14.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin.ts
git commit -m "feat(brand): workspace-aware admin fetchers + query keys (B2 phase 2)"
```

---

## Task 13: Mount the switcher + wire the tabs to the workspace

**Files:**
- Modify: `src/routes/admin.tsx`
- Modify: `src/components/admin/AdminTabs.tsx`

- [ ] **Step 1: Wrap the shell + mount the switcher** in `src/routes/admin.tsx`.

Add imports:
```tsx
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";
import { WorkspaceSwitcher } from "@/components/admin/WorkspaceSwitcher";
```

Wrap the existing `AdminAuthContext.Provider` subtree in `<AdminWorkspaceProvider>`, and mount the switcher in the header. The header block becomes:

```tsx
      <AdminAuthContext.Provider value={{ secret, reportAuthError: setAuthError }}>
        <AdminWorkspaceProvider>
          <div className="mx-auto max-w-5xl space-y-4 p-4">
            <header className="flex items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
              <div>
                <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
                <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.subtitle")}</p>
              </div>
              <WorkspaceSwitcher />
            </header>
            <AdminTabs />
            <Outlet />
          </div>
        </AdminWorkspaceProvider>
      </AdminAuthContext.Provider>
```

- [ ] **Step 2: Make `AdminTabs` count queries workspace-aware** in `src/components/admin/AdminTabs.tsx`.

Add import + hook:
```tsx
import { useAdminWorkspace } from "./AdminWorkspaceContext";
```
```tsx
  const { workspace } = useAdminWorkspace();
```
Update the two count queries to pass the workspace and use the new key signatures:
```tsx
  const apps = useQuery({
    queryKey: adminKeys.applications(workspace),
    queryFn: () => fetchApplications(workspace),
    enabled: !!secret,
    retry: false,
  });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted", workspace),
    queryFn: () => fetchSubmissions("submitted", workspace),
    enabled: !!secret,
    retry: false,
  });
```

- [ ] **Step 3: Update the four tab routes** to consume the workspace. For each of `src/routes/admin.applications.tsx`, `admin.engaged.tsx`, `admin.submissions.tsx`, `admin.creators.tsx`:
  - Import `useAdminWorkspace`.
  - Read `const { workspace } = useAdminWorkspace();`.
  - Pass `workspace` to the fetcher and into the query key, e.g. for applications:
    ```tsx
    const q = useQuery({
      queryKey: adminKeys.applications(workspace),
      queryFn: () => fetchApplications(workspace),
      enabled: !!secret,
      retry: false,
    });
    ```
  - For submissions, thread it through the existing status state: `adminKeys.submissions(status, workspace)` + `fetchSubmissions(status, workspace)`.
  - For engaged: `adminKeys.engaged(workspace)` + `fetchEngagedUsers(workspace)`.
  - For creators: add `workspace` into the `CreatorReviewQueueFilters` passed to `fetchCreatorReviewQueue`, and include `workspace` in that route's query key array.

- [ ] **Step 4: Update existing tab route tests** (`-admin.applications.test.tsx`, `-admin.engaged.test.tsx`, `-admin.submissions.test.tsx`, `-admin.creators.test.tsx`). Each mocks `useAdminAuth`; add a mock for `useAdminWorkspace`:

```tsx
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));
```
And update any assertion that referenced the old `adminKeys` value shape (now functions). Run each and fix call signatures.

- [ ] **Step 5: Type-check + run the admin route tests**

Run: `npm run type-check && npx vitest run src/routes/-admin.applications.test.tsx src/routes/-admin.engaged.test.tsx src/routes/-admin.submissions.test.tsx src/routes/-admin.creators.test.tsx src/components/admin/WorkspaceSwitcher.test.tsx`
Expected: PASS (type-check now clean — all `adminKeys` callers updated).

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.tsx src/components/admin/AdminTabs.tsx src/routes/admin.applications.tsx src/routes/admin.engaged.tsx src/routes/admin.submissions.tsx src/routes/admin.creators.tsx src/routes/-admin.applications.test.tsx src/routes/-admin.engaged.test.tsx src/routes/-admin.submissions.test.tsx src/routes/-admin.creators.test.tsx
git commit -m "feat(brand): mount workspace switcher + scope all admin tabs (B2 phase 2)"
```

---

## Task 14: Backend `?workspace=` filtering

**Files:**
- Modify: `server/routes/admin.ts`
- Modify: `server/lib/operatorCrm/repo.ts`
- Modify: `server/routes/adminOperatorCrm.ts`
- Test: `server/test/admin.test.ts`

- [ ] **Step 1: Write failing integration tests** — append to `server/test/admin.test.ts` (reuse the file's `adminreq` + `makeMission`/`makeCreator`/`cleanup` helpers; seed a mission in a non-demo workspace if a second workspace is available, otherwise assert that the demo-workspace filter returns the seeded row and a bogus workspace returns none):

```typescript
describe("B2: workspace-scoped review", () => {
  it("filters applications by ?workspace= (demo workspace returns the row, bogus returns none)", async () => {
    // seed: a creator applies to a demo-workspace application mission
    const koc = await makeCreator("ws-scope@test.local", 0);
    await makeMission({ slug: "test-ws-scope", points_reward: 100, quota: 5, access_type: "application" });
    await koreq("/missions/test-ws-scope/apply", koc.jwt, { method: "POST" });

    const DEMO = "00000000-0000-0000-0000-0000000000aa";
    const scoped = await adminreq(`/admin/applications?workspace=${DEMO}`);
    expect(scoped.status).toBe(200);
    const rows = (await scoped.json()).applications as Array<{ missions: { slug: string } }>;
    expect(rows.some((r) => r.missions.slug === "test-ws-scope")).toBe(true);

    const none = await adminreq(`/admin/applications?workspace=00000000-0000-0000-0000-0000000000bb`);
    const noneRows = (await none.json()).applications as unknown[];
    expect(noneRows.length).toBe(0);
  });

  it("filters submissions by ?workspace=", async () => {
    const DEMO = "00000000-0000-0000-0000-0000000000aa";
    const none = await adminreq(`/admin/submissions?status=submitted&workspace=00000000-0000-0000-0000-0000000000bb`);
    expect((await none.json()).submissions.length).toBe(0);
    const all = await adminreq(`/admin/submissions?status=submitted&workspace=${DEMO}`);
    expect(all.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: FAIL — the bogus-workspace queries still return rows (no filter applied yet).

- [ ] **Step 3: Implement — `server/routes/admin.ts`.**

In `GET /applications`, read the param and apply the join filter:
```typescript
adminRoutes.get("/applications", async (c) => {
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select("id, mission_id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", "applied");
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("created_at", { ascending: true });
  // …unchanged enrich + return…
```

In `GET /submissions`, after building the base query:
```typescript
  const status = c.req.query("status") ?? "submitted";
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select("id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", status);
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("submitted_at", { ascending: true });
  // …unchanged enrich + return…
```

In `GET /engaged`:
```typescript
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select("id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)")
    .in("status", ["joined", "submitted", "under_review", "approved"]);
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("created_at", { ascending: true });
  // …unchanged shapeEngagedRoster + return…
```

- [ ] **Step 4: Implement — creators-review workspace filter.**

In `server/lib/operatorCrm/repo.ts`, add `workspace?: string;` to `CreatorQueueFilters`, and in `listCreatorReviewQueue` apply it to the `creators` query (where the other filters like `missionId` are applied):
```typescript
  if (filters.workspace) query = query.eq("workspace_id", filters.workspace);
```
> Verify the `creators` table has a `workspace_id` column before applying (it scopes creators per workspace in this codebase). If the column is named differently, match it.

In `server/routes/adminOperatorCrm.ts`, where the creators-review route builds its filters, read and pass the param:
```typescript
  const workspace = c.req.query("workspace") || undefined;
  // include `workspace` in the filters object passed to listCreatorReviewQueue(...)
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin.ts server/lib/operatorCrm/repo.ts server/routes/adminOperatorCrm.ts server/test/admin.test.ts
git commit -m "feat(brand): optional ?workspace= filter on review endpoints (B2 phase 2)"
```

---

## Task 15: `shapeMissionActivity` pure shaper (TDD)

**Files:**
- Create: `server/lib/missionActivity.ts`
- Test: `server/lib/missionActivity.test.ts`

Pure bucketing only — enrichment (async DB) stays in the route. Rows passed in are already enriched, so the shaper just buckets by status and computes fill.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { shapeMissionActivity, type MissionActivityRow } from "./missionActivity";

let n = 0;
function row(over: Partial<MissionActivityRow> & { status: string }): MissionActivityRow {
  return {
    id: over.id ?? `s${n++}`,
    mission_id: over.mission_id ?? "m1",
    creator_id: over.creator_id ?? "c1",
    status: over.status,
    content_urls: over.content_urls ?? null,
    submitted_at: over.submitted_at ?? null,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
    creators: over.creators ?? { display_name: "C" },
    missions: over.missions ?? { slug: "m1", title: "M1", points_reward: 100 },
    creator_review: over.creator_review ?? { status: "needs_review", risk_level: "unknown" },
    mission_shortlist: over.mission_shortlist ?? null,
  };
}

describe("shapeMissionActivity", () => {
  it("buckets by status and computes fill", () => {
    const out = shapeMissionActivity({ filled: 3, quota: 10 }, [
      row({ status: "applied" }),
      row({ status: "submitted" }),
      row({ status: "under_review" }),
      row({ status: "joined" }),
      row({ status: "approved" }),
    ]);
    expect(out.applicants).toHaveLength(1);
    expect(out.submissions).toHaveLength(2);
    expect(out.engaged).toHaveLength(2);
    expect(out.fill).toEqual({ filled: 3, quota: 10 });
  });

  it("handles an empty mission and null fill/quota", () => {
    const out = shapeMissionActivity({ filled: null, quota: null }, []);
    expect(out.applicants).toEqual([]);
    expect(out.submissions).toEqual([]);
    expect(out.engaged).toEqual([]);
    expect(out.fill).toEqual({ filled: 0, quota: 0 });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run server/lib/missionActivity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/lib/missionActivity.ts` (no relative imports; if any are added later they must carry `.js`):

```typescript
// server/lib/missionActivity.ts
// Pure shaper: bucket one mission's (already-enriched) submission rows for the Manage drill-in.

export type MissionActivityRow = {
  id: string;
  mission_id: string;
  creator_id: string;
  status: string;
  content_urls: string[] | null;
  submitted_at: string | null;
  created_at: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
  creator_review: { status: string; risk_level: string };
  mission_shortlist: { status: string } | null;
};

export type MissionActivity = {
  applicants: MissionActivityRow[];
  submissions: MissionActivityRow[];
  engaged: MissionActivityRow[];
  fill: { filled: number; quota: number };
};

export function shapeMissionActivity(
  mission: { filled: number | null; quota: number | null },
  rows: MissionActivityRow[],
): MissionActivity {
  return {
    applicants: rows.filter((r) => r.status === "applied"),
    submissions: rows.filter((r) => r.status === "submitted" || r.status === "under_review"),
    engaged: rows.filter((r) => r.status === "joined" || r.status === "approved"),
    fill: { filled: mission.filled ?? 0, quota: mission.quota ?? 0 },
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run server/lib/missionActivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionActivity.ts server/lib/missionActivity.test.ts
git commit -m "feat(brand): shapeMissionActivity pure shaper (B2 phase 2)"
```

---

## Task 16: `GET /admin/missions/:id/activity` endpoint

**Files:**
- Modify: `server/routes/adminMissions.ts`
- Test: `server/test/admin.test.ts`

- [ ] **Step 1: Write the failing integration test** — append to `server/test/admin.test.ts`:

```typescript
describe("B2: mission activity drill-in", () => {
  it("returns the mission + bucketed activity", async () => {
    const koc = await makeCreator("activity@test.local", 0);
    await makeMission({ slug: "test-activity", points_reward: 200, quota: 5 });
    // fetch the mission id via the admin list
    const list = await (await adminreq(`/admin/missions?workspace=00000000-0000-0000-0000-0000000000aa`)).json();
    const m = (list.missions as Array<{ id: string; slug: string }>).find((x) => x.slug === "test-activity")!;

    await koreq("/missions/test-activity/join", koc.jwt, { method: "POST" });
    await koreq("/missions/test-activity/submit", koc.jwt, {
      method: "PUT", body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });

    const res = await adminreq(`/admin/missions/${m.id}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mission.slug).toBe("test-activity");
    expect(body.submissions.length).toBe(1);
    expect(body.fill.quota).toBe(5);
  });

  it("404s for a missing mission", async () => {
    const res = await adminreq("/admin/missions/00000000-0000-0000-0000-0000000000ff/activity");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: FAIL — route 404 (handler missing).

- [ ] **Step 3: Implement** — in `server/routes/adminMissions.ts`.

Add imports:
```typescript
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { shapeMissionActivity, type MissionActivityRow } from "../lib/missionActivity.js";
```

Add the handler (after the duplicate handler, before the re-export block):
```typescript
adminMissionRoutes.get("/missions/:id/activity", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();

  const { data: mission, error: mErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!mission) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data: rows, error: rErr } = await svc
    .from("mission_submissions")
    .select("id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("mission_id", id)
    .order("created_at", { ascending: true });
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);

  try {
    const enriched = (await enrichAdminMissionRows(svc, rows ?? [])) as unknown as MissionActivityRow[];
    const m = mission as unknown as { filled: number | null; quota: number | null };
    return c.json({ mission, ...shapeMissionActivity(m, enriched) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich activity";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminMissions.ts server/test/admin.test.ts
git commit -m "feat(brand): GET /admin/missions/:id/activity endpoint (B2 phase 2)"
```

---

## Task 17: Client — activity fetcher + key

**Files:**
- Modify: `src/lib/admin.ts`

- [ ] **Step 1: Add the activity type, key, and fetcher.**

Add to `adminMissionKeys`:
```typescript
export const adminMissionKeys = {
  workspaces: ["admin-workspaces"] as const,
  list: (workspace: string, status: string) => ["admin-missions", workspace, status] as const,
  detail: (id: string) => ["admin-mission", id] as const,
  activity: (id: string) => ["admin-mission-activity", id] as const,
};
```

Add the response type + fetcher (place near `fetchAdminMission`):
```typescript
export type MissionActivityRow = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  status: string;
  content_urls: string[] | null;
  submitted_at: string | null;
  created_at: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
  creator_review: { status: AdminReviewStatus; risk_level: AdminRiskLevel };
  mission_shortlist: { status: string } | null;
};

export type MissionActivity = {
  mission: AdminMission;
  applicants: MissionActivityRow[];
  submissions: MissionActivityRow[];
  engaged: MissionActivityRow[];
  fill: { filled: number; quota: number };
};

export function fetchMissionActivity(id: string) {
  return adminFetch<MissionActivity>(`/admin/missions/${id}/activity`);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin.ts
git commit -m "feat(brand): fetchMissionActivity + activity query key (B2 phase 2)"
```

---

## Task 18: Manage tab UI + drill-in actions

**Files:**
- Create: `src/components/admin/MissionManage.tsx`
- Modify: `src/routes/admin.missions.$missionId.tsx`
- Test: `src/routes/-admin.missions.manage.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/routes/-admin.missions.manage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchMissionActivity: vi.fn(),
  acceptApplication: vi.fn(),
  declineApplication: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({
  fetchMissionActivity: h.fetchMissionActivity,
  acceptApplication: h.acceptApplication,
  declineApplication: h.declineApplication,
  approveSubmission: h.approveSubmission,
  rejectSubmission: h.rejectSubmission,
  adminMissionKeys: { activity: (id: string) => ["admin-mission-activity", id], detail: (id: string) => ["admin-mission", id] },
  adminKeys: { applications: (w: string) => ["admin-applications", w], submissions: (s: string, w: string) => ["admin-submissions", s, w], engaged: (w: string) => ["admin-engaged", w] },
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));

import { MissionManage } from "@/components/admin/MissionManage";

function r() {
  return render(<QueryClientProvider client={new QueryClient()}><MissionManage missionId="m1" /></QueryClientProvider>);
}

describe("MissionManage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchMissionActivity.mockResolvedValue({
      mission: { id: "m1", slug: "ugc-1", title: "M1", status: "active" },
      applicants: [{ id: "a1", status: "applied", creators: { display_name: "Amy" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      submissions: [{ id: "s1", status: "submitted", content_urls: ["https://x"], submitted_at: null, creators: { display_name: "Bob" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      engaged: [],
      fill: { filled: 1, quota: 5 },
    });
    h.acceptApplication.mockResolvedValue({});
    h.approveSubmission.mockResolvedValue({});
  });

  it("accepts an applicant in place", async () => {
    r();
    await screen.findByText("Amy");
    fireEvent.click(screen.getByRole("button", { name: /接受/ }));
    await waitFor(() => expect(h.acceptApplication).toHaveBeenCalledWith("a1"));
  });

  it("approves a submission in place", async () => {
    r();
    await screen.findByText("Bob");
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    await waitFor(() => expect(h.approveSubmission).toHaveBeenCalledWith("s1", expect.any(Object)));
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/routes/-admin.missions.manage.test.tsx`
Expected: FAIL — `MissionManage` not found.

- [ ] **Step 3: Implement `MissionManage`** — `src/components/admin/MissionManage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMissionActivity, acceptApplication, declineApplication, approveSubmission, rejectSubmission,
  adminMissionKeys, adminKeys, AdminAuthError, AdminRequestError,
} from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

export function MissionManage({ missionId }: { missionId: string }) {
  const { secret, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: adminMissionKeys.activity(missionId),
    queryFn: () => fetchMissionActivity(missionId),
    enabled: !!secret,
    retry: false,
  });
  if (q.error instanceof AdminAuthError) reportAuthError(q.error);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: adminMissionKeys.activity(missionId) });
    qc.invalidateQueries({ queryKey: adminMissionKeys.detail(missionId) });
    qc.invalidateQueries({ queryKey: adminKeys.applications(workspace) });
    qc.invalidateQueries({ queryKey: adminKeys.submissions("submitted", workspace) });
    qc.invalidateQueries({ queryKey: adminKeys.engaged(workspace) });
  };
  const onErr = (e: unknown) => {
    if (e instanceof AdminAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };

  const accept = useMutation({ mutationFn: (id: string) => acceptApplication(id), onSuccess: invalidate, onError: onErr });
  const decline = useMutation({ mutationFn: (id: string) => declineApplication(id), onSuccess: invalidate, onError: onErr });
  const approve = useMutation({ mutationFn: (id: string) => approveSubmission(id, {}), onSuccess: invalidate, onError: onErr });
  const reject = useMutation({ mutationFn: (id: string) => rejectSubmission(id), onSuccess: invalidate, onError: onErr });

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務活動。</p>;
  const a = q.data;

  const btn = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-0.5 text-sm font-bold";

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm">
        狀態：{a.mission.status} ・ 名額 {a.fill.filled}/{a.fill.quota}
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">申請者（{a.applicants.length}）</h2>
        {a.applicants.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
            <span>{row.creators.display_name}</span>
            <span className="flex gap-2">
              <button type="button" className={`${btn} bg-[var(--color-acid)]`} onClick={() => accept.mutate(row.id)} disabled={accept.isPending}>接受</button>
              <button type="button" className={`${btn} bg-white`} onClick={() => decline.mutate(row.id)} disabled={decline.isPending}>拒絕</button>
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">待審內容（{a.submissions.length}）</h2>
        {a.submissions.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
            <span>{row.creators.display_name}</span>
            <span className="flex gap-2">
              <button type="button" className={`${btn} bg-[var(--color-acid)]`} onClick={() => approve.mutate(row.id)} disabled={approve.isPending}>批准</button>
              <button type="button" className={`${btn} bg-white`} onClick={() => reject.mutate(row.id)} disabled={reject.isPending}>退回</button>
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">已參與（{a.engaged.length}）</h2>
        {a.engaged.map((row) => (
          <div key={row.id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm">
            {row.creators.display_name} ・ {row.status}
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add the tab toggle** to `src/routes/admin.missions.$missionId.tsx`.

Add imports + state (tab read from URL, reflected via `history.replaceState` — same pattern as the workspace context):
```tsx
import { useState } from "react";
import { MissionManage } from "@/components/admin/MissionManage";
```
Inside `EditMission`, after `const m = q.data.mission;`:
```tsx
  const [tab, setTab] = useState<"edit" | "manage">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "manage" ? "manage" : "edit",
  );
  const selectTab = (next: "edit" | "manage") => {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "manage") url.searchParams.set("tab", "manage");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };
```
Replace the returned `<MissionEditor … />` block with a tab header + conditional body:
```tsx
  const tabBtn = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-1 text-sm font-bold";
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">{m.title}</h1>
      <div className="flex gap-2">
        <button type="button" className={`${tabBtn} ${tab === "edit" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("edit")}>編輯</button>
        <button type="button" className={`${tabBtn} ${tab === "manage" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("manage")}>管理</button>
      </div>
      {tab === "edit" ? (
        <MissionEditor
          mode="edit"
          initial={m}
          engaged={engaged}
          saving={update.isPending}
          onSave={(body) => update.mutateAsync(body)}
        />
      ) : (
        <MissionManage missionId={missionId} />
      )}
    </div>
  );
```

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run src/routes/-admin.missions.manage.test.tsx && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MissionManage.tsx src/routes/admin.missions.$missionId.tsx src/routes/-admin.missions.manage.test.tsx
git commit -m "feat(brand): mission Manage tab with act-in-place actions (B2 phase 2)"
```

---

## Phase 2 gate

- [ ] **Run all gates:**

```bash
npm run lint && npm run type-check && npm run test && npm run build
npm run test:integration -- server/test/admin.test.ts server/test/missionAuthoring.test.ts
```
Expected: all green.

- [ ] **Full integration suite (final):** `npm run test:integration`
Expected: green (or only the documented pre-existing skips).

- [ ] **Manual smoke (optional):** `npm run dev`; select a workspace in the header → confirm Applications/Engaged/Submissions/Creators/Missions all narrow; open a mission → 管理 tab → accept an applicant / approve a submission and confirm the lists refresh.

---

## Deploy runbook (after merge, user-gated)

1. Apply `0019_mission_brief_rich.sql` to prod (`mhkoayftiuojxlrkollf`) **before** the deploy that reads the new columns.
2. Run `notify pgrst, 'reload schema';` in the Supabase SQL editor.
3. Deploy via Git (never `vercel --prod` from local — it mis-bundles the API).
4. Confirm `ADMIN_SECRET` is set in Vercel (unchanged from B1; the switcher/Manage actions need it).
5. Smoke: create a draft with brief fields, publish, view as a creator, duplicate, then scope a workspace and run a mission via the Manage tab.

---

## Self-review notes (author checklist — done)

- **Spec coverage:** §3.1 migration → Task 1. §3.2 validation → Task 2. §3.3 endpoints (cols + duplicate) → Task 4. §3.4 authoring (ArrayInput/platforms/audience/preview/duplicate) → Tasks 6–10. §3.5 creator render → Task 7. §4.1 switcher → Tasks 11, 13. §4.2 backend scoping (incl. creators-review) → Task 14. §4.3 activity + Manage → Tasks 15, 16, 18. §5 data flow / invalidation → Tasks 13, 18. §6 errors → reuses B1 shapes throughout. §7 testing → unit (Tasks 2, 3, 6, 8, 15), integration (Tasks 4, 14, 16), route/component (Tasks 6–11, 18). §9 forward hooks → `created_by:null` preserved (Task 4 duplicate), admin gate untouched.
- **Type consistency:** `MissionActivityRow`/`MissionActivity` defined identically server-side (Task 15) and client-side (Task 17); `adminKeys` function signatures updated in Task 12 and every caller fixed in Task 13; `MissionDraftInput` brief fields (Task 5) match `MissionInput` (Task 2) and `AdminMission` (Task 5).
- **Ambiguity resolved:** brief normalization vs. error rules made explicit in Task 2 (count cap = silent; per-item >200 and bad URL and audience >500 = errors).
- **No placeholders:** every code/test step carries real code; the only "verify the file's existing harness" notes are confined to matching local test-helper names that vary by file (called out explicitly where they occur).
