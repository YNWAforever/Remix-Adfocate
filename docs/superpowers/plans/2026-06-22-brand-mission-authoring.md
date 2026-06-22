# Brand Mission Authoring (Slice B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Fimmick/Adfocate staff create, edit, publish, and close missions per brand workspace entirely in `/admin`, with economic terms protected once creators engage and Draft/Closed missions never leaking to creators.

**Architecture:** Thin secret-gated admin REST routes (`serviceClient`, bypass RLS) in a new `server/routes/adminMissions.ts`, backed by a pure, unit-tested `server/lib/missionAuthoring.ts` that owns slug/validation/field-lock logic. Lifecycle (Draft→Active→Closed) is plain status updates. Creator-facing reads gain `status='active'` guards. A new "Missions" tab + list + editor in the existing `/admin` shell drives it.

**Tech Stack:** Hono (server) · Supabase Postgres (`serviceClient`/`makeUserClient`) · TanStack Router + React Query (frontend) · Vitest (unit + integration) · ESM with mandatory `.js` import extensions on relative server imports.

**Source spec:** `docs/superpowers/specs/2026-06-22-brand-mission-authoring-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/0018_mission_authoring.sql` — status CHECK + authoring/audit columns.
- `server/lib/missionAuthoring.ts` — pure module: slug + validation + edit-lock logic (no DB, no `new Date()`).
- `server/lib/missionAuthoring.test.ts` — unit tests for the pure module.
- `server/routes/adminMissions.ts` — secret-gated authoring endpoints (`serviceClient`).
- `server/test/missionAuthoring.test.ts` — integration tests (admin endpoints + visibility guards).
- `server/test/mission-authoring-schema.test.ts` — schema-shape integration test (matches the `*-schema.test.ts` convention).
- `src/lib/missionCategories.ts` — single canonical mission-category constant.
- `src/components/admin/MissionEditor.tsx` — shared create/edit form.
- `src/routes/admin.missions.index.tsx` — authoring list (`/admin/missions`).
- `src/routes/admin.missions.new.tsx` — create route (`/admin/missions/new`).
- `src/routes/admin.missions.$missionId.tsx` — edit route (`/admin/missions/:missionId`).
- `src/routes/-admin.missions.index.test.tsx`, `src/routes/-admin.missions.editor.test.tsx` — route tests.

**Modify:**
- `server/routes/admin.ts` — register `adminMissionRoutes`.
- `server/routes/missions.ts` — add `status='active'` guard to list + detail.
- `server/routes/copilot.ts` — add `status='active'` guard to the hook-generator read.
- `src/lib/admin.ts` — `AdminRequestError` + mission fetchers + types.
- `src/components/admin/AdminTabs.tsx` — add the "Missions" tab.
- `src/lib/i18n.dict.ts` — `app.admin.tabMissions` in both locales.
- `src/routes/_app.mission.index.tsx` — consume the shared category constant.
- `src/routes/-admin.test.tsx` — assert the new tab renders (optional, see Task 11).

**Note (ESM rule):** every relative import in a `server/**` file MUST end in `.js` (e.g. `import { validateMission } from "../lib/missionAuthoring.js"`). The repo's `check:esm` gate fails otherwise — a missing extension previously caused a prod outage.

---

## Task 1: Migration 0018 — status CHECK + authoring columns

**Files:**
- Create: `supabase/migrations/0018_mission_authoring.sql`
- Test: `server/test/mission-authoring-schema.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 0018_mission_authoring.sql
-- Slice B1 (mission authoring): constrain the lifecycle to a known set and add
-- authoring/audit columns. Additive + a CHECK over already-'active' rows.
-- (Most status cols use a CHECK; creators.status / redemption_gifts.status do not —
--  the CHECK is still desirable here.)

alter table public.missions
  add constraint missions_status_chk check (status in ('draft','active','closed'));

alter table public.missions
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists published_at timestamptz,
  add column if not exists closed_at    timestamptz,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- created_by stays NULL for every B1-authored mission (the secret-gated operator has no
-- auth.uid). It is a forward hook for self-serve (B3); not live attribution.
```

- [ ] **Step 2: Apply the migration to the LOCAL stack**

Run: `supabase db reset` (rebuilds local DB through 0018) — or, if you only want the delta and the stack is already up, `supabase migration up`.
Expected: completes without error; all existing seed missions remain `status='active'` (they satisfy the new CHECK).

- [ ] **Step 3: Write the schema-shape test**

```typescript
// server/test/mission-authoring-schema.test.ts
import { describe, it, expect } from "vitest";
import { serviceForTests, hasSupabaseEnv, DEMO_WS } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("0018 mission authoring schema", () => {
  it("rejects an out-of-set status via the CHECK constraint", async () => {
    const { error } = await serviceForTests()
      .from("missions")
      .insert({ workspace_id: DEMO_WS, slug: "test-bad-status", title: "x", mission_type: "ugc", status: "archived" });
    expect(error).toBeTruthy();
    expect(error?.message.toLowerCase()).toContain("missions_status_chk");
  });

  it("accepts a draft and exposes the new authoring columns", async () => {
    const svc = serviceForTests();
    const { data, error } = await svc
      .from("missions")
      .insert({ workspace_id: DEMO_WS, slug: "test-schema-draft", title: "x", mission_type: "ugc", status: "draft" })
      .select("id, status, updated_at, published_at, closed_at, created_by")
      .single();
    expect(error).toBeFalsy();
    expect(data?.status).toBe("draft");
    expect(data?.updated_at).toBeTruthy();
    expect(data?.published_at).toBeNull();
    expect(data?.created_by).toBeNull();
    await svc.from("missions").delete().eq("id", data!.id);
  });
});
```

- [ ] **Step 4: Run the schema test**

