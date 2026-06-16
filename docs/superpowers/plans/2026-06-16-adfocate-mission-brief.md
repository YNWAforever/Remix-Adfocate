# Mission Brief (creator-facing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each mission detail page a real creator "brief" — surface already-populated hidden fields (mission_type, spots-left, cash, eligibility, brand) plus four new structured columns (deliverables, requirements, platforms, effort), with every section degrading gracefully so the page never renders blank.

**Architecture:** Add 4 nullable/defaulted columns to `public.missions`; the detail API already returns `select("*")` so new columns ride along — only a `workspaces(name)` brand join is added and flattened to `brand`. Frontend gets a pure, unit-tested `missionMeta.ts` helper module and two presentational components (`MissionFacts`, `MissionBrief`) wired into the detail route between the header and the **unchanged** action zone.

**Tech Stack:** Postgres/Supabase, Hono, React 19 + TanStack Router/Query, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-16-adfocate-mission-brief-design.md`

**Branch:** create `feat/mission-brief` off `fix/mission-detail-navigation` (HEAD `d02cb36`, which contains the nav-Outlet fix). The brief is only reachable with that fix. The nav fix should still ship as its own PR (#17); if it merges first, rebase this branch onto `main`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/0011_mission_brief.sql` | 4 brief columns on `missions` | Create |
| `server/routes/missions.ts` | `GET /:slug` brand join + flatten | Modify |
| `server/test/missions.test.ts` | integration: new fields + brand | Modify |
| `src/lib/queries/kocmax.ts` | `Mission` type gains brief fields + `brand` | Modify |
| `src/lib/missionMeta.ts` | pure label/eligibility/spots helpers | Create |
| `src/lib/-missionMeta.test.ts` | unit tests for the helpers | Create |
| `src/components/MissionFacts.tsx` | 2×2 facts grid (reward/spots/deadline/eligibility) | Create |
| `src/components/-MissionFacts.test.tsx` | component tests | Create |
| `src/components/MissionBrief.tsx` | overview/deliverables/requirements/platforms/effort | Create |
| `src/components/-MissionBrief.test.tsx` | component tests | Create |
| `src/routes/_app.mission.$missionSlug.tsx` | wire facts+brief, mission_type pill, `useMe` | Modify |
| `src/routes/-_app.mission.$missionSlug.test.tsx` | mock `useMe`; brief assertions | Modify |
| `supabase/seed.sql` | example brief content on 2 demo missions | Modify |

---

## Task 0: Branch

- [ ] **Step 1: Create the branch off the nav fix**

```bash
cd "/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2"
git checkout fix/mission-detail-navigation
git checkout -b feat/mission-brief
```

---

## Task 1: Migration — brief columns

**Files:**
- Create: `supabase/migrations/0011_mission_brief.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Slice A (mission brief): structured brief fields on missions so the detail page can
-- show a creator what to make / requirements / where to post / effort. Additive,
-- nullable-or-defaulted — table-level select grant + existing RLS already cover them.
alter table public.missions
  add column deliverables text[] not null default '{}',
  add column requirements text[] not null default '{}',
  add column platforms    text[] not null default '{}',
  add column effort        text check (effort in ('low','medium','high'));
```

- [ ] **Step 2: Apply to the local stack**

Run: `npx supabase db reset`
Expected: re-applies all migrations including `Applying migration 0011_mission_brief.sql...` with no SQL error, then seeds.

