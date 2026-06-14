# Slice 6A — Leveling Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `creators.level` a live pure-function of `creators.xp`, surface level + progress-to-next in the UI, and show a one-time server-tracked level-up celebration.

**Architecture:** A DB trigger recomputes `level` from `xp` on every write (activating the already-wired `join_mission` `level_locked` gate); a `level_seen` column + `POST /me/level-seen` endpoint track which level the creator has been celebrated for; the frontend reads `level`/`level_seen`/`xp` from `GET /me`, renders progress on profile + a chip on home, and mounts a `LevelUpModal` in the `_app` layout that fires when `level` is ahead of `level_seen`.

**Tech Stack:** Supabase (Postgres, plpgsql trigger + IMMUTABLE sql function, RLS), Hono backend (`server/`), React 19 + TanStack Router/Query, Vitest (node integration + jsdom component).

**Spec:** `docs/superpowers/specs/2026-06-15-adfocate-slice6-leveling-design.md`

**Correction vs spec:** the spec says the mission gate returns **403** for `level_locked`. The actual mapping in `server/routes/missions.ts` puts `level_locked` in the `RPC_409` set, so it returns **409**. This plan uses 409.

**Branch:** `feat/slice6-leveling` (stacked on `feat/profile-page` / PR #10). Commit after each task.

**Local integration prerequisite:** the local Supabase stack must be running (`supabase start`). Migrations are applied with `supabase db reset` (re-applies 0001–0008). Integration tests do NOT auto-load env — export it first:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration
```

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `supabase/migrations/0008_leveling.sql` | Create | `level_for_xp()` fn, `level_seen` column, `set_level_from_xp()` trigger, backfill, grant |
| `server/test/helpers.ts` | Modify | add `setXp()` service helper for tests |
| `server/test/leveling.test.ts` | Create | integration: thresholds, gate-comes-alive, level_seen + acknowledge |
| `package.json` | Modify | register `leveling.test.ts` in `test:integration` |
| `server/routes/me.ts` | Modify | add `level_seen` to `ME_PROJECTION`; `POST /me/level-seen` handler |
| `src/lib/levels.ts` | Create | `LEVELS` table + `levelIndex()` + `progressToNext()` |
| `src/lib/levels.test.ts` | Create | unit tests for the pure helpers |
| `src/lib/queries/kocmax.ts` | Modify | `Me.level_seen`; `useMarkLevelSeen()` |
| `src/routes/_app.profile.tsx` | Modify | replace level pill+XP with a level-progress block |
| `src/routes/-_app.profile.test.tsx` | Modify | assert the progress block |
| `src/routes/_app.home.tsx` | Modify | compact level chip near the avatar |
| `src/routes/-_app.home.test.tsx` | Modify | assert the chip |
| `src/components/LevelUpModal.tsx` | Create | celebration modal (pending = level ahead of level_seen) |
| `src/components/LevelUpModal.test.tsx` | Create | shows/hides + calls markLevelSeen |
| `src/routes/_app.tsx` | Modify | mount `<LevelUpModal/>` in the layout |

---

## Task 1: DB migration + threshold/gate integration tests

**Files:**
- Create: `supabase/migrations/0008_leveling.sql`
- Modify: `server/test/helpers.ts`
- Create: `server/test/leveling.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the `setXp` test helper**

In `server/test/helpers.ts`, after the `addCodes` function (around line 146, before `export async function cleanup()`), add:

```ts
/** Service-role set of a creator's xp (the user grant intentionally forbids self-update of
 *  xp/level). Used by tests to drive the level trigger across thresholds. */
export async function setXp(userId: string, xp: number) {
  const { error } = await service().from("creators").update({ xp }).eq("id", userId);
  if (error) throw error;
}
```

- [ ] **Step 2: Write the failing integration test**

Create `server/test/leveling.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, setXp, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("leveling engine", () => {
  let c: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("leveling@test.local", 0);
  });
  afterAll(cleanup);

  it("recomputes level from xp at the thresholds", async () => {
    const cases: [number, string][] = [
      [0, "L0"], [499, "L0"], [500, "L1"], [2000, "L2"], [100000, "L6"],
    ];
    for (const [xp, level] of cases) {
      await setXp(c.userId, xp);
      const me = await (await req("/me", c.jwt)).json();
      expect(me.xp).toBe(xp);
      expect(me.level).toBe(level);
    }
  });

  it("activates the mission level-gate once xp crosses the threshold", async () => {
    const g = await makeCreator("leveling-gate@test.local", 0);
    const m = await makeMission({ slug: "test-l2-only", required_level: "L2" });

    const locked = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(locked.status).toBe(409); // level_locked → RPC_409

    await setXp(g.userId, 2000); // → L2
    const ok = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 3: Register the suite and run it to verify it fails**

In `package.json`, append `server/test/leveling.test.ts` to the `test:integration` script's file list (after `server/test/me.test.ts`):

```json
    "test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/redemption.test.ts server/test/wallet.test.ts server/test/me.test.ts server/test/leveling.test.ts"
```

Run (local stack must be up; migration 0008 does NOT exist yet):
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration -- server/test/leveling.test.ts
```
Expected: FAIL — `recomputes level from xp` fails (level stays `L0` after `setXp`, no trigger), and the gate test's second join is not yet unlocked.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0008_leveling.sql`:

```sql
-- Slice 6A: leveling engine. Keep creators.level a pure function of creators.xp,
-- and track the highest level the creator has been *shown* a celebration for.

-- 1. Threshold function: highest level whose XP requirement is <= p_xp ----------
create or replace function public.level_for_xp(p_xp int) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(p_xp, 0) >= 100000 then 'L6'
    when coalesce(p_xp, 0) >=  40000 then 'L5'
    when coalesce(p_xp, 0) >=  15000 then 'L4'
    when coalesce(p_xp, 0) >=   6000 then 'L3'
    when coalesce(p_xp, 0) >=   2000 then 'L2'
    when coalesce(p_xp, 0) >=    500 then 'L1'
    else 'L0'
  end
$$;

-- 2. Column: highest level the creator has been shown a celebration for ---------
alter table public.creators
  add column level_seen text not null default 'L0';

-- 3. Trigger: any write that changes xp recomputes level (never touches level_seen).
--    BEFORE INSERT OR UPDATE OF xp → fires on every insert and on any xp change, so
--    join/submit/approve (and any future xp source) keep level consistent with no
--    per-RPC edits.
create or replace function public.set_level_from_xp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.level := public.level_for_xp(new.xp);
  return new;
end;
$$;

create trigger creators_set_level
  before insert or update of xp on public.creators
  for each row execute function public.set_level_from_xp();

-- 4. Backfill: recompute level for existing rows, then mark it already-seen so the
--    rollout does NOT retro-celebrate creators already past a threshold. (Sets level
--    directly without touching xp, so the trigger does not interfere.)
update public.creators set level = public.level_for_xp(xp);
update public.creators set level_seen = level;

-- 5. Grant: the user client may acknowledge its own celebration (RLS-scoped by the
--    creators_self_update policy from 0003). level/xp remain NOT self-updatable.
grant update (level_seen) on public.creators to authenticated;
```

- [ ] **Step 5: Apply the migration and run the test to verify it passes**

```bash
supabase db reset
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration -- server/test/leveling.test.ts
```
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0008_leveling.sql server/test/helpers.ts server/test/leveling.test.ts package.json
git commit -m "feat(leveling): xp→level trigger + level_for_xp + gate integration tests"
```

---

## Task 2: Backend — `level_seen` projection + acknowledge endpoint

**Files:**
- Modify: `server/routes/me.ts`
- Modify: `server/test/leveling.test.ts`

- [ ] **Step 1: Write the failing test (level_seen pending + acknowledge)**

In `server/test/leveling.test.ts`, add this `it` block inside the `suite("leveling engine", …)` describe (after the gate test):

```ts
  it("tracks level_seen and clears the pending celebration on acknowledge", async () => {
    const d = await makeCreator("leveling-seen@test.local", 0);

    // Fresh creator: level L0, level_seen L0 → nothing pending.
    let me = await (await req("/me", d.jwt)).json();
    expect(me.level).toBe("L0");
    expect(me.level_seen).toBe("L0");

    // Cross to L1: level advances, level_seen lags → pending.
    await setXp(d.userId, 500);
    me = await (await req("/me", d.jwt)).json();
    expect(me.level).toBe("L1");
    expect(me.level_seen).toBe("L0");

    // Acknowledge: level_seen catches up to the current level.
    const ack = await req("/me/level-seen", d.jwt, { method: "POST" });
    expect(ack.status).toBe(200);
    expect((await ack.json()).level_seen).toBe("L1");

    // Idempotent: a second acknowledge is a no-op.
    const ack2 = await req("/me/level-seen", d.jwt, { method: "POST" });
    expect((await ack2.json()).level_seen).toBe("L1");
  });
```

Run it to verify it fails:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration -- server/test/leveling.test.ts
```
Expected: FAIL — `me.level_seen` is `undefined` (not in projection) and `POST /me/level-seen` returns 404 (no route).

- [ ] **Step 2: Add `level_seen` to the projection**

In `server/routes/me.ts`, change `ME_PROJECTION` (line 12-13) to include `level_seen` right after `level`:

```ts
const ME_PROJECTION =
  "id, display_name, avatar_url, level, level_seen, xp, categories, scores, phone, onboarding_step, onboarding_completed, referral_code, social_handles";
```

- [ ] **Step 3: Add the acknowledge handler**

In `server/routes/me.ts`, after the `meRoutes.put("/profile", …)` handler (after line 125, before end of file), add:

```ts
/** POST /api/me/level-seen — acknowledge the level-up celebration. Reads the caller's
 *  current level server-side (so the value can't be forged) and stores it as level_seen,
 *  clearing the pending celebration. Idempotent; RLS scopes the write to id = auth.uid(). */
meRoutes.post("/level-seen", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));

  const { data: current, error: readErr } = await supabase
    .from("creators")
    .select("level")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);

  const { data, error } = await supabase
    .from("creators")
    .update({ level_seen: current.level })
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration -- server/test/leveling.test.ts
```
Expected: PASS (all three leveling tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/me.ts server/test/leveling.test.ts
git commit -m "feat(leveling): level_seen projection + POST /me/level-seen acknowledge"
```

---

## Task 3: Frontend — `levels.ts` table + pure helpers

**Files:**
- Create: `src/lib/levels.ts`
- Create: `src/lib/levels.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/levels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LEVELS, levelIndex, progressToNext } from "./levels";

describe("levels", () => {
  it("has 7 levels L0..L6 with ascending thresholds", () => {
    expect(LEVELS.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(LEVELS[1].xpRequired).toBe(500);
    expect(LEVELS[6].xpRequired).toBe(100000);
  });

  it("levelIndex maps ids to 0..6 and unknown → 0", () => {
    expect(levelIndex("L0")).toBe(0);
    expect(levelIndex("L2")).toBe(2);
    expect(levelIndex("L6")).toBe(6);
    expect(levelIndex(undefined)).toBe(0);
    expect(levelIndex("nope")).toBe(0);
  });

  it("progressToNext computes the band, remaining xp and pct", () => {
    const p0 = progressToNext(0);
    expect(p0.current.id).toBe("L0");
    expect(p0.next?.id).toBe("L1");
    expect(p0.xpIntoCurrent).toBe(0);
    expect(p0.xpForNext).toBe(500);
    expect(p0.pct).toBe(0);

    const p250 = progressToNext(250);
    expect(p250.current.id).toBe("L0");
    expect(p250.pct).toBe(50);

    const p500 = progressToNext(500);
    expect(p500.current.id).toBe("L1");
    expect(p500.next?.id).toBe("L2");
    expect(p500.xpIntoCurrent).toBe(0);
    expect(p500.xpForNext).toBe(1500);

    const pMax = progressToNext(100000);
    expect(pMax.current.id).toBe("L6");
    expect(pMax.next).toBeNull();
    expect(pMax.pct).toBe(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/levels.test.ts`
Expected: FAIL — `Cannot find module './levels'`.

- [ ] **Step 3: Write `levels.ts`**

Create `src/lib/levels.ts`:

```ts
export type LevelDef = {
  id: string;
  label: string;
  emoji: string;
  xpRequired: number;
  /** What unlocks at this level (shown as a hint when it's the *next* level). Empty for L0. */
  unlock: string;
};

export const LEVELS: LevelDef[] = [
  { id: "L0", label: "Newcomer", emoji: "🌱", xpRequired: 0, unlock: "" },
  { id: "L1", label: "Explorer", emoji: "🌟", xpRequired: 500, unlock: "聯盟連結、評測任務、積分兌換" },
  { id: "L2", label: "Creator", emoji: "🎨", xpRequired: 2000, unlock: "UGC 有薪工作、CPM 軌道、工作室" },
  { id: "L3", label: "Amplifier", emoji: "📢", xpRequired: 6000, unlock: "活動費用、完整 Copilot 工具" },
  { id: "L4", label: "Micro-Influencer", emoji: "🚀", xpRequired: 15000, unlock: "直播帶貨、優先任務配對" },
  { id: "L5", label: "Pro Creator", emoji: "💎", xpRequired: 40000, unlock: "品牌大使、Finance Readiness" },
  { id: "L6", label: "Elite", emoji: "👑", xpRequired: 100000, unlock: "客製品牌合作、創作者資本" },
];

/** Index 0..6 of a level id; unknown / undefined → 0. */
export function levelIndex(id: string | undefined | null): number {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i < 0 ? 0 : i;
}

export type Progress = {
  current: LevelDef;
  next: LevelDef | null;
  /** XP earned into the current band. */
  xpIntoCurrent: number;
  /** Width of the current band (next.xpRequired - current.xpRequired); null at L6. */
  xpForNext: number | null;
  /** 0..100 progress through the current band; 100 at L6. */
  pct: number;
};

/** Total for every xp >= 0 (and clamps negatives). Never throws. */
export function progressToNext(xp: number): Progress {
  const safeXp = Math.max(0, xp ?? 0);
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safeXp >= LEVELS[i].xpRequired) idx = i;
  }
  const current = LEVELS[idx];
  const next = idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
  if (!next) {
    return { current, next: null, xpIntoCurrent: safeXp - current.xpRequired, xpForNext: null, pct: 100 };
  }
  const span = next.xpRequired - current.xpRequired;
  const into = safeXp - current.xpRequired;
  const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));
  return { current, next, xpIntoCurrent: into, xpForNext: span, pct };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/levels.ts src/lib/levels.test.ts
git commit -m "feat(leveling): levels table + progressToNext/levelIndex helpers"
```

---

## Task 4: Frontend — `Me.level_seen` + `useMarkLevelSeen`

**Files:**
- Modify: `src/lib/queries/kocmax.ts`

- [ ] **Step 1: Add `level_seen` to the `Me` type**

In `src/lib/queries/kocmax.ts`, in the `Me` type (lines 18-30), add `level_seen` right after `level`:

```ts
  level: string;
  level_seen?: string;
```

- [ ] **Step 2: Add the `useMarkLevelSeen` mutation**

In `src/lib/queries/kocmax.ts`, immediately after `useUpdateProfile()` (after line 72), add:

```ts
export function useMarkLevelSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Me>("/me/level-seen", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/kocmax.ts
git commit -m "feat(leveling): Me.level_seen + useMarkLevelSeen mutation"
```

---

## Task 5: Frontend — profile level-progress block

**Files:**
- Modify: `src/routes/_app.profile.tsx`
- Modify: `src/routes/-_app.profile.test.tsx`

- [ ] **Step 1: Update the profile test to expect the progress block**

In `src/routes/-_app.profile.test.tsx`:

(a) In the `hoisted` mock `me.data` (lines 22-36), change `xp` to a value consistent with `level: "L1"` and add `level_seen`:

```ts
      level: "L1",
      level_seen: "L1",
      xp: 600,
```

(b) Replace the first test's level assertion. Change:

```ts
    expect(screen.getByText("L1")).toBeInTheDocument();
```
to:
```ts
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 Creator")).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: FAIL — `Explorer` / `還需 1400 XP 升至 Creator` not found (component still renders the `L1` pill).

- [ ] **Step 3: Implement the progress block in the profile component**

In `src/routes/_app.profile.tsx`:

(a) Add the import (after line 5, the existing `useMe`/`useUpdateProfile` import):

```ts
import { progressToNext } from "@/lib/levels";
```

(b) Remove the level pill + XP block from the header `<section>`. Delete these lines (currently 94-100):

```tsx
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
              {d.level}
            </span>
            <span className="text-sm text-[var(--color-soft-ink)]">{d.xp} XP</span>
          </div>
```

So the header `<div className="min-w-0">` contains only the `<h1>` name.

(c) Insert a level-progress `<section>` immediately after the header `</section>` (after the closing `</section>` on what is currently line 101, before `{error && …}`):

```tsx
      {(() => {
        const p = progressToNext(d.xp);
        return (
          <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>{p.current.emoji}</span>
              <span className="font-heading font-bold">{p.current.label}</span>
              <span className="ml-auto text-sm text-[var(--color-soft-ink)]">{d.xp} XP</span>
            </div>
            {p.next ? (
              <>
                <div className="h-3 overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white">
                  <div className="h-full bg-[var(--color-acid)]" style={{ width: `${p.pct}%` }} />
                </div>
                <p className="text-sm text-[var(--color-soft-ink)]">
                  還需 {p.xpForNext! - p.xpIntoCurrent} XP 升至 {p.next.label}
                </p>
                <p className="text-xs text-[var(--color-soft-ink)]">解鎖：{p.next.unlock}</p>
              </>
            ) : (
              <p className="text-sm font-heading font-bold">最高等級</p>
            )}
          </section>
        );
      })()}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: PASS (all profile tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.profile.tsx src/routes/-_app.profile.test.tsx
git commit -m "feat(leveling): profile level-progress block"
```

---

## Task 6: Frontend — home level chip

**Files:**
- Modify: `src/routes/_app.home.tsx`
- Modify: `src/routes/-_app.home.test.tsx`

- [ ] **Step 1: Update the home test to expect the chip**

In `src/routes/-_app.home.test.tsx`:

(a) Add `level` to the `useMe` mock (line 18):

```ts
  useMe: () => ({ data: { id: "u1", display_name: "阿明", avatar_url: null, level: "L1" }, isLoading: false }),
```

(b) Add a test inside `describe("Home", …)`:

```ts
  it("shows a level chip with the current level", () => {
    renderHome();
    expect(screen.getByText("🌟 L1")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: FAIL — `🌟 L1` not found.

- [ ] **Step 3: Implement the chip**

In `src/routes/_app.home.tsx`:

(a) Add the import (after line 5, near the other `@/` imports):

```ts
import { LEVELS, levelIndex } from "@/lib/levels";
```

(b) Change the top-right row to hold a chip + the avatar. Replace:

```tsx
      <div className="flex justify-end">
        <Link
```
with:
```tsx
      <div className="flex items-center justify-end gap-2">
        {me.data?.level && (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-mono text-xs font-bold">
            {LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}
          </span>
        )}
        <Link
```

(The `<Link>` and its contents are unchanged; only the wrapping `<div>` class changed and the chip was added before it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: PASS (both home tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.home.tsx src/routes/-_app.home.test.tsx
git commit -m "feat(leveling): home level chip"
```

---

## Task 7: Frontend — `LevelUpModal` + mount in `_app` layout

**Files:**
- Create: `src/components/LevelUpModal.tsx`
- Create: `src/components/LevelUpModal.test.tsx`
- Modify: `src/routes/_app.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/LevelUpModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", level: "L1", level_seen: "L0" } as Record<string, unknown> },
  mark: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useMarkLevelSeen: () => ({ mutate: hoisted.mark, isPending: false }),
}));

import { LevelUpModal } from "./LevelUpModal";

describe("LevelUpModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.me = { data: { id: "u1", level: "L1", level_seen: "L0" } };
  });

  it("shows the celebration when level is ahead of level_seen", () => {
    render(<LevelUpModal />);
    expect(screen.getByText("🎉 你升級了！")).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
  });

  it("calls markLevelSeen when 太好了 is tapped", () => {
    render(<LevelUpModal />);
    fireEvent.click(screen.getByText("太好了"));
    expect(hoisted.mark).toHaveBeenCalled();
  });

  it("renders nothing when level_seen has caught up", () => {
    hoisted.me = { data: { id: "u1", level: "L1", level_seen: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when level_seen is missing (no false celebration)", () => {
    hoisted.me = { data: { id: "u1", level: "L1" } };
    const { container } = render(<LevelUpModal />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/LevelUpModal.test.tsx`
Expected: FAIL — `Cannot find module './LevelUpModal'`.

- [ ] **Step 3: Write `LevelUpModal.tsx`**

Create `src/components/LevelUpModal.tsx`:

```tsx
import { useMe, useMarkLevelSeen } from "@/lib/queries/kocmax";
import { LEVELS, levelIndex } from "@/lib/levels";

/** Celebration shown over any page when the creator's level is ahead of the level they
 *  were last celebrated for. The big XP jump (operator approval) happens out-of-session,
 *  so this is server-tracked via level_seen and fires on the creator's next visit. */
export function LevelUpModal() {
  const me = useMe();
  const mark = useMarkLevelSeen();

  const level = me.data?.level;
  const seen = me.data?.level_seen;
  // No data, or level_seen not present yet → no celebration (avoid a false fire).
  if (!level || seen === undefined) return null;
  if (levelIndex(level) <= levelIndex(seen)) return null;

  const def = LEVELS[levelIndex(level)];
  return (
    <div role="dialog" aria-label="升級" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-6 text-center shadow-[6px_6px_0_0_var(--color-ink)]">
        <p className="font-display text-2xl font-bold">🎉 你升級了！</p>
        <p className="text-5xl" aria-hidden>{def.emoji}</p>
        <p className="font-heading text-xl font-bold">{def.label}</p>
        {def.unlock && <p className="text-sm text-[var(--color-soft-ink)]">解鎖：{def.unlock}</p>}
        <button
          type="button"
          onClick={() => mark.mutate()}
          disabled={mark.isPending}
          className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
        >
          太好了
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/LevelUpModal.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Mount it in the `_app` layout**

In `src/routes/_app.tsx`:

(a) Add the import (after line 8, the `BottomNav` import):

```ts
import { LevelUpModal } from "@/components/LevelUpModal";
```

(b) In `Layout()`, add `<LevelUpModal />` between `<main>` and `<BottomNav />`:

```tsx
      <main><Outlet /></main>
      <LevelUpModal />
      <BottomNav />
```

- [ ] **Step 6: Verify the full unit suite + type-check + build are green**

```bash
npm run type-check
npm test
npm run build
```
Expected: type-check clean; `npm test` all unit/component tests pass (integration suites SKIP without env — that's expected); build succeeds. The `_app` gate test still passes (it exercises only `beforeLoad`, never renders `Layout`).

- [ ] **Step 7: Commit**

```bash
git add src/components/LevelUpModal.tsx src/components/LevelUpModal.test.tsx src/routes/_app.tsx
git commit -m "feat(leveling): level-up celebration modal mounted in _app layout"
```

---

## Final verification (after all tasks)

- [ ] **Full gate green**

```bash
npm run type-check
npm run lint
npm test
npm run build
supabase db reset
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration
```
Expected: type-check clean, lint clean, all unit/component tests pass, build succeeds, and the full integration suite passes (including the 3 new `leveling.test.ts` tests).

## User-gated / operational (not code tasks)
- Apply `supabase/migrations/0008_leveling.sql` to the **cloud DB** via the Supabase SQL editor (the cloud migration tracker lags; `db push` is not used). The migration is idempotent for `level_for_xp`/trigger (`create or replace`) but `alter table … add column level_seen` will error if re-run — apply once.
- No new env vars, no dashboard config.