Run: `npm run test -- server/test/mission-authoring-schema.test.ts`
Expected: PASS (or all-SKIP if `.env.test.local` isn't exported into the shell — export it first to actually exercise it).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0018_mission_authoring.sql server/test/mission-authoring-schema.test.ts
git commit -m "feat(brand): 0018 mission authoring migration + schema test"
```

---

## Task 2: Pure module skeleton — constants, `isValidSlug`, `suggestSlug`

**Files:**
- Create: `server/lib/missionAuthoring.ts`
- Test: `server/lib/missionAuthoring.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/lib/missionAuthoring.test.ts
import { describe, it, expect } from "vitest";
import { isValidSlug, suggestSlug, MISSION_LEVELS, MISSION_TYPES } from "./missionAuthoring.js";

describe("isValidSlug", () => {
  it("accepts lowercase alnum + hyphens", () => {
    expect(isValidSlug("summer-koc-2026")).toBe(true);
    expect(isValidSlug("a1")).toBe(true);
  });
  it("rejects empty, uppercase, leading hyphen, spaces, zh chars", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Summer")).toBe(false);
    expect(isValidSlug("-x")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("夏日")).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("kebabs the mission type", () => {
    expect(suggestSlug("koc_trial")).toBe("koc-trial");
    expect(suggestSlug("performance_cpm")).toBe("performance-cpm");
  });
});

describe("canonical sets", () => {
  it("levels are the seven-level L0..L6 set (mirrors src/lib/levels.ts)", () => {
    expect(MISSION_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
  });
  it("mission types match the 0001 CHECK", () => {
    expect(MISSION_TYPES).toEqual([
      "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: FAIL — cannot resolve `./missionAuthoring.js`.

- [ ] **Step 3: Write the module skeleton + helpers**

```typescript
// server/lib/missionAuthoring.ts
/** Pure mission-authoring rules — no DB, no I/O, no `new Date()`. The route in
 *  routes/adminMissions.ts feeds it raw rows + an injected HK "today" string; this module
 *  owns slug validation, the publish-readiness matrix, and the edit-lock tiers. Mirrors the
 *  pure-module pattern of lib/missionMatch.ts / lib/hookGen.ts. */

// Mirror of the DB CHECK (0001_init missions.mission_type). Keep in sync with that constraint.
export const MISSION_TYPES = [
  "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador",
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

// Canonical level set. DUPLICATED from src/lib/levels.ts (canonical) — do NOT cross-import the
// frontend module into the server bundle (prior ESM cross-tree-import outage). Also the DB
// level_ordinal gate (0005) and server LEVEL_IDS (trust.ts/passport.ts) use exactly L0..L6.
export const MISSION_LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const ACCESS_TYPES = ["open", "application"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;

export type MissionInput = {
  workspace_id?: string | null;
  slug?: string | null;
  title?: string | null;
  mission_type?: string | null;
  description?: string | null;
  category?: string | null;
  access_type?: string | null;
  required_level?: string | null;
  points_reward?: number | null;
  cash_reward?: number | null;
  cpm_rate?: number | null;
  cpm_budget_pool?: number | null;
  deadline?: string | null;
  quota?: number | null;
  deliverables?: string[];
  requirements?: string[];
  platforms?: string[];
  effort?: string | null;
};

// The existing record for an edit, as read from the DB.
export type MissionRecord = MissionInput & {
  status: "draft" | "active" | "closed";
  filled?: number | null;
  quota?: number | null;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

export function suggestSlug(missionType: string): string {
  return missionType.replace(/_/g, "-");
}

// --- internal helpers ---
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}
function sameNullable(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: PASS (3 describe blocks green). `validateMission`/`validateEdit` arrive in Tasks 3–4.

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionAuthoring.ts server/lib/missionAuthoring.test.ts
git commit -m "feat(brand): mission-authoring pure module skeleton (slug + constants)"
```

---

## Task 3: `validateMission` — draft + publish modes

**Files:**
- Modify: `server/lib/missionAuthoring.ts`
- Modify: `server/lib/missionAuthoring.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to server/lib/missionAuthoring.test.ts
import { validateMission, type MissionInput } from "./missionAuthoring.js";

const TODAY = "2026-06-22";
const draftOk: MissionInput = { workspace_id: "ws", title: "夏日試用", slug: "test-x", mission_type: "ugc" };

describe("validateMission draft mode", () => {
  it("requires workspace_id, title, slug AND mission_type (mission_type is NOT NULL in DB)", () => {
    expect(validateMission(draftOk, "draft").ok).toBe(true);
    expect(validateMission({ ...draftOk, mission_type: undefined }, "draft").errors).toHaveProperty("mission_type");
    expect(validateMission({ ...draftOk, slug: "Bad Slug" }, "draft").errors).toHaveProperty("slug");
    expect(validateMission({ ...draftOk, title: "  " }, "draft").errors).toHaveProperty("title");
    expect(validateMission({ ...draftOk, workspace_id: null }, "draft").errors).toHaveProperty("workspace_id");
  });
  it("allows everything else to be sparse in draft mode", () => {
    expect(validateMission(draftOk, "draft").ok).toBe(true); // no reward/category/deadline needed
  });
});

describe("validateMission publish mode", () => {
  const base: MissionInput = {
    ...draftOk, description: "做啲嘢", category: "美容", access_type: "open",
    required_level: "L2", quota: 5, deadline: "2026-07-01", points_reward: 100,
  };
  it("passes a complete points/cash mission", () => {
    expect(validateMission(base, "publish", TODAY).ok).toBe(true);
  });
  it("flags missing description/category/quota/deadline", () => {
    expect(validateMission({ ...base, description: "" }, "publish", TODAY).errors).toHaveProperty("description");
    expect(validateMission({ ...base, category: "" }, "publish", TODAY).errors).toHaveProperty("category");
    expect(validateMission({ ...base, quota: 0 }, "publish", TODAY).errors).toHaveProperty("quota");
    expect(validateMission({ ...base, deadline: "2026-06-21" }, "publish", TODAY).errors).toHaveProperty("deadline");
  });
  it("accepts all seven levels incl. L5/L6", () => {
    for (const lvl of ["L0", "L5", "L6"]) {
      expect(validateMission({ ...base, required_level: lvl }, "publish", TODAY).ok).toBe(true);
    }
    expect(validateMission({ ...base, required_level: "L9" }, "publish", TODAY).errors).toHaveProperty("required_level");
  });
  it("reward-by-type: points OR cash for koc_trial/ugc/clipping/brand_ambassador/affiliate/live_commerce", () => {
    for (const t of ["koc_trial", "ugc", "clipping", "brand_ambassador", "affiliate", "live_commerce"]) {
      expect(validateMission({ ...base, mission_type: t, points_reward: 0, cash_reward: 0 }, "publish", TODAY).errors)
        .toHaveProperty("points_reward");
      expect(validateMission({ ...base, mission_type: t, points_reward: 0, cash_reward: 50 }, "publish", TODAY).ok).toBe(true);
    }
  });
  it("reward-by-type: performance_cpm needs cpm_rate>0 AND cpm_budget_pool>0", () => {
    const cpm = { ...base, mission_type: "performance_cpm", points_reward: 0, cash_reward: 0 };
    expect(validateMission(cpm, "publish", TODAY).errors).toHaveProperty("cpm_rate");
    expect(validateMission({ ...cpm, cpm_rate: 5 }, "publish", TODAY).errors).toHaveProperty("cpm_rate"); // pool still missing
    expect(validateMission({ ...cpm, cpm_rate: 5, cpm_budget_pool: 1000 }, "publish", TODAY).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: FAIL — `validateMission` not exported.

- [ ] **Step 3: Implement `validateMission`**

```typescript
// append to server/lib/missionAuthoring.ts
export function validateMission(
  input: MissionInput,
  mode: "draft" | "publish",
  today?: string,
): ValidationResult {
  const errors: Record<string, string> = {};

  // Required in BOTH modes (mission_type is NOT NULL with no default in the DB).
  if (!nonEmpty(input.workspace_id)) errors.workspace_id = "請選擇品牌 workspace";
  if (!nonEmpty(input.title)) errors.title = "請輸入任務標題";
  if (!isValidSlug(input.slug)) errors.slug = "Slug 須為小寫英數字與連字號（a-z0-9-）";
  if (!input.mission_type || !MISSION_TYPES.includes(input.mission_type as MissionType)) {
    errors.mission_type = "請選擇任務類型";
  }

  if (mode === "publish") {
    if (!nonEmpty(input.description)) errors.description = "發佈前請輸入任務簡介";
    if (!nonEmpty(input.category)) errors.category = "請選擇任務分類";
    if (!input.access_type || !ACCESS_TYPES.includes(input.access_type as (typeof ACCESS_TYPES)[number])) {
      errors.access_type = "請選擇參與方式";
    }
    if (!input.required_level || !MISSION_LEVELS.includes(input.required_level as (typeof MISSION_LEVELS)[number])) {
      errors.required_level = "請選擇等級要求";
    }
    if (!Number.isInteger(input.quota) || num(input.quota) < 1) errors.quota = "名額須為 1 或以上";
    if (!today) errors.deadline = "缺少截止日期基準";
    else if (!input.deadline || input.deadline < today) errors.deadline = "截止日期須為今天或之後";

    // Reward-by-type. Only performance_cpm differs; the rest are "points and/or cash".
    if (input.mission_type === "performance_cpm") {
      if (!(num(input.cpm_rate) > 0 && num(input.cpm_budget_pool) > 0)) {
        errors.cpm_rate = "CPM 任務須設定 CPM 單價與預算池（均大於 0）";
      }
    } else if (!errors.mission_type) {
      if (!(num(input.points_reward) > 0 || num(input.cash_reward) > 0)) {
        errors.points_reward = "請設定積分或現金獎勵（至少一項大於 0）";
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: PASS (all draft + publish cases green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionAuthoring.ts server/lib/missionAuthoring.test.ts
git commit -m "feat(brand): validateMission draft + publish (reward-by-type matrix)"
```

---

## Task 4: `validateEdit` — frozen / locked / constrained tiers

**Files:**
- Modify: `server/lib/missionAuthoring.ts`
- Modify: `server/lib/missionAuthoring.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to server/lib/missionAuthoring.test.ts
import { validateEdit, type MissionRecord } from "./missionAuthoring.js";

const draftRec: MissionRecord = {
  status: "draft", workspace_id: "ws", slug: "test-x", title: "t", mission_type: "ugc",
  points_reward: 100, cash_reward: null, access_type: "open", required_level: "L0",
  quota: 10, filled: 0, deadline: "2026-07-01",
};
const activeRec: MissionRecord = { ...draftRec, status: "active" };

describe("validateEdit", () => {
  it("draft: nothing frozen — slug/type/rewards all editable", () => {
    expect(validateEdit(draftRec, { slug: "test-y", mission_type: "clipping", points_reward: 200 }, false).ok).toBe(true);
  });
  it("published + unengaged: slug & mission_type are frozen, rest editable", () => {
    expect(validateEdit(activeRec, { slug: "test-z" }, false).errors).toHaveProperty("slug");
    expect(validateEdit(activeRec, { mission_type: "ugc" }, false).ok).toBe(true); // same value = no-op
    expect(validateEdit(activeRec, { mission_type: "clipping" }, false).errors).toHaveProperty("mission_type");
    expect(validateEdit(activeRec, { points_reward: 999 }, false).ok).toBe(true); // unengaged → editable
  });
  it("engaged: economic fields locked, but re-sending the same value is a no-op", () => {
    expect(validateEdit(activeRec, { points_reward: 999 }, true).errors).toHaveProperty("points_reward");
    expect(validateEdit(activeRec, { cash_reward: 5 }, true).errors).toHaveProperty("cash_reward");
    expect(validateEdit(activeRec, { access_type: "application" }, true).errors).toHaveProperty("access_type");
    expect(validateEdit(activeRec, { required_level: "L3" }, true).errors).toHaveProperty("required_level");
    expect(validateEdit(activeRec, { points_reward: 100 }, true).ok).toBe(true); // unchanged
    expect(validateEdit(activeRec, { title: "新標題", description: "x" }, true).ok).toBe(true); // brief always editable
  });
  it("engaged: quota floor = max(existing.quota, filled); deadline extend-only", () => {
    const engaged: MissionRecord = { ...activeRec, quota: 10, filled: 7 };
    expect(validateEdit(engaged, { quota: 6 }, true).errors).toHaveProperty("quota"); // below filled
    expect(validateEdit(engaged, { quota: 12 }, true).ok).toBe(true);
    expect(validateEdit(engaged, { deadline: "2026-06-30" }, true).errors).toHaveProperty("deadline"); // earlier
    expect(validateEdit(engaged, { deadline: "2026-08-01" }, true).ok).toBe(true);
  });
  it("all-declined mission stays fully editable (hasEngagement=false)", () => {
    expect(validateEdit(activeRec, { points_reward: 500, quota: 1 }, false).ok).toBe(true);
  });
  it("format checks apply regardless of status", () => {
    expect(validateEdit(draftRec, { slug: "Bad Slug" }, false).errors).toHaveProperty("slug");
    expect(validateEdit(draftRec, { required_level: "L9" }, false).errors).toHaveProperty("required_level");
    expect(validateEdit(draftRec, { quota: 0 }, false).errors).toHaveProperty("quota");
    expect(validateEdit(draftRec, { effort: "extreme" }, false).errors).toHaveProperty("effort");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: FAIL — `validateEdit` not exported.

- [ ] **Step 3: Implement `validateEdit`**

```typescript
// append to server/lib/missionAuthoring.ts
const LOCKED_ON_ENGAGEMENT = [
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "access_type", "required_level",
] as const;

export function validateEdit(
  existing: MissionRecord,
  patch: MissionInput,
  hasEngagement: boolean,
): ValidationResult {
  const errors: Record<string, string> = {};
  const has = (k: keyof MissionInput) => Object.prototype.hasOwnProperty.call(patch, k);

  // Format checks — apply to any status.
  if (has("slug") && !isValidSlug(patch.slug)) errors.slug = "Slug 須為小寫英數字與連字號（a-z0-9-）";
  if (has("mission_type") && !MISSION_TYPES.includes(patch.mission_type as MissionType)) {
    errors.mission_type = "任務類型無效";
  }
  if (has("required_level") && !MISSION_LEVELS.includes(patch.required_level as (typeof MISSION_LEVELS)[number])) {
    errors.required_level = "等級要求無效";
  }
  if (has("access_type") && !ACCESS_TYPES.includes(patch.access_type as (typeof ACCESS_TYPES)[number])) {
    errors.access_type = "參與方式無效";
  }
  if (has("effort") && patch.effort != null && !EFFORTS.includes(patch.effort as (typeof EFFORTS)[number])) {
    errors.effort = "投入程度無效";
  }
  if (has("quota") && (!Number.isInteger(patch.quota) || num(patch.quota) < 1)) {
    errors.quota = "名額須為 1 或以上";
  }

  // Frozen at publish (independent of engagement).
  if (existing.status !== "draft") {
    if (has("slug") && patch.slug !== existing.slug) errors.slug = "已發佈：Slug 不可更改";
    if (has("mission_type") && patch.mission_type !== existing.mission_type) {
      errors.mission_type = "已發佈：任務類型不可更改";
    }
  }

  // Locked / constrained on engagement.
  if (hasEngagement) {
    for (const f of LOCKED_ON_ENGAGEMENT) {
      if (has(f) && !sameNullable(patch[f], existing[f])) errors[f] = "已有創作者參與：此欄位已鎖定";
    }
    if (has("quota") && !errors.quota) {
      const floor = Math.max(num(existing.quota), num(existing.filled));
      if (num(patch.quota) < floor) errors.quota = `名額不可低於 ${floor}（現有名額／已參與人數）`;
    }
    if (has("deadline") && patch.deadline != null && existing.deadline != null && patch.deadline < existing.deadline) {
      errors.deadline = "已有創作者參與：截止日期只可延後";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- server/lib/missionAuthoring.test.ts`
Expected: PASS (full pure-module suite green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionAuthoring.ts server/lib/missionAuthoring.test.ts
git commit -m "feat(brand): validateEdit field-lock tiers"
```

---

## Task 5: Shared mission-category constant + consolidate the creator filter

**Files:**
- Create: `src/lib/missionCategories.ts`
- Modify: `src/routes/_app.mission.index.tsx:13`

- [ ] **Step 1: Create the constant**

```typescript
// src/lib/missionCategories.ts
// Canonical mission-category list (zh-HK). Single source for BOTH the operator authoring
// dropdown (MissionEditor) and the creator mission filter, so authored values always match
// what creators can filter by and what the matcher's category-fit compares (missionMatch.ts).
export const MISSION_CATEGORIES = ["社交", "美容", "餐飲", "生活"] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

// UI-only sentinel for "no filter" — never stored on a mission.
export const ALL_CATEGORY = "全部";
```

- [ ] **Step 2: Point the creator filter at the constant**

In `src/routes/_app.mission.index.tsx`, replace line 13:

```typescript
// BEFORE
const CATEGORIES = ["全部", "社交", "美容", "餐飲", "生活"] as const;
// AFTER
import { MISSION_CATEGORIES, ALL_CATEGORY } from "@/lib/missionCategories";
const CATEGORIES = [ALL_CATEGORY, ...MISSION_CATEGORIES] as const;
```

(Place the `import` with the other top-of-file imports, not inline.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS — the filter array is unchanged in value, so `useMissions`/`FilterPills` typing still holds.

- [ ] **Step 4: Run the mission-index test (if present) + full unit suite quick check**

Run: `npm run test -- src/routes`
Expected: PASS — no behavioral change to the filter.

- [ ] **Step 5: Commit**

```bash
git add src/lib/missionCategories.ts src/routes/_app.mission.index.tsx
git commit -m "feat(brand): single canonical mission-category constant"
```

---

## Task 6: Visibility guards — creator reads filter to `active`

**Files:**
- Modify: `server/routes/missions.ts` (list ~line 27, detail ~line 67)
- Modify: `server/routes/copilot.ts` (~line 27)
- Create: `server/test/missionAuthoring.test.ts` (visibility section; admin-endpoint sections added in Tasks 7–9)

- [ ] **Step 1: Guard the creator mission list**

In `server/routes/missions.ts`, the `missionRoutes.get("/")` query — add a status filter right after the workspace filter:

```typescript
  let q = supabase
    .from("missions")
    .select("id, slug, title, description, category, mission_type, access_type, points_reward, deadline, quota, filled, status")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("status", "active")            // B1: never surface draft/closed to creators
    .order("created_at", { ascending: false });
```

- [ ] **Step 2: Guard the creator mission detail**

In `server/routes/missions.ts`, the `missionRoutes.get("/:slug")` query — add `.eq("status", "active")` so a non-active slug returns no row and falls through to the existing 404:

```typescript
  const { data, error } = await supabase
    .from("missions")
    .select("*, workspaces(name)")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .eq("status", "active")            // B1: draft/closed → 404 for creators
    .maybeSingle();
```

- [ ] **Step 3: Guard the hook-generator read (critical leak)**

In `server/routes/copilot.ts`, the mission read in the `Promise.all` (~line 27) — add `.eq("status", "active")`. It uses `.single()`, so a non-active mission becomes `PGRST116`, which the existing handler already maps to 404:

```typescript
    supabase.from("missions").select("title, description, category")
      .eq("workspace_id", workspaceId).eq("slug", missionSlug).eq("status", "active").single(),
```

- [ ] **Step 4: Write the visibility integration tests**

```typescript
// server/test/missionAuthoring.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET!;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("B1 visibility guards", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("b1vis@test.local", 0);
    await makeMission({ slug: "test-vis-draft", status: "draft", category: "美容" });
    await makeMission({ slug: "test-vis-closed", status: "closed", category: "美容" });
    await makeMission({ slug: "test-vis-active", status: "active", category: "美容" });
  });
  afterAll(cleanup);

  it("creator list excludes draft + closed", async () => {
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-vis-active");
    expect(slugs).not.toContain("test-vis-draft");
    expect(slugs).not.toContain("test-vis-closed");
  });

  it("creator detail 404s a draft/closed slug", async () => {
    expect((await koreq("/missions/test-vis-draft", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-closed", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-active", koc.jwt)).status).toBe(200);
  });

  it("hook-generator 404s a draft/closed slug but works on active", async () => {
    const draft = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-draft" }) });
    expect(draft.status).toBe(404);
    const closed = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-closed" }) });
    expect(closed.status).toBe(404);
    const active = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-active" }) });
    expect(active.status).toBe(200);
  });

  it("join RPC refuses a closed mission (Close auto-blocks new joins)", async () => {
    const res = await koreq("/missions/test-vis-closed/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404); // detail-guard returns not_found before the RPC; closed never visible
  });
});
```

- [ ] **Step 5: Run the visibility tests**

Run: `npm run test -- server/test/missionAuthoring.test.ts`
Expected: PASS (4 cases). If all SKIP, export `.env.test.local` into the shell first.

- [ ] **Step 6: Commit**

```bash
git add server/routes/missions.ts server/routes/copilot.ts server/test/missionAuthoring.test.ts
git commit -m "feat(brand): active-only visibility guards on creator mission reads"
```

---

## Task 7: Admin routes — workspaces + list + get-by-id (+ registration)

**Files:**
- Create: `server/routes/adminMissions.ts`
- Modify: `server/routes/admin.ts`
- Modify: `server/test/missionAuthoring.test.ts`

- [ ] **Step 1: Create the route file with shared helpers + the three read endpoints**

```typescript
// server/routes/adminMissions.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { validateMission, validateEdit, type MissionInput, type MissionRecord } from "../lib/missionAuthoring.js";

/** Secret-gated mission authoring (Slice B1). Mounted under the /admin shared-secret gate;
 *  uses serviceClient (bypasses RLS). Real per-workspace role auth lands with the Brand
 *  Dashboard (B3). All relative imports carry the .js ESM extension. */
export const adminMissionRoutes = new Hono();

const ENGAGED_STATUSES = ["applied", "joined", "submitted", "under_review", "approved"];

const MISSION_COLS =
  "id, workspace_id, slug, title, description, category, mission_type, access_type, required_level, " +
  "points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota, filled, status, " +
  "deliverables, requirements, platforms, effort, created_at, updated_at, published_at, closed_at";

const EDITABLE_COLS: (keyof MissionInput)[] = [
  "slug", "title", "description", "category", "mission_type", "access_type", "required_level",
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "deadline", "quota",
  "deliverables", "requirements", "platforms", "effort",
];

// Asia/Hong_Kong YYYY-MM-DD. The route (not the pure module) is where the clock lives.
// en-CA formats as YYYY-MM-DD; HK = UTC+8, no DST.
function hkToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function countEngaged(svc: ReturnType<typeof serviceClient>, missionId: string) {
  return svc
    .from("mission_submissions")
    .select("id", { count: "exact", head: true })
    .eq("mission_id", missionId)
    .in("status", ENGAGED_STATUSES);
}

adminMissionRoutes.get("/workspaces", async (c) => {
  const { data, error } = await serviceClient().from("workspaces").select("id, slug, name").order("name");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ workspaces: data ?? [] });
});

adminMissionRoutes.get("/missions", async (c) => {
  const workspace = c.req.query("workspace");
  const status = c.req.query("status");
  const svc = serviceClient();
  let q = svc.from("missions").select(MISSION_COLS).order("updated_at", { ascending: false });
  if (workspace) q = q.eq("workspace_id", workspace);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; filled: number | null }>;
  const ids = rows.map((r) => r.id);
  let engagedSet = new Set<string>();
  if (ids.length) {
    const { data: subs, error: sErr } = await svc
      .from("mission_submissions").select("mission_id").in("mission_id", ids).in("status", ENGAGED_STATUSES);
    if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
    engagedSet = new Set((subs ?? []).map((s) => s.mission_id as string));
  }
  const missions = rows.map((r) => ({ ...r, engaged: engagedSet.has(r.id) || (r.filled ?? 0) > 0 }));
  return c.json({ missions });
});

adminMissionRoutes.get("/missions/:id", async (c) => {
  const { data, error } = await serviceClient().from("missions").select(MISSION_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ mission: data });
});
```

> NOTE on route ordering: `adminOperatorCrmRoutes` (mounted earlier in `admin.ts`) defines `/missions/:missionId/shortlist` (3 segments). Ours are `/missions` (1) and `/missions/:id` (2) — distinct shapes, no collision. `hkToday`, `countEngaged`, `EDITABLE_COLS` are used by Tasks 8–9.

- [ ] **Step 2: Register the route in `server/routes/admin.ts`**

Add the import beside the existing CRM import, and mount it next to the CRM mount:

```typescript
// near the other imports
import { adminMissionRoutes } from "./adminMissions.js";
// after `adminRoutes.route("/", adminOperatorCrmRoutes);`
adminRoutes.route("/", adminMissionRoutes);
```

- [ ] **Step 3: Add read-endpoint integration tests**

```typescript
// append to server/test/missionAuthoring.test.ts
suite("B1 admin read endpoints", () => {
  beforeAll(async () => {
    await cleanup();
    await makeMission({ slug: "test-adm-active", status: "active", category: "美容" });
    await makeMission({ slug: "test-adm-draft", status: "draft", category: "美容" });
  });
  afterAll(cleanup);

  it("401s without the secret", async () => {
    expect((await app.request("/api/admin/missions", { headers: { "Content-Type": "application/json" } })).status).toBe(401);
  });
  it("lists workspaces ordered by name", async () => {
    const { workspaces } = await (await adminreq("/admin/missions/../workspaces".replace("/missions/..", ""))).json();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
  });
  it("lists all statuses for a workspace, each annotated with engaged", async () => {
    const { missions } = await (await adminreq("/admin/missions?workspace=00000000-0000-0000-0000-0000000000aa")).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-adm-active");
    expect(slugs).toContain("test-adm-draft"); // admin sees drafts
    expect(missions.every((m: { engaged: boolean }) => typeof m.engaged === "boolean")).toBe(true);
  });
  it("filters by status", async () => {
    const { missions } = await (await adminreq("/admin/missions?status=draft")).json();
    expect(missions.every((m: { status: string }) => m.status === "draft")).toBe(true);
  });
  it("404s an unknown id", async () => {
    expect((await adminreq("/admin/missions/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
```

> The `workspaces` test path is just `/admin/workspaces`; write it plainly as `adminreq("/admin/workspaces")` — the `.replace` above is illustrative noise, use the clean form:
> ```typescript
> const { workspaces } = await (await adminreq("/admin/workspaces")).json();
> ```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- server/test/missionAuthoring.test.ts`
Expected: PASS (visibility + read-endpoint blocks green).

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminMissions.ts server/routes/admin.ts server/test/missionAuthoring.test.ts
git commit -m "feat(brand): admin mission read endpoints (workspaces/list/detail)"
```

---

## Task 8: Admin routes — create Draft + edit (PATCH)

**Files:**
- Modify: `server/routes/adminMissions.ts`
- Modify: `server/test/missionAuthoring.test.ts`

- [ ] **Step 1: Implement POST (create Draft) + PATCH (edit)**

```typescript
// append to server/routes/adminMissions.ts
adminMissionRoutes.post("/missions", async (c) => {
  const body = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  const { ok, errors } = validateMission(body, "draft");
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const insert: Record<string, unknown> = {
    workspace_id: body.workspace_id, slug: body.slug, title: body.title, mission_type: body.mission_type,
    description: body.description ?? null, category: body.category ?? null,
    access_type: body.access_type ?? "open", required_level: body.required_level ?? "L0",
    points_reward: body.points_reward ?? 0, cash_reward: body.cash_reward ?? null,
    cpm_rate: body.cpm_rate ?? null, cpm_budget_pool: body.cpm_budget_pool ?? null,
    deadline: body.deadline ?? null, quota: body.quota ?? 10,
    deliverables: body.deliverables ?? [], requirements: body.requirements ?? [], platforms: body.platforms ?? [],
    effort: body.effort ?? null, status: "draft",
  };
  const { data, error } = await serviceClient().from("missions").insert(insert).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data }, 201);
});

adminMissionRoutes.patch("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  const svc = serviceClient();

  const { data: existing, error: exErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as { status: string }).status === "closed") {
    return c.json({ error: "已關閉的任務不可編輯", code: "invalid_transition" }, 409);
  }

  const { count, error: cErr } = await countEngaged(svc, id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  const engaged = ((existing as { filled: number | null }).filled ?? 0) > 0 || (count ?? 0) > 0;

  const { ok, errors } = validateEdit(existing as unknown as MissionRecord, patch, engaged);
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = patch[k];

  const { data, error } = await svc.from("missions").update(updates).eq("id", id).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data });
});
```

- [ ] **Step 2: Add create + edit integration tests**

```typescript
// append to server/test/missionAuthoring.test.ts
suite("B1 create + edit", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  async function createDraft(slug: string, over: Record<string, unknown> = {}) {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: "00000000-0000-0000-0000-0000000000aa", slug, title: "草稿", mission_type: "ugc", ...over }),
    });
    return { res, body: await res.json() };
  }

  it("creates a sparse draft (no reward) → 201, not visible to creators", async () => {
    const { res, body } = await createDraft("test-create-1");
    expect(res.status).toBe(201);
    expect(body.mission.status).toBe("draft");
    const koc = await makeCreator("b1create@test.local", 0);
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    expect(missions.map((m: { slug: string }) => m.slug)).not.toContain("test-create-1");
  });

  it("422s a draft missing mission_type with a per-field error", async () => {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: "00000000-0000-0000-0000-0000000000aa", slug: "test-create-2", title: "x" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.fields).toHaveProperty("mission_type");
  });

  it("422s a duplicate slug in the same workspace", async () => {
    await createDraft("test-dupe");
    const { res, body } = await createDraft("test-dupe");
    expect(res.status).toBe(422);
    expect(body.fields).toHaveProperty("slug");
  });

  it("edits the brief of a draft → 200", async () => {
    const { body } = await createDraft("test-edit-brief");
    const res = await adminreq(`/admin/missions/${body.mission.id}`, { method: "PATCH", body: JSON.stringify({ title: "新標題", description: "做啲嘢" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).mission.title).toBe("新標題");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm run test -- server/test/missionAuthoring.test.ts`
Expected: PASS (create + edit blocks green).

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminMissions.ts server/test/missionAuthoring.test.ts
git commit -m "feat(brand): admin create-draft + patch-edit endpoints"
```

---

## Task 9: Admin routes — publish + close + delete (lifecycle)

**Files:**
- Modify: `server/routes/adminMissions.ts`
- Modify: `server/test/missionAuthoring.test.ts`

- [ ] **Step 1: Implement publish / close / delete**

```typescript
// append to server/routes/adminMissions.ts
adminMissionRoutes.post("/missions/:id/publish", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以發佈", code: "invalid_transition" }, 409);

  const { ok, errors } = validateMission(m as unknown as MissionInput, "publish", hkToday());
  if (!ok) return c.json({ error: "發佈前請完成必填欄位", code: "validation", fields: errors }, 422);

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

adminMissionRoutes.post("/missions/:id/close", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "active") return c.json({ error: "只有進行中的任務可以關閉", code: "invalid_transition" }, 409);

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

adminMissionRoutes.delete("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以刪除", code: "invalid_transition" }, 409);

  const { count, error: cErr } = await svc.from("mission_submissions").select("id", { count: "exact", head: true }).eq("mission_id", id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  if ((count ?? 0) > 0) return c.json({ error: "已有報名紀錄的草稿不可刪除", code: "invalid_transition" }, 409);

  const { error: dErr } = await svc.from("missions").delete().eq("id", id);
  if (dErr) return c.json({ error: dErr.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Add lifecycle + lock integration tests**

```typescript
// append to server/test/missionAuthoring.test.ts
suite("B1 lifecycle + locks", () => {
  const WS = "00000000-0000-0000-0000-0000000000aa";
  beforeAll(cleanup);
  afterAll(cleanup);

  async function createDraft(slug: string, over: Record<string, unknown> = {}) {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: WS, slug, title: "草稿", mission_type: "ugc", ...over }),
    });
    return (await res.json()).mission;
  }
  async function publish(id: string) {
    return adminreq(`/admin/missions/${id}/publish`, { method: "POST" });
  }

  it("publish-missing-fields → 422 with fields; complete draft → 200 + visible to creators", async () => {
    const bad = await createDraft("test-pub-bad"); // no reward/category/deadline
    const r1 = await publish(bad.id);
    expect(r1.status).toBe(422);
    expect((await r1.json()).fields).toHaveProperty("category");

    const good = await createDraft("test-pub-good", {
      description: "做啲嘢", category: "美容", access_type: "open", required_level: "L0",
      quota: 5, deadline: "2030-01-01", points_reward: 100,
    });
    expect((await publish(good.id)).status).toBe(200);

    const koc = await makeCreator("b1pub@test.local", 0);
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    expect(missions.map((m: { slug: string }) => m.slug)).toContain("test-pub-good");
  });

  it("publish a non-draft → 409; close a non-active → 409; edit a closed → 409", async () => {
    const m = await createDraft("test-lc", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    expect((await publish(m.id)).status).toBe(409); // already active
    expect((await adminreq(`/admin/missions/${m.id}/close`, { method: "POST" })).status).toBe(200);
    expect((await adminreq(`/admin/missions/${m.id}/close`, { method: "POST" })).status).toBe(409); // already closed
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status).toBe(409);
  });

  it("slug & mission_type frozen after publish → 422", async () => {
    const m = await createDraft("test-frozen", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ slug: "test-frozen-2" }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ mission_type: "clipping" }) })).status).toBe(422);
    // brief still editable
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ description: "新簡介" }) })).status).toBe(200);
  });

  it("economic fields lock after a creator joins; brief stays editable; quota cannot drop below filled", async () => {
    const m = await createDraft("test-engage", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 5, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    const koc = await makeCreator("b1eng@test.local", 0);
    expect((await koreq("/missions/test-engage/join", koc.jwt, { method: "POST" })).status).toBe(200);

    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ points_reward: 999 }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ quota: 0 }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ title: "改個名" }) })).status).toBe(200);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ quota: 9 }) })).status).toBe(200);
  });

  it("delete draft → ok; delete active → 409", async () => {
    const d = await createDraft("test-del-draft");
    expect((await adminreq(`/admin/missions/${d.id}`, { method: "DELETE" })).status).toBe(200);
    const a = await createDraft("test-del-active", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(a.id);
    expect((await adminreq(`/admin/missions/${a.id}`, { method: "DELETE" })).status).toBe(409);
  });
});
```

- [ ] **Step 3: Run the full integration file**

Run: `npm run test -- server/test/missionAuthoring.test.ts`
Expected: PASS (all B1 integration blocks green).

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminMissions.ts server/test/missionAuthoring.test.ts
git commit -m "feat(brand): publish/close/delete lifecycle endpoints + lock integration tests"
```