(If the local stack/Docker is not running: `colima start` then `npx supabase start` first.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_mission_brief.sql
git commit -m "feat(brief): migration — deliverables/requirements/platforms/effort columns"
```

---

## Task 2: Backend — detail returns new fields + brand

**Files:**
- Modify: `server/routes/missions.ts` (the `GET /:slug` handler, ~line 61)
- Modify: `server/test/missions.test.ts` (add a test inside the existing `suite`)

- [ ] **Step 1: Write the failing integration test**

In `server/test/missions.test.ts`, add this `it` block inside the existing `suite("mission list + my + apply", …)` (after the `/apply` test, before the RLS-isolation test):

```ts
  it("GET /:slug returns the brief fields + brand", async () => {
    await makeMission({ slug: "test-brief-fields", access_type: "open" });
    const res = await req("/missions/test-brief-fields", koc.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brand).toBe("Demo Brand");          // joined from workspaces.name
    expect(Array.isArray(body.deliverables)).toBe(true);
    expect(Array.isArray(body.requirements)).toBe(true);
    expect(Array.isArray(body.platforms)).toBe(true);
    expect(body).not.toHaveProperty("workspaces");   // nested join flattened away
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/missions.test.ts`
Expected: FAIL — `body.brand` is `undefined` (the current `select("*")` has no join), so the `toBe("Demo Brand")` assertion fails.

- [ ] **Step 3: Add the brand join + flatten**

In `server/routes/missions.ts`, replace the `GET /:slug` handler (currently):

```ts
missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(data);
});
```

with:

```ts
missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*, workspaces(name)")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  // Flatten the joined brand name to a top-level `brand`; drop the nested object.
  const { workspaces, ...rest } = data as Record<string, unknown> & { workspaces?: { name?: string } | null };
  return c.json({ ...rest, brand: workspaces?.name ?? null });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/missions.test.ts`
Expected: PASS (the existing tests + the new brief-fields test).

- [ ] **Step 5: Commit**

```bash
git add server/routes/missions.ts server/test/missions.test.ts
git commit -m "feat(brief): detail API returns brief fields + brand name"
```

---

## Task 3: Frontend — missionMeta helpers (pure, unit-tested)

**Files:**
- Create: `src/lib/missionMeta.ts`
- Create: `src/lib/-missionMeta.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/-missionMeta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { missionTypeLabel, platformLabel, effortLabel, spotsLeft, eligibility } from "./missionMeta";

describe("missionMeta", () => {
  it("maps mission types, falling back to the raw value", () => {
    expect(missionTypeLabel("ugc")).toBe("原創內容");
    expect(missionTypeLabel("koc_trial")).toBe("體驗開箱");
    expect(missionTypeLabel("mystery_type")).toBe("mystery_type");
  });

  it("maps platforms, capitalising unknowns", () => {
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("xiaohongshu")).toBe("小紅書");
    expect(platformLabel("bilibili")).toBe("Bilibili");
  });

  it("labels effort, null for none", () => {
    expect(effortLabel("high")).toBe("高");
    expect(effortLabel(null)).toBeNull();
    expect(effortLabel(undefined)).toBeNull();
  });

  it("computes spots left, clamped at 0", () => {
    expect(spotsLeft(10, 7)).toBe(3);
    expect(spotsLeft(5, 9)).toBe(0);
  });

  it("computes eligibility against the creator level", () => {
    expect(eligibility("L0", "L0").qualified).toBe(true);
    expect(eligibility("L1", "L3").qualified).toBe(true);
    const locked = eligibility("L2", "L1");
    expect(locked.qualified).toBe(false);
    expect(locked.label).toBe("需 L2 · 你係 L1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/-missionMeta.test.ts`
Expected: FAIL — `./missionMeta` does not exist (module resolution error).

- [ ] **Step 3: Implement the helpers**

Create `src/lib/missionMeta.ts`:

```ts
import { levelIndex } from "./levels";

export const MISSION_TYPE_LABEL: Record<string, string> = {
  koc_trial: "體驗開箱",
  ugc: "原創內容",
  clipping: "短片剪輯",
  affiliate: "分潤帶貨",
  performance_cpm: "流量任務",
  live_commerce: "直播帶貨",
  brand_ambassador: "品牌大使",
};
export function missionTypeLabel(type: string): string {
  return MISSION_TYPE_LABEL[type] ?? type;
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  xiaohongshu: "小紅書",
  youtube: "YouTube",
  threads: "Threads",
  facebook: "Facebook",
};
export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export type EffortLevel = "low" | "medium" | "high";
const EFFORT_LABEL: Record<EffortLevel, string> = { low: "低", medium: "中", high: "高" };
export function effortLabel(effort: EffortLevel | null | undefined): string | null {
  return effort ? EFFORT_LABEL[effort] : null;
}

export function spotsLeft(quota: number, filled: number): number {
  return Math.max(0, quota - filled);
}

export type Eligibility = { qualified: boolean; label: string };
/** Display-only. The real gate is server-side (join/apply return `level_locked` 409). */
export function eligibility(
  requiredLevel: string | undefined | null,
  creatorLevel: string | undefined | null,
): Eligibility {
  const need = levelIndex(requiredLevel);
  const have = levelIndex(creatorLevel);
  const reqId = requiredLevel ?? "L0";
  if (have >= need) {
    return { qualified: true, label: need === 0 ? "所有等級可參加" : `需 ${reqId} · 你符合` };
  }
  return { qualified: false, label: `需 ${reqId} · 你係 ${creatorLevel ?? "L0"}` };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/-missionMeta.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/missionMeta.ts src/lib/-missionMeta.test.ts
git commit -m "feat(brief): missionMeta label/spots/eligibility helpers"
```

---

## Task 4: Frontend — Mission type + MissionFacts component

**Files:**
- Modify: `src/lib/queries/kocmax.ts` (the `Mission` type, ~line 5)
- Create: `src/components/MissionFacts.tsx`
- Create: `src/components/-MissionFacts.test.tsx`

- [ ] **Step 1: Extend the `Mission` type**

In `src/lib/queries/kocmax.ts`, replace the `Mission` type (currently):

```ts
export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; access_type?: string; points_reward: number;
  deadline?: string; quota: number; filled: number; status: string;
  my_status?: SubmissionStatus | null;
};
```

with:

```ts
export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; access_type?: string; points_reward: number;
  cash_reward?: number | null; required_level?: string;
  deliverables?: string[]; requirements?: string[]; platforms?: string[];
  effort?: "low" | "medium" | "high" | null; brand?: string | null;
  deadline?: string; quota: number; filled: number; status: string;
  my_status?: SubmissionStatus | null;
};
```

- [ ] **Step 2: Write the failing component test**

Create `src/components/-MissionFacts.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionFacts } from "./MissionFacts";
import type { Mission } from "@/lib/queries/kocmax";

const base: Mission = {
  id: "m1", slug: "m1", title: "T", mission_type: "ugc", points_reward: 300,
  quota: 10, filled: 7, status: "active",
};

describe("MissionFacts", () => {
  it("shows reward, spots left, no-deadline fallback, and eligibility", () => {
    render(<MissionFacts mission={base} creatorLevel="L0" />);
    expect(screen.getByText(/300 積分/)).toBeInTheDocument();
    expect(screen.getByText("尚餘 3 個")).toBeInTheDocument();
    expect(screen.getByText("無截止日期")).toBeInTheDocument();
    expect(screen.getByText("所有等級可參加")).toBeInTheDocument();
  });

  it("appends cash when present and shows 額滿 when full", () => {
    render(<MissionFacts mission={{ ...base, cash_reward: 500, filled: 10 }} creatorLevel="L0" />);
    expect(screen.getByText(/HK\$500/)).toBeInTheDocument();
    expect(screen.getByText("額滿")).toBeInTheDocument();
  });

  it("shows a locked eligibility label when under-levelled", () => {
    render(<MissionFacts mission={{ ...base, required_level: "L2" }} creatorLevel="L1" />);
    expect(screen.getByText("需 L2 · 你係 L1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/-MissionFacts.test.tsx`
Expected: FAIL — `./MissionFacts` does not exist.

- [ ] **Step 4: Implement the component**

Create `src/components/MissionFacts.tsx`:

```tsx
import { Star, Users, Clock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { spotsLeft, eligibility } from "@/lib/missionMeta";

function Fact({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok?: boolean }) {
  return (
    <div className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <span className={ok === false ? "text-[var(--color-magenta)]" : "text-[var(--color-ink)]"} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</p>
        <p className="truncate font-heading font-bold">{value}</p>
      </div>
    </div>
  );
}

export function MissionFacts({ mission, creatorLevel }: { mission: Mission; creatorLevel?: string | null }) {
  const left = spotsLeft(mission.quota, mission.filled);
  const elig = eligibility(mission.required_level, creatorLevel);
  const reward = `${mission.points_reward} 積分${mission.cash_reward ? ` · HK$${mission.cash_reward}` : ""}`;
  return (
    <section className="grid grid-cols-2 gap-3">
      <Fact icon={<Star size={18} />} label="獎勵" value={reward} />
      <Fact icon={<Users size={18} />} label="名額" value={left > 0 ? `尚餘 ${left} 個` : "額滿"} ok={left > 0} />
      <Fact icon={<Clock size={18} />} label="截止" value={mission.deadline ? mission.deadline.slice(0, 10) : "無截止日期"} />
      <Fact icon={<ShieldCheck size={18} />} label="資格" value={elig.label} ok={elig.qualified} />
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/-MissionFacts.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kocmax.ts src/components/MissionFacts.tsx src/components/-MissionFacts.test.tsx
git commit -m "feat(brief): Mission type fields + MissionFacts grid"
```

---

## Task 5: Frontend — MissionBrief component

**Files:**
- Create: `src/components/MissionBrief.tsx`
- Create: `src/components/-MissionBrief.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/-MissionBrief.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionBrief } from "./MissionBrief";
import type { Mission } from "@/lib/queries/kocmax";

const base: Mission = {
  id: "m1", slug: "m1", title: "T", mission_type: "ugc", points_reward: 300,
  quota: 10, filled: 7, status: "active",
};

describe("MissionBrief", () => {
  it("renders every populated section", () => {
    render(<MissionBrief mission={{
      ...base,
      description: "幫品牌試用新精華",
      deliverables: ["1 條 Reel ≥30 秒"],
      requirements: ["標註 @brand"],
      platforms: ["instagram", "tiktok"],
      effort: "medium",
    }} />);
    expect(screen.getByText("關於任務")).toBeInTheDocument();
    expect(screen.getByText("幫品牌試用新精華")).toBeInTheDocument();
    expect(screen.getByText("交付內容")).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel ≥30 秒")).toBeInTheDocument();
    expect(screen.getByText("注意事項")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
    expect(screen.getByText("中")).toBeInTheDocument();
  });

  it("shows a placeholder when the brief is entirely empty", () => {
    render(<MissionBrief mission={base} />);
    expect(screen.getByText("詳情陸續更新")).toBeInTheDocument();
    expect(screen.queryByText("交付內容")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/-MissionBrief.test.tsx`
Expected: FAIL — `./MissionBrief` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/MissionBrief.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { platformLabel, effortLabel } from "@/lib/missionMeta";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="mb-2 font-heading font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function MissionBrief({ mission }: { mission: Mission }) {
  const deliverables = mission.deliverables ?? [];
  const requirements = mission.requirements ?? [];
  const platforms = mission.platforms ?? [];
  const effort = effortLabel(mission.effort);
  const hasAny =
    !!mission.description || deliverables.length > 0 || requirements.length > 0 || platforms.length > 0 || !!effort;

  if (!hasAny) return <p className="text-sm text-[var(--color-soft-ink)]">詳情陸續更新</p>;

  return (
    <div className="space-y-4">
      {mission.description && (
        <Section title="關於任務">
          <p className="text-sm text-[var(--color-soft-ink)]">{mission.description}</p>
        </Section>
      )}
      {deliverables.length > 0 && (
        <Section title="交付內容">
          <ul className="list-disc space-y-1 pl-5 text-sm">{deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </Section>
      )}
      {requirements.length > 0 && (
        <Section title="注意事項">
          <ul className="list-disc space-y-1 pl-5 text-sm">{requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      )}
      {platforms.length > 0 && (
        <Section title="發佈平台">
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <span key={p} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-heading font-bold">{platformLabel(p)}</span>
            ))}
          </div>
        </Section>
      )}
      {effort && (
        <Section title="預計投入">
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{effort}</span>
        </Section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/-MissionBrief.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/MissionBrief.tsx src/components/-MissionBrief.test.tsx
git commit -m "feat(brief): MissionBrief sections with graceful empties"
```

---

## Task 6: Wire the brief into the detail page

**Files:**
- Modify: `src/routes/_app.mission.$missionSlug.tsx`
- Modify: `src/routes/-_app.mission.$missionSlug.test.tsx`

- [ ] **Step 1: Update the component test (mock `useMe`, add brief assertions)**

In `src/routes/-_app.mission.$missionSlug.test.tsx`:

(a) add `useMe: () => ({ data: { level: "L0" } }),` to the `vi.mock("@/lib/queries/kocmax", …)` factory (alongside the other hooks);

(b) in `beforeEach`, after the existing resets, also reset the brief fields so tests don't leak:

```tsx
    hoisted.mission.data.deliverables = [];
    hoisted.mission.data.requirements = [];
    hoisted.mission.data.platforms = [];
    hoisted.mission.data.description = "d";
```

(c) add these two tests inside the `describe("Mission detail writes", …)` block (after the existing tests):

```tsx
  it("shows the facts grid (spots left)", () => {
    renderDetail();
    expect(screen.getByText("尚餘 4 個")).toBeInTheDocument(); // quota 5 - filled 1
  });

  it("renders brief deliverables when present", () => {
    hoisted.mission.data.deliverables = ["1 條 Reel"];
    renderDetail();
    expect(screen.getByText("交付內容")).toBeInTheDocument();
    expect(screen.getByText("1 條 Reel")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run "src/routes/-_app.mission.\$missionSlug.test.tsx"`
Expected: FAIL — `交付內容` / `尚餘 4 個` not rendered yet (the detail page still shows the old 任務詳情/獎勵 sections), and `useMe` is now referenced by the component.

- [ ] **Step 3: Rewire the detail page**

In `src/routes/_app.mission.$missionSlug.tsx`:

(a) replace the import block

```tsx
import { ArrowLeft, Star, Clock, Lightbulb } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";
import { HookPanel } from "@/components/HookPanel";
```

with

```tsx
import { ArrowLeft, Lightbulb } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission, useMe } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";
import { HookPanel } from "@/components/HookPanel";
import { MissionFacts } from "@/components/MissionFacts";
import { MissionBrief } from "@/components/MissionBrief";
import { missionTypeLabel } from "@/lib/missionMeta";
```

(b) add the `me` hook beside the others (after `const apply = useApplyMission(missionSlug);`):

```tsx
  const me = useMe();
```

(c) replace the category badge + the three info sections (the `{m.data.category && <BadgePill>…</BadgePill>}` line through the closing `)}` of the deadline section) — i.e.:

```tsx
        {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
        <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="mb-1 font-heading font-bold">任務詳情</h3>
          <p className="text-sm text-[var(--color-soft-ink)]">{m.data.description}</p>
        </section>
        <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <Star className="text-[var(--color-magenta)]" aria-hidden />
          <div><p className="font-heading font-bold">獎勵積分</p><p className="font-display text-lg">{m.data.points_reward} 積分</p></div>
        </section>
        {m.data.deadline && (
          <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <Clock aria-hidden />
            <div><p className="font-heading font-bold">截止日期</p><p>{m.data.deadline.slice(0, 10)}</p></div>
          </section>
        )}
```

with

```tsx
        <div className="flex flex-wrap items-center gap-2">
          {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{missionTypeLabel(m.data.mission_type)}</span>
        </div>
        <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
        <MissionFacts mission={m.data} creatorLevel={me.data?.level} />
        <MissionBrief mission={m.data} />
```

(The action zone and the `{!isApplication && ( … HookPanel … )}` block below stay exactly as-is. `Star` and `Clock` are no longer imported because their only uses were removed.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/routes/-_app.mission.\$missionSlug.test.tsx"`
Expected: PASS (all prior tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/_app.mission.\$missionSlug.tsx" "src/routes/-_app.mission.\$missionSlug.test.tsx"
git commit -m "feat(brief): render facts + brief on the mission detail page"
```

---

## Task 7: Seed — example brief content for local dev

**Files:**
- Modify: `supabase/seed.sql` (after the missions insert, ~line 13)

- [ ] **Step 1: Append brief content for two demo missions**

In `supabase/seed.sql`, immediately after the `insert into public.missions (...) values (...);` block (the 6 demo missions ending with `ugc-travel`), add:

```sql
-- Brief content for two demo missions (so the detail page renders a real brief locally)
update public.missions set
  description  = '幫品牌試用全新美容精華，分享你的真實體驗。',
  deliverables = array['1 條 Reel（≥30 秒）開箱試用','3 個限時動態（含產品標註）'],
  requirements = array['標註 @demo_brand 及 #DemoSerum','勿提及任何競品','發佈後保留貼文 ≥30 日'],
  platforms    = array['instagram','tiktok'],
  effort       = 'medium'
where slug = 'koc-trial-serum';

update public.missions set
  description  = '到指定咖啡店打卡，影低你最鍾意嘅一杯。',
  deliverables = array['1 篇圖文帖（≥3 張相）'],
  requirements = array['標註店舖位置','日光時段拍攝'],
  platforms    = array['instagram'],
  effort       = 'low'
where slug = 'ugc-cafe';
```

- [ ] **Step 2: Re-seed the local stack**

Run: `npx supabase db reset`
Expected: migrations re-apply (incl. `0011`) and `Seeding data from supabase/seed.sql...` succeeds with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(brief): seed example brief content for local dev"
```

---

## Task 8: Final verification gates

**Files:** none (verification only).

- [ ] **Step 1: Full unit/component suite**

Run: `npm test`
Expected: all pass; integration suites SKIP (no Supabase env in jsdom). New `missionMeta`, `MissionFacts`, `MissionBrief`, and the updated mission-detail tests included.

- [ ] **Step 2: Full integration suite**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`
Expected: all pass, including the new `GET /:slug` brief-fields test in `missions.test.ts`.

- [ ] **Step 3: type-check, lint, build**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all clean (the pre-existing >500 kB chunk warning from `vite build` is benign).

- [ ] **Step 4: Confirm scope**

Run: `git status` and `git diff --stat main...HEAD` — confirm the diff is limited to the files in this plan (plus the inherited nav-fix commit if this branch is still stacked on `fix/mission-detail-navigation`).

---

## After all tasks

Use **superpowers:finishing-a-development-branch** → push + open PR (the user merges). Then:

1. **Apply `0011_mission_brief.sql` to production** (`mhkoayftiuojxlrkollf`) via the Supabase SQL editor (or `mcp__supabase__apply_migration`), then `notify pgrst, 'reload schema';` — **before** the Vercel deploy reads the new columns (the frontend degrades gracefully, but follow the order; same lesson as Slice 9).
2. **Backfill the 6 live missions** with real brief copy (`update public.missions set deliverables=…, requirements=…, platforms=…, effort=…, description=… where slug=…`) — operator data-entry; until then the live detail pages show only the facts grid.
3. The nav-fix PR (`fix/mission-detail-navigation`, commit `d02cb36`) must also be merged for the brief to be reachable.

Record status in memory.