---

## Task 10: Frontend data layer — `AdminRequestError` + mission fetchers

**Files:**
- Modify: `src/lib/admin.ts`
- Modify: `src/lib/admin.test.ts`

- [ ] **Step 1: Add failing tests for the error shape + a fetcher**

```typescript
// append to src/lib/admin.test.ts
import { AdminRequestError, createMission, fetchAdminMissions } from "./admin";

describe("AdminRequestError surfaces code + fields", () => {
  beforeEach(() => sessionStorage.setItem("adfocate_admin_secret", "s"));
  it("throws AdminRequestError carrying fields on 422", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ error: "bad", code: "validation", fields: { slug: "taken" } }),
    }));
    await expect(createMission({ workspace_id: "w", slug: "x", title: "t", mission_type: "ugc" }))
      .rejects.toMatchObject({ code: "validation", fields: { slug: "taken" } });
  });
  it("fetchAdminMissions builds the workspace+status query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ missions: [] }) });
    vi.stubGlobal("fetch", f);
    await fetchAdminMissions("ws1", "draft");
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/admin/missions?workspace=ws1&status=draft"), expect.anything());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/admin.test.ts`
Expected: FAIL — `AdminRequestError`/`createMission`/`fetchAdminMissions` not exported.

- [ ] **Step 3: Extend `adminFetch` + add types and fetchers**

In `src/lib/admin.ts`, add the error class and make `adminFetch` throw it (keep `AdminAuthError` behavior for 401):

```typescript
// near AdminAuthError
export class AdminRequestError extends Error {
  code?: string;
  fields?: Record<string, string>;
  constructor(message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}
```

Replace the `!res.ok` branch inside `adminFetch`:

```typescript
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields);
  }
```

Append the mission types + fetchers at the end of the file:

```typescript
// ---- B1 mission authoring -------------------------------------------------
export type AdminWorkspace = { id: string; slug: string; name: string };

export type AdminMission = {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  mission_type: string;
  access_type: "open" | "application";
  required_level: string;
  points_reward: number;
  cash_reward: number | null;
  cpm_rate: number | null;
  cpm_budget_pool: number | null;
  deadline: string | null;
  quota: number;
  filled: number;
  status: "draft" | "active" | "closed";
  deliverables: string[];
  requirements: string[];
  platforms: string[];
  effort: "low" | "medium" | "high" | null;
  updated_at: string;
  published_at: string | null;
  closed_at: string | null;
};
export type AdminMissionRow = AdminMission & { engaged: boolean };

export type MissionDraftInput = {
  workspace_id: string;
  slug: string;
  title: string;
  mission_type: string;
  description?: string | null;
  category?: string | null;
  access_type?: "open" | "application";
  required_level?: string;
  points_reward?: number | null;
  cash_reward?: number | null;
  cpm_rate?: number | null;
  cpm_budget_pool?: number | null;
  deadline?: string | null;
  quota?: number | null;
  deliverables?: string[];
  requirements?: string[];
  platforms?: string[];
  effort?: "low" | "medium" | "high" | null;
};
export type MissionPatch = Partial<MissionDraftInput>;

export const adminMissionKeys = {
  workspaces: ["admin-workspaces"] as const,
  list: (workspace: string, status: string) => ["admin-missions", workspace, status] as const,
  detail: (id: string) => ["admin-mission", id] as const,
};

export function fetchWorkspaces() {
  return adminFetch<{ workspaces: AdminWorkspace[] }>("/admin/workspaces");
}
export function fetchAdminMissions(workspace: string, status: string) {
  const qs = new URLSearchParams();
  if (workspace) qs.set("workspace", workspace);
  if (status) qs.set("status", status);
  return adminFetch<{ missions: AdminMissionRow[] }>(`/admin/missions?${qs.toString()}`);
}
export function fetchAdminMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}`);
}
export function createMission(body: MissionDraftInput) {
  return adminFetch<{ mission: AdminMission }>("/admin/missions", { method: "POST", body: JSON.stringify(body) });
}
export function updateMission(id: string, patch: MissionPatch) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function publishMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
}
export function closeMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/close`, { method: "POST", body: JSON.stringify({}) });
}
export function deleteMissionDraft(id: string) {
  return adminFetch<{ ok: true }>(`/admin/missions/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- src/lib/admin.test.ts`
Expected: PASS (new cases + existing `admin.test.ts` cases still green — `AdminRequestError extends Error`, so any existing catch-on-Error still works).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat(brand): admin mission fetchers + AdminRequestError (carries fields)"
```

---

## Task 11: Frontend — the "Missions" tab

**Files:**
- Modify: `src/components/admin/AdminTabs.tsx`
- Modify: `src/lib/i18n.dict.ts` (lines ~547 EN, ~1151 ZH)

- [ ] **Step 1: Add the i18n key in BOTH locales**

In `src/lib/i18n.dict.ts`, after the EN `"app.admin.tabApplications": "Applications",` (line ~547) add:

```typescript
    "app.admin.tabMissions": "Missions",
```

After the ZH `"app.admin.tabApplications": "申請",` (line ~1151) add:

```typescript
    "app.admin.tabMissions": "任務",
```

(Both locales are required, or the tab renders the raw key string.)

- [ ] **Step 2: Add the tab to `AdminTabs.tsx`**

Insert a "Missions" entry as the first tab in the `tabs` array:

```typescript
  const tabs = useMemo(
    () => [
      { to: "/admin/missions", label: t("app.admin.tabMissions") },
      { to: "/admin/applications", label: t("app.admin.tabApplications") },
      { to: "/admin/engaged", label: t("app.admin.tabEngaged") },
      { to: "/admin/submissions", label: t("app.admin.tabSubmissions") },
      { to: "/admin/creators", label: t("app.admin.tabCreators") },
    ] as const,
    [t],
  );
```

- [ ] **Step 3: Verify the layout test still passes**

Run: `npm run test -- src/routes/-admin.test.tsx`
Expected: PASS — the test asserts `活躍創作者` + `outlet` render; the extra tab doesn't break it. (No edit needed; if you want explicit coverage, add `expect(screen.getByText("任務")).toBeInTheDocument();` to the authed-tab test.)

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminTabs.tsx src/lib/i18n.dict.ts
git commit -m "feat(brand): Missions tab in /admin"
```

---

## Task 12: Frontend — authoring list route

**Files:**
- Create: `src/routes/admin.missions.index.tsx`
- Create: `src/routes/-admin.missions.index.test.tsx`

- [ ] **Step 1: Write the list route**

```tsx
// src/routes/admin.missions.index.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError, AdminRequestError, adminMissionKeys, closeMission, deleteMissionDraft,
  fetchAdminMissions, fetchWorkspaces, publishMission, type AdminMissionRow,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

export const Route = createFileRoute("/admin/missions/")({ component: MissionsList });

const STATUSES = ["", "draft", "active", "closed"] as const;
const STATUS_LABEL: Record<string, string> = { "": "全部", draft: "草稿", active: "進行中", closed: "已關閉" };

function MissionsList() {
  const { secret, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState("");
  const [status, setStatus] = useState("");

  const ws = useQuery({ queryKey: adminMissionKeys.workspaces, queryFn: fetchWorkspaces, enabled: !!secret, retry: false });
  // Default to the first workspace once loaded.
  useEffect(() => {
    if (!workspace && ws.data?.workspaces.length) setWorkspace(ws.data.workspaces[0].id);
  }, [ws.data, workspace]);

  const list = useQuery({
    queryKey: adminMissionKeys.list(workspace, status),
    queryFn: () => fetchAdminMissions(workspace, status),
    enabled: !!secret && !!workspace,
    retry: false,
  });
  useEffect(() => {
    for (const e of [ws.error, list.error]) if (e instanceof AdminAuthError) reportAuthError(e);
  }, [ws.error, list.error, reportAuthError]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-missions"] });
  const onErr = (e: unknown) => window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  const publish = useMutation({ mutationFn: publishMission, onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: closeMission, onSuccess: invalidate, onError: onErr });
  const remove = useMutation({ mutationFn: deleteMissionDraft, onSuccess: invalidate, onError: onErr });

  if (ws.data && ws.data.workspaces.length === 0) {
    return <p className="text-sm text-[var(--color-soft-ink)]">尚未有任何品牌 workspace。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="品牌" value={workspace} onChange={(e) => setWorkspace(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {(ws.data?.workspaces ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Link to="/admin/missions/new" className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">+ 新任務</Link>
      </div>

      {list.isLoading ? <p className="text-sm">載入中…</p> : null}
      {list.data?.missions.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">此品牌尚未有任務。</p> : null}

      <div className="space-y-3">
        {list.data?.missions.map((m: AdminMissionRow) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading font-bold">{m.title}</p>
                <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[m.status]}</span>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs">{m.mission_type}</span>
                {m.engaged ? <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">已有參與</span> : null}
              </div>
              <p className="text-xs text-[var(--color-soft-ink)]">{m.slug} · {m.points_reward} 分{m.cash_reward ? ` / $${m.cash_reward}` : ""} · {m.filled}/{m.quota} · {m.deadline ?? "無截止"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => navigate({ to: "/admin/missions/$missionId", params: { missionId: m.id } })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">編輯</button>
              {m.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate(m.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
              {m.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此任務？將停止新報名。")) close.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
              {m.status === "draft" ? <button disabled={remove.isPending} onClick={() => { if (window.confirm("刪除此草稿？")) remove.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">刪除</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the list route test**

```tsx
// src/routes/-admin.missions.index.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(), fetchAdminMissions: vi.fn(), publishMission: vi.fn(), closeMission: vi.fn(), deleteMissionDraft: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchWorkspaces: h.fetchWorkspaces, fetchAdminMissions: h.fetchAdminMissions,
  publishMission: h.publishMission, closeMission: h.closeMission, deleteMissionDraft: h.deleteMissionDraft,
  adminMissionKeys: { workspaces: ["w"], list: (a: string, b: string) => ["m", a, b], detail: (id: string) => ["d", id] },
  AdminAuthError: class extends Error {}, AdminRequestError: class extends Error {},
}));

import { Route } from "./admin.missions.index";

function r() {
  const C = (Route as unknown as { component: React.ComponentType }).component;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin missions list", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists missions for the default workspace and shows a Publish action on drafts", async () => {
    h.fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: "w1", slug: "demo", name: "Demo" }] });
    h.fetchAdminMissions.mockResolvedValue({
      missions: [{ id: "m1", title: "草稿任務", slug: "test-x", mission_type: "ugc", status: "draft", engaged: false, points_reward: 100, cash_reward: null, filled: 0, quota: 10, deadline: null }],
    });
    h.publishMission.mockResolvedValue({});
    r();
    await screen.findByText("草稿任務");
    expect(screen.getByText("草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByText("發佈"));
    await waitFor(() => expect(h.publishMission).toHaveBeenCalledWith("m1"));
  });
});
```

- [ ] **Step 3: Generate routes + type-check**

Run: `npm run type-check`
Expected: PASS — TanStack route codegen picks up `admin.missions.index` (regenerates `routeTree.gen.ts`). If type-check complains the route isn't registered, run the project's codegen (it runs as part of `type-check`/`dev`).

- [ ] **Step 4: Run the test**

Run: `npm run test -- src/routes/-admin.missions.index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.missions.index.tsx src/routes/-admin.missions.index.test.tsx
git commit -m "feat(brand): /admin/missions authoring list"
```

---

## Task 13: Frontend — shared `MissionEditor` + create/edit routes

**Files:**
- Create: `src/components/admin/MissionEditor.tsx`
- Create: `src/routes/admin.missions.new.tsx`
- Create: `src/routes/admin.missions.$missionId.tsx`
- Create: `src/routes/-admin.missions.editor.test.tsx`

- [ ] **Step 1: Write the shared editor component**

```tsx
// src/components/admin/MissionEditor.tsx
import { useState } from "react";
import { MISSION_CATEGORIES } from "@/lib/missionCategories";
import { AdminRequestError, type AdminMission, type MissionDraftInput } from "@/lib/admin";

const MISSION_TYPES = ["koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador"] as const;
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
const EFFORTS = ["", "low", "medium", "high"] as const;

type Mode = "create" | "edit";
type Props = {
  mode: Mode;
  initial?: AdminMission;
  workspaces?: { id: string; name: string }[];
  engaged?: boolean;
  onSave: (body: MissionDraftInput) => Promise<unknown>;
  saving?: boolean;
};

const toLines = (a?: string[] | null) => (a ?? []).join("\n");
const fromLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function MissionEditor({ mode, initial, workspaces = [], engaged = false, onSave, saving }: Props) {
  const published = mode === "edit" && initial?.status !== "draft";
  const [f, setF] = useState({
    workspace_id: initial?.workspace_id ?? workspaces[0]?.id ?? "",
    slug: initial?.slug ?? "",
    title: initial?.title ?? "",
    mission_type: initial?.mission_type ?? "ugc",
    description: initial?.description ?? "",
    category: initial?.category ?? "",
    access_type: initial?.access_type ?? "open",
    required_level: initial?.required_level ?? "L0",
    points_reward: String(initial?.points_reward ?? ""),
    cash_reward: initial?.cash_reward != null ? String(initial.cash_reward) : "",
    cpm_rate: initial?.cpm_rate != null ? String(initial.cpm_rate) : "",
    cpm_budget_pool: initial?.cpm_budget_pool != null ? String(initial.cpm_budget_pool) : "",
    deadline: initial?.deadline ?? "",
    quota: String(initial?.quota ?? "10"),
    deliverables: toLines(initial?.deliverables),
    requirements: toLines(initial?.requirements),
    platforms: toLines(initial?.platforms),
    effort: initial?.effort ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const isCpm = f.mission_type === "performance_cpm";

  const submit = async () => {
    setErrors({});
    const body: MissionDraftInput = {
      workspace_id: f.workspace_id, slug: f.slug, title: f.title, mission_type: f.mission_type,
      description: f.description || null, category: f.category || null,
      access_type: f.access_type as "open" | "application", required_level: f.required_level,
      // Off-type reward fields are nulled on save so no stale values persist.
      points_reward: isCpm ? 0 : Number(f.points_reward || 0),
      cash_reward: isCpm ? null : numOrNull(f.cash_reward),
      cpm_rate: isCpm ? numOrNull(f.cpm_rate) : null,
      cpm_budget_pool: isCpm ? numOrNull(f.cpm_budget_pool) : null,
      deadline: f.deadline || null, quota: Number(f.quota || 0),
      deliverables: fromLines(f.deliverables), requirements: fromLines(f.requirements), platforms: fromLines(f.platforms),
      effort: (f.effort || null) as MissionDraftInput["effort"],
    };
    try {
      await onSave(body);
    } catch (e) {
      if (e instanceof AdminRequestError && e.fields) setErrors(e.fields);
      else window.alert(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="text-xs font-bold text-red-600">{errors[k]}</p> : null);
  const input = "h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm disabled:opacity-50";
  const area = "w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm";
  const lockNote = (reason: string) => <span className="ml-2 text-xs text-[var(--color-soft-ink)]">{reason}</span>;

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">基本</h2>
        <label className="block text-sm">品牌
          <select aria-label="品牌" className={input} value={f.workspace_id} disabled={mode === "edit"} onChange={set("workspace_id")}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">標題 (zh-HK)
          <input aria-label="標題" className={input} value={f.title} onChange={set("title")} /><Err k="title" />
        </label>
        <label className="block text-sm">Slug (english){published ? lockNote("已發佈：不可更改") : null}
          <input aria-label="Slug" className={input} value={f.slug} disabled={published} onChange={set("slug")} /><Err k="slug" />
        </label>
        <label className="block text-sm">分類
          <select aria-label="分類" className={input} value={f.category} onChange={set("category")}>
            <option value="">— 選擇 —</option>
            {MISSION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select><Err k="category" />
        </label>
        <label className="block text-sm">任務類型{published ? lockNote("已發佈：不可更改") : null}
          <select aria-label="任務類型" className={input} value={f.mission_type} disabled={published} onChange={set("mission_type")}>
            {MISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select><Err k="mission_type" />
        </label>
        <label className="block text-sm">參與方式{engaged ? lockNote("已鎖定") : null}
          <select aria-label="參與方式" className={input} value={f.access_type} disabled={engaged} onChange={set("access_type")}>
            <option value="open">公開 (open)</option>
            <option value="application">申請制 (application)</option>
          </select><Err k="access_type" />
        </label>
        <label className="block text-sm">等級要求{engaged ? lockNote("已鎖定") : null}
          <select aria-label="等級要求" className={input} value={f.required_level} disabled={engaged} onChange={set("required_level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select><Err k="required_level" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">獎勵{engaged ? lockNote("已鎖定") : null}</h2>
        {isCpm ? (
          <>
            <label className="block text-sm">CPM 單價
              <input aria-label="CPM 單價" className={input} type="number" value={f.cpm_rate} disabled={engaged} onChange={set("cpm_rate")} /><Err k="cpm_rate" />
            </label>
            <label className="block text-sm">預算池
              <input aria-label="預算池" className={input} type="number" value={f.cpm_budget_pool} disabled={engaged} onChange={set("cpm_budget_pool")} /><Err k="cpm_budget_pool" />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">積分獎勵
              <input aria-label="積分獎勵" className={input} type="number" value={f.points_reward} disabled={engaged} onChange={set("points_reward")} /><Err k="points_reward" />
            </label>
            <label className="block text-sm">現金獎勵 (HK$)
              <input aria-label="現金獎勵" className={input} type="number" value={f.cash_reward} disabled={engaged} onChange={set("cash_reward")} /><Err k="cash_reward" />
            </label>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">名額與期限</h2>
        <label className="block text-sm">名額{engaged ? lockNote(`不可低於已參與人數 (${initial?.filled ?? 0})`) : null}
          <input aria-label="名額" className={input} type="number" min={engaged ? initial?.filled ?? 1 : 1} value={f.quota} onChange={set("quota")} /><Err k="quota" />
        </label>
        <label className="block text-sm">截止日期{engaged ? lockNote("只可延後") : null}
          <input aria-label="截止日期" className={input} type="date" value={f.deadline} onChange={set("deadline")} /><Err k="deadline" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">簡介</h2>
        <label className="block text-sm">任務簡介
          <textarea aria-label="任務簡介" rows={4} className={area} value={f.description} onChange={set("description")} /><Err k="description" />
        </label>
        <label className="block text-sm">交付項目（每行一項）
          <textarea aria-label="交付項目" rows={3} className={area} value={f.deliverables} onChange={set("deliverables")} />
        </label>
        <label className="block text-sm">要求（每行一項）
          <textarea aria-label="要求" rows={3} className={area} value={f.requirements} onChange={set("requirements")} />
        </label>
        <label className="block text-sm">平台（每行一個）
          <textarea aria-label="平台" rows={2} className={area} value={f.platforms} onChange={set("platforms")} />
        </label>
        <label className="block text-sm">投入程度
          <select aria-label="投入程度" className={input} value={f.effort} onChange={set("effort")}>
            {EFFORTS.map((e) => <option key={e} value={e}>{e === "" ? "— 不指定 —" : e}</option>)}
          </select><Err k="effort" />
        </label>
      </section>

      <button onClick={submit} disabled={saving} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-2 font-heading font-bold">
        {mode === "create" ? "儲存草稿" : "儲存變更"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the create route**

```tsx
// src/routes/admin.missions.new.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, createMission, fetchWorkspaces, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { MissionEditor } from "@/components/admin/MissionEditor";

export const Route = createFileRoute("/admin/missions/new")({ component: NewMission });

function NewMission() {
  const { secret, reportAuthError } = useAdminAuth();
  const navigate = useNavigate();
  const ws = useQuery({ queryKey: adminMissionKeys.workspaces, queryFn: fetchWorkspaces, enabled: !!secret, retry: false });
  useEffect(() => { if (ws.error instanceof AdminAuthError) reportAuthError(ws.error); }, [ws.error, reportAuthError]);
  const create = useMutation({
    mutationFn: (body: MissionDraftInput) => createMission(body),
    onSuccess: () => navigate({ to: "/admin/missions" }),
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">新任務（草稿）</h1>
      <MissionEditor mode="create" workspaces={ws.data?.workspaces ?? []} saving={create.isPending}
        onSave={(body) => create.mutateAsync(body)} />
    </div>
  );
}
```

- [ ] **Step 3: Write the edit route**

```tsx
// src/routes/admin.missions.$missionId.tsx
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, fetchAdminMission, updateMission, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { MissionEditor } from "@/components/admin/MissionEditor";

export const Route = createFileRoute("/admin/missions/$missionId")({ component: EditMission });

function EditMission() {
  const { missionId } = useParams({ from: "/admin/missions/$missionId" });
  const { secret, reportAuthError } = useAdminAuth();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: adminMissionKeys.detail(missionId),
    queryFn: () => fetchAdminMission(missionId),
    enabled: !!secret, retry: false,
  });
  useEffect(() => { if (q.error instanceof AdminAuthError) reportAuthError(q.error); }, [q.error, reportAuthError]);
  const update = useMutation({
    mutationFn: (body: MissionDraftInput) => updateMission(missionId, body),
    onSuccess: () => navigate({ to: "/admin/missions" }),
  });

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務。</p>;
  const m = q.data.mission;
  const engaged = (m.filled ?? 0) > 0; // server is authoritative; this drives the disabled hints
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">編輯任務 — {m.title}</h1>
      <MissionEditor mode="edit" initial={m} engaged={engaged} saving={update.isPending}
        onSave={(body) => update.mutateAsync(body)} />
    </div>
  );
}
```

> NOTE: the client `engaged` flag here only drives disabled-field *hints* using `filled`. The server's `validateEdit` (with the full engagement check incl. terminal-state exclusion) is the source of truth — a wrongly-enabled field still 422s and surfaces via `fields`.

- [ ] **Step 4: Write the editor test**

```tsx
// src/routes/-admin.missions.editor.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MissionEditor } from "@/components/admin/MissionEditor";
import type { AdminMission } from "@/lib/admin";

vi.mock("@/lib/missionCategories", () => ({ MISSION_CATEGORIES: ["美容", "餐飲"], ALL_CATEGORY: "全部" }));

const active: AdminMission = {
  id: "m1", workspace_id: "w1", slug: "test-x", title: "任務", description: "d", category: "美容",
  mission_type: "ugc", access_type: "open", required_level: "L0", points_reward: 100, cash_reward: null,
  cpm_rate: null, cpm_budget_pool: null, deadline: "2030-01-01", quota: 10, filled: 3, status: "active",
  deliverables: [], requirements: [], platforms: [], effort: null, updated_at: "", published_at: "", closed_at: null,
};

describe("MissionEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows CPM fields only for performance_cpm", () => {
    render(<MissionEditor mode="create" workspaces={[{ id: "w1", name: "Demo" }]} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("CPM 單價")).toBeNull();
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "performance_cpm" } });
    expect(screen.getByLabelText("CPM 單價")).toBeInTheDocument();
    expect(screen.queryByLabelText("積分獎勵")).toBeNull();
  });

  it("disables slug & mission_type on a published mission, and economic fields when engaged", () => {
    render(<MissionEditor mode="edit" initial={active} engaged onSave={vi.fn()} />);
    expect(screen.getByLabelText("Slug")).toBeDisabled();
    expect(screen.getByLabelText("任務類型")).toBeDisabled();
    expect(screen.getByLabelText("積分獎勵")).toBeDisabled();
    expect(screen.getByLabelText("標題")).not.toBeDisabled(); // brief always editable
  });

  it("renders per-field server errors from AdminRequestError.fields", async () => {
    class AdminRequestError extends Error { fields?: Record<string, string>; constructor(m: string, fields: Record<string, string>) { super(m); this.fields = fields; } }
    const onSave = vi.fn().mockRejectedValue(new AdminRequestError("bad", { title: "請輸入任務標題" }));
    // Make the component's instanceof check match this local class.
    vi.doMock("@/lib/admin", () => ({ AdminRequestError }));
    render(<MissionEditor mode="create" workspaces={[{ id: "w1", name: "Demo" }]} onSave={onSave} />);
    fireEvent.click(screen.getByText("儲存草稿"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});
```

> NOTE on the 3rd test: `instanceof AdminRequestError` depends on the real class from `@/lib/admin`. Prefer importing the real `AdminRequestError` from `@/lib/admin` and constructing it directly (it accepts `(message, code, fields)`), rather than a local subclass — that makes the `instanceof` branch fire and asserts `screen.getByText("請輸入任務標題")` appears. Adjust the test to import and throw the real error, then assert the rendered field message.

- [ ] **Step 5: Type-check, regenerate routes, run tests**

Run: `npm run type-check`
Expected: PASS (route codegen registers `admin.missions.new` + `admin.missions.$missionId`).

Run: `npm run test -- src/routes/-admin.missions.editor.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MissionEditor.tsx src/routes/admin.missions.new.tsx src/routes/admin.missions.\$missionId.tsx src/routes/-admin.missions.editor.test.tsx
git commit -m "feat(brand): mission editor + create/edit routes"
```

---

## Task 14: Full gates + deploy ordering

**Files:** none (verification + release)

- [ ] **Step 1: Run the full gate suite**

Run, in order:
```bash
npm run type-check   # TanStack route codegen + tsc (NOT bare tsc)
npm run lint
npm run check:esm    # new server files must use .js relative imports
npm run build
npm run test         # unit + (integration only if .env.test.local is exported)
```
Expected: all green. If integration tests SKIP, export `.env.test.local` into the shell and re-run `npm run test -- server/test/missionAuthoring.test.ts server/test/mission-authoring-schema.test.ts` to confirm 0 failures.

- [ ] **Step 2: Self-review the diff**

Run: `git log --oneline -14` and skim `git diff main...HEAD --stat`.
Confirm: migration present, pure module + tests, route + integration tests, visibility guards on all three creator reads (`missions.ts` list+detail, `copilot.ts`), frontend tab+list+editor, no relative server import missing `.js`.

- [ ] **Step 3: Apply the migration to PROD first**

Apply `supabase/migrations/0018_mission_authoring.sql` to prod `mhkoayftiuojxlrkollf` via the Supabase MCP `apply_migration` (or SQL editor). Confirm the migration tracker ordering first (the repo also has two `20260618`/`20260619` timestamped migrations that sort after `0018_`; verify `0018` lands without an out-of-order conflict, exactly as in prior slices).
Then run `notify pgrst, 'reload schema';` so PostgREST picks up the new columns.
Verify: `select conname from pg_constraint where conname = 'missions_status_chk';` returns one row, and the four new columns exist on `public.missions`.

- [ ] **Step 4: Open the PR and deploy via Git**

```bash
git push -u origin feat/brand-mission-authoring
gh pr create --title "Brand B1: mission authoring" --body "<summary + test evidence>"
```
Merge triggers the Vercel **Git** deploy. NEVER `vercel --prod` from local (it mis-bundles the API). The schema (Step 3) must already be live before this deploy, or `/admin/missions` and the new status filters break.

- [ ] **Step 5: Post-deploy smoke check**

After deploy: confirm `ADMIN_SECRET` is set in Vercel (operator endpoints need it), load `/admin/missions`, create a draft, publish it, confirm it appears in the creator mission list, then close it and confirm it disappears.

---

## Self-Review (plan vs spec)

- **§3 migration** → Task 1. **§4 endpoints** (workspaces/list/detail/create/patch/publish/close/delete + error shapes + `hasEngagement`) → Tasks 7–9. **§5 visibility guards** (missions list+detail, copilot, join-via-guard) → Task 6. **§6 pure module** (isValidSlug/suggestSlug/validateMission/validateEdit, L0–L6, HK-today injection, reward matrix) → Tasks 2–4. **§7 frontend** (tab, list, editor, admin.ts fetchers, shared category constant, off-type nulling, disabled-with-reason, newline textareas) → Tasks 5, 10–13. **§8 testing** → unit (Tasks 2–4), integration (Tasks 6–9), frontend route tests (Tasks 12–13), gates (Task 14). **§10 deploy ordering** → Task 14.
- **Type consistency:** `MissionInput`/`MissionRecord`/`ValidationResult` defined in Task 2 are reused verbatim in Tasks 3–4 and imported by the route in Tasks 7–9. `AdminMission`/`MissionDraftInput`/`AdminRequestError` defined in Task 10 are consumed by Tasks 12–13. `validateMission(input, mode, today)` and `validateEdit(existing, patch, hasEngagement)` signatures are stable across all call sites.
- **No placeholders:** every code step ships complete code; the two `> NOTE` callouts (workspaces test path, editor error-test) tell the implementer the exact clean form to use.
- **One open implementer choice (intentional):** i18n surface — the tab label is added in both locales (Task 11); the rest of the Missions UI uses inline zh-HK strings (internal operator tool), matching the spec's "mission content fields are free-text zh-HK" and keeping the i18n dict small. If the reviewer prefers full i18n keys, that is a mechanical follow-up, not a blocker.
