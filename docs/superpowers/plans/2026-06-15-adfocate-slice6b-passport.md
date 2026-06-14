# Creator Passport (Slice 6B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, earned Creator Passport page — level + XP, four score rings (Influence + Reliability computed; Content + Brand Safety locked), and data-derived badges — reached from the profile page and the home level chip.

**Architecture:** All passport data is **computed on read** (no migration). A new `GET /api/me/passport` handler reads the caller's own creator row + submissions via the per-request user client and one service-scoped referral count, then delegates the math to pure functions in `server/lib/passport.ts`. The frontend adds presentation metadata (`src/lib/passport.ts`), an SVG `ScoreRing`, a `/passport` route, and a `useMyPassport` query; the profile page and home chip link into it.

**Tech Stack:** TypeScript, Hono (server), Supabase (user/service clients), React 19, TanStack Router (file routes via `tsr generate`), TanStack Query, Vitest (jsdom for unit/component; node + live local Supabase for `test:integration`).

**Spec:** `docs/superpowers/specs/2026-06-15-adfocate-slice6b-passport-design.md`

**Branch:** `feat/slice6b-passport` (already rebased onto `main` after PR #11 merged).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `server/lib/passport.ts` (create) | Pure compute: tier map, reliability, badges, `buildPassport()` + types | 1 |
| `server/lib/passport.test.ts` (create) | Unit tests for the pure functions (no DB; runs in `npm test`) | 1 |
| `server/routes/me.ts` (modify) | Add `GET /api/me/passport` handler (DB reads → `buildPassport`) | 2 |
| `server/test/helpers.ts` (modify) | Add `seedSubmission`, `setReferredBy`; null inbound referrals in `cleanup` | 2 |
| `server/test/passport.test.ts` (create) | Integration tests (reliability/influence/locked/badges/empty) | 2 |
| `package.json` (modify) | Register `passport.test.ts` in `test:integration` | 2 |
| `src/lib/passport.ts` (create) | Presentation metadata: `SCORE_META`, `SCORE_ORDER`, `BADGES` | 3 |
| `src/lib/passport.test.ts` (create) | Shape tests for the metadata | 3 |
| `src/lib/queries/kocmax.ts` (modify) | `Passport` type + `useMyPassport()` | 4 |
| `src/lib/queries/kocmax.test.tsx` (modify) | Hook test for `useMyPassport` | 4 |
| `src/components/ScoreRing.tsx` (create) | SVG gauge; `null` → locked "敬請期待" | 5 |
| `src/components/ScoreRing.test.tsx` (create) | Number vs locked render | 5 |
| `src/routes/_app.passport.tsx` (create) | `/passport` page: header + 2×2 rings + badges | 6 |
| `src/routes/-_app.passport.test.tsx` (create) | Page render test | 6 |
| `src/routes/_app.profile.tsx` (modify) | Add "創作者護照" link to the quick-links grid | 7 |
| `src/routes/-_app.profile.test.tsx` (modify) | Assert the passport link | 7 |
| `src/routes/_app.home.tsx` (modify) | Wrap the level chip in `<Link to="/passport">` | 7 |
| `src/routes/-_app.home.test.tsx` (modify) | Assert the chip links to `/passport` | 7 |

**Gate commands** (run from `adfocate-2/`): `npm run type-check` · `npm run lint` · `npm test` · `npm run build`. Integration (local stack up via `supabase start`, schema via `supabase db reset`): `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`.

---

## Task 1: Backend pure compute (`server/lib/passport.ts`)

**Files:**
- Create: `server/lib/passport.ts`
- Test: `server/lib/passport.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `server/lib/passport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { influenceFor, reliabilityFor, countTerminal, levelOrdinal, buildPassport } from "./passport";

describe("influenceFor", () => {
  it("is null when there are no handles", () => {
    expect(influenceFor(null)).toBeNull();
    expect(influenceFor([])).toBeNull();
  });
  it("maps total followers to the tier (step function)", () => {
    expect(influenceFor([{ followers: 0 }])).toBe(0);
    expect(influenceFor([{ followers: 999 }])).toBe(0);
    expect(influenceFor([{ followers: 1000 }])).toBe(20);
    expect(influenceFor([{ followers: 5000 }, { followers: 6000 }])).toBe(50); // 11k
    expect(influenceFor([{ followers: 100000 }])).toBe(80);
    expect(influenceFor([{ followers: 1000000 }])).toBe(100);
  });
  it("treats missing followers as 0", () => {
    expect(influenceFor([{ followers: null }, {}])).toBe(0);
  });
});

describe("reliabilityFor", () => {
  it("is null with no concluded submissions", () => {
    expect(reliabilityFor({ approved: 0, rejected: 0, expired: 0 })).toBeNull();
  });
  it("is the rounded approval rate over concluded", () => {
    expect(reliabilityFor({ approved: 2, rejected: 1, expired: 1 })).toBe(50);
    expect(reliabilityFor({ approved: 2, rejected: 1, expired: 0 })).toBe(67);
    expect(reliabilityFor({ approved: 3, rejected: 0, expired: 0 })).toBe(100);
  });
});

describe("countTerminal", () => {
  it("counts only terminal statuses (in-flight ignored)", () => {
    expect(
      countTerminal(["approved", "approved", "rejected", "expired", "joined", "submitted", "under_review"]),
    ).toEqual({ approved: 2, rejected: 1, expired: 1 });
  });
});

describe("levelOrdinal", () => {
  it("maps L0..L6 → 0..6 and junk → -1", () => {
    expect(levelOrdinal("L0")).toBe(0);
    expect(levelOrdinal("L6")).toBe(6);
    expect(levelOrdinal("nope")).toBe(-1);
    expect(levelOrdinal(null)).toBe(-1);
  });
});

describe("buildPassport", () => {
  const base = { level: "L0", xp: 0, socialHandles: null, statuses: [] as string[], referredCount: 0 };

  it("a fresh creator earns nothing and locks content + brand safety", () => {
    const p = buildPassport(base);
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
    expect(p.xp).toBe(0);
  });
  it("content + brand safety stay null even with data", () => {
    const p = buildPassport({ ...base, socialHandles: [{ followers: 1000 }], statuses: ["approved"] });
    expect(p.scores.content).toBeNull();
    expect(p.scores.brandSafety).toBeNull();
  });
  it("earns level_l1 at L1+", () => {
    expect(buildPassport({ ...base, level: "L1" }).badges).toContain("level_l1");
  });
  it("earns first_approval with one approved submission", () => {
    expect(buildPassport({ ...base, statuses: ["approved"] }).badges).toContain("first_approval");
  });
  it("earns reliable only at 3+ concluded AND reliability >= 80", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "rejected"] }).badges).not.toContain("reliable"); // 67%
    expect(
      buildPassport({ ...base, statuses: ["approved", "approved", "approved", "approved", "rejected"] }).badges,
    ).toContain("reliable"); // 80% over 5
  });
  it("earns social_linked with a handle and referrer with a referral", () => {
    expect(buildPassport({ ...base, socialHandles: [{ followers: 0 }] }).badges).toContain("social_linked");
    expect(buildPassport({ ...base, referredCount: 1 }).badges).toContain("referrer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd adfocate-2 && npx vitest run server/lib/passport.test.ts`
Expected: FAIL — `Failed to resolve import "./passport"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `server/lib/passport.ts`:

```ts
/** Pure passport computation — no DB, no I/O. The handler in routes/me.ts feeds it raw
 *  rows; these functions own the score/badge rules so they're unit-testable in isolation. */

export type PassportSocialHandle = { followers?: number | null };

export type PassportScores = {
  influence: number | null; // computed; null = no social handles yet
  reliability: number | null; // computed; null = no concluded submissions yet
  content: null; // locked until 6C
  brandSafety: null; // locked until 6C
};

export type Passport = {
  level: string;
  xp: number;
  scores: PassportScores;
  badges: string[];
};

export type SubmissionCounts = { approved: number; rejected: number; expired: number };

const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];

/** 0..6 for L0..L6; unknown/empty → -1 (so the L1 badge check fails closed). */
export function levelOrdinal(level: string | null | undefined): number {
  return level ? LEVEL_IDS.indexOf(level) : -1;
}

/** Step function over total followers. `null` when the creator has no handles at all
 *  (distinct from a real 0 — a creator with handles totalling 0 followers). */
export function influenceFor(handles: PassportSocialHandle[] | null | undefined): number | null {
  if (!handles || handles.length === 0) return null;
  const total = handles.reduce((sum, h) => sum + (h.followers ?? 0), 0);
  if (total >= 1_000_000) return 100;
  if (total >= 100_000) return 80;
  if (total >= 10_000) return 50;
  if (total >= 1_000) return 20;
  return 0;
}

/** Tally terminal statuses; in-flight (joined/submitted/under_review) are excluded. */
export function countTerminal(statuses: string[]): SubmissionCounts {
  let approved = 0;
  let rejected = 0;
  let expired = 0;
  for (const s of statuses) {
    if (s === "approved") approved++;
    else if (s === "rejected") rejected++;
    else if (s === "expired") expired++;
  }
  return { approved, rejected, expired };
}

/** Approval rate over concluded submissions; `null` when none are concluded. */
export function reliabilityFor(counts: SubmissionCounts): number | null {
  const concluded = counts.approved + counts.rejected + counts.expired;
  if (concluded === 0) return null;
  return Math.round((100 * counts.approved) / concluded);
}

export function buildPassport(input: {
  level: string;
  xp: number;
  socialHandles: PassportSocialHandle[] | null | undefined;
  statuses: string[];
  referredCount: number;
}): Passport {
  const counts = countTerminal(input.statuses);
  const concluded = counts.approved + counts.rejected + counts.expired;
  const reliability = reliabilityFor(counts);
  const influence = influenceFor(input.socialHandles);
  const handleCount = input.socialHandles?.length ?? 0;

  const badges: string[] = [];
  if (levelOrdinal(input.level) >= 1) badges.push("level_l1");
  if (counts.approved >= 1) badges.push("first_approval");
  if (concluded >= 3 && (reliability ?? 0) >= 80) badges.push("reliable");
  if (handleCount >= 1) badges.push("social_linked");
  if (input.referredCount >= 1) badges.push("referrer");

  return {
    level: input.level,
    xp: input.xp,
    scores: { influence, reliability, content: null, brandSafety: null },
    badges,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd adfocate-2 && npx vitest run server/lib/passport.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/passport.ts server/lib/passport.test.ts
git commit -m "feat(passport): pure score + badge computation"
```

---

## Task 2: Backend handler `GET /api/me/passport`

**Files:**
- Modify: `server/routes/me.ts` (add handler after the `/level-seen` handler)
- Modify: `server/test/helpers.ts` (add `seedSubmission`, `setReferredBy`; harden `cleanup`)
- Create: `server/test/passport.test.ts`
- Modify: `package.json` (register the new integration test)

- [ ] **Step 1: Add test helpers**

In `server/test/helpers.ts`, add after `setXp` (before `cleanup`):

```ts
/** Insert a mission_submissions row in a terminal status (service-role, bypassing the
 *  join→submit→review RPC chain). Creates a throwaway "test-" mission per call so the
 *  (mission_id, creator_id) unique constraint never collides. */
export async function seedSubmission(creatorId: string, status: string, slug: string) {
  const m = await makeMission({ slug });
  const { error } = await service()
    .from("mission_submissions")
    .insert({ mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status });
  if (error) throw error;
}

/** Point one creator's referred_by at another (service-role; set only at bootstrap in
 *  prod). Used to exercise the passport 'referrer' badge. */
export async function setReferredBy(childId: string, parentId: string) {
  const { error } = await service().from("creators").update({ referred_by: parentId }).eq("id", childId);
  if (error) throw error;
}
```

In `cleanup`, immediately after the `ids` array is computed and before the `for (const id of ids)` loop, add:

```ts
  // Null any inbound referral inside the test set so deleting a referred creator never
  // trips the referred_by FK (creators.referred_by → creators.id, no ON DELETE clause).
  if (ids.length) await service().from("creators").update({ referred_by: null }).in("id", ids);
```

- [ ] **Step 2: Write the failing integration test**

Create `server/test/passport.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, seedSubmission, setReferredBy, setXp, cleanup, hasSupabaseEnv } from "./helpers";

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

suite("creator passport", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("a fresh creator gets all-null scores and no badges", async () => {
    const c = await makeCreator("passport-empty@test.local");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
  });

  it("computes reliability from concluded submissions (in-flight ignored)", async () => {
    const c = await makeCreator("passport-rel@test.local");
    await seedSubmission(c.userId, "approved", "test-pp-rel-1");
    await seedSubmission(c.userId, "approved", "test-pp-rel-2");
    await seedSubmission(c.userId, "rejected", "test-pp-rel-3");
    await seedSubmission(c.userId, "expired", "test-pp-rel-4");
    await seedSubmission(c.userId, "joined", "test-pp-rel-5"); // in-flight → excluded
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBe(50); // round(100 * 2/4)
    expect(p.badges).toContain("first_approval");
  });

  it("reliability is null when only in-flight submissions exist", async () => {
    const c = await makeCreator("passport-relnull@test.local");
    await seedSubmission(c.userId, "joined", "test-pp-relnull-1");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBeNull();
  });

  it("computes influence from social-handle followers and earns social_linked", async () => {
    const c = await makeCreator("passport-inf@test.local");
    await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "Instagram", handle: "@x", followers: 12000 }] }),
    });
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.influence).toBe(50); // 12k ≥ 10k tier
    expect(p.badges).toContain("social_linked");
  });

  it("content and brand safety are always locked (null)", async () => {
    const c = await makeCreator("passport-locked@test.local");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBeNull();
    expect(p.scores.brandSafety).toBeNull();
  });

  it("earns level_l1 once xp crosses L1 and referrer with a referred creator", async () => {
    const c = await makeCreator("passport-badges@test.local");
    const child = await makeCreator("passport-child@test.local");
    await setXp(c.userId, 500); // → L1
    await setReferredBy(child.userId, c.userId);
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.level).toBe("L1");
    expect(p.badges).toContain("level_l1");
    expect(p.badges).toContain("referrer");
  });
});
```

- [ ] **Step 3: Register the test in the integration script**

In `package.json`, append ` server/test/passport.test.ts` to the end of the `test:integration` command string (after `server/test/leveling.test.ts`).

- [ ] **Step 4: Run to verify it fails**

Run: `cd adfocate-2 && set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npx vitest run --no-file-parallelism server/test/passport.test.ts`
Expected: FAIL — `GET /api/me/passport` 404s (handler not added), so JSON lacks `scores`.

- [ ] **Step 5: Add the handler**

In `server/routes/me.ts`, add this import at the top (after the existing `import { serviceClient, makeUserClient } ...` line):

```ts
import { buildPassport } from "../lib/passport.js";
```

Then add this handler at the end of the file, after the `/level-seen` handler:

```ts
/** GET /api/me/passport — the Creator Passport: live level + XP, four score rings, and
 *  data-derived badges, all computed on read (no migration). Reliability + Influence come
 *  from the caller's own submissions / social handles via the user client (RLS self-scoped);
 *  Content + Brand Safety are locked (null) until 6C. The referrer badge needs a count of
 *  OTHER creators' rows (referred_by = me) which RLS hides from the user client, so that one
 *  count uses the service client — it exposes a number, not other creators' data. */
meRoutes.get("/passport", async (c) => {
  const userId = c.get("userId");
  const supabase = makeUserClient(c.get("jwt"));

  const { data: creator, error: cErr } = await supabase
    .from("creators")
    .select("level, xp, social_handles")
    .eq("id", userId)
    .single();
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);

  const { data: subs, error: sErr } = await supabase
    .from("mission_submissions")
    .select("status")
    .eq("creator_id", userId);
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);

  const { count: referredCount, error: rErr } = await serviceClient()
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", userId);
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);

  const passport = buildPassport({
    level: creator.level,
    xp: creator.xp,
    socialHandles: creator.social_handles as { followers?: number | null }[] | null,
    statuses: (subs ?? []).map((s) => s.status as string),
    referredCount: referredCount ?? 0,
  });
  return c.json(passport);
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd adfocate-2 && set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npx vitest run --no-file-parallelism server/test/passport.test.ts`
Expected: PASS (6/6).

- [ ] **Step 7: Commit**

```bash
git add server/routes/me.ts server/test/helpers.ts server/test/passport.test.ts package.json
git commit -m "feat(passport): GET /api/me/passport handler + integration tests"
```

---

## Task 3: Frontend presentation metadata (`src/lib/passport.ts`)

**Files:**
- Create: `src/lib/passport.ts`
- Test: `src/lib/passport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/passport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SCORE_META, SCORE_ORDER, BADGES, type ScoreKey } from "./passport";

describe("passport metadata", () => {
  it("weights sum to 100 (master-spec weights)", () => {
    const sum = (Object.keys(SCORE_META) as ScoreKey[]).reduce((s, k) => s + SCORE_META[k].weight, 0);
    expect(sum).toBe(100);
  });
  it("orders all four scores and every key has metadata", () => {
    expect(SCORE_ORDER).toHaveLength(4);
    for (const k of SCORE_ORDER) expect(SCORE_META[k]).toBeDefined();
  });
  it("defines the five data-derived badges", () => {
    for (const id of ["level_l1", "first_approval", "reliable", "social_linked", "referrer"]) {
      expect(BADGES[id]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd adfocate-2 && npx vitest run src/lib/passport.test.ts`
Expected: FAIL — cannot resolve `./passport`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/passport.ts`:

```ts
export type ScoreKey = "influence" | "content" | "reliability" | "brandSafety";

/** Display metadata for the four passport scores. `weight` is the master-spec score weight
 *  (Influence 40 / Content 30 / Reliability 20 / Brand Safety 10); `accent` is the ring
 *  stroke colour (Content + Brand Safety always render locked, so their accent is unused). */
export const SCORE_META: Record<ScoreKey, { label: string; weight: number; accent: string }> = {
  influence: { label: "影響力", weight: 40, accent: "var(--color-acid)" },
  content: { label: "內容", weight: 30, accent: "var(--color-ink)" },
  reliability: { label: "可靠度", weight: 20, accent: "var(--color-magenta)" },
  brandSafety: { label: "品牌安全", weight: 10, accent: "var(--color-ink)" },
};

/** Render order for the 2×2 grid (highest weight first). */
export const SCORE_ORDER: ScoreKey[] = ["influence", "content", "reliability", "brandSafety"];

/** Render metadata for the five data-derived badge ids the backend can return. */
export const BADGES: Record<string, { emoji: string; label: string; desc: string }> = {
  level_l1: { emoji: "🌟", label: "升級者", desc: "達到 L1 等級" },
  first_approval: { emoji: "✅", label: "首單達成", desc: "首個任務獲批核" },
  reliable: { emoji: "🛡️", label: "可靠創作者", desc: "3+ 個已結算任務，可靠度 ≥ 80" },
  social_linked: { emoji: "🔗", label: "已連結社交", desc: "已連結社交帳號" },
  referrer: { emoji: "🤝", label: "推薦大使", desc: "成功推薦朋友加入" },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd adfocate-2 && npx vitest run src/lib/passport.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/passport.ts src/lib/passport.test.ts
git commit -m "feat(passport): frontend score + badge metadata"
```

---

## Task 4: `useMyPassport` query + `Passport` type

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Test: `src/lib/queries/kocmax.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/lib/queries/kocmax.test.tsx`, update the import on line 5 to include the new hook:

```ts
import { useMissions, useUpdateProfile, useMyPassport } from "./kocmax";
```

Add this describe block at the end of the file:

```ts
describe("useMyPassport", () => {
  it("fetches the passport from /me/passport", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["level_l1"],
    });
    const { result } = renderHook(() => useMyPassport(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/me/passport");
    expect(result.current.data?.badges).toContain("level_l1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd adfocate-2 && npx vitest run src/lib/queries/kocmax.test.tsx`
Expected: FAIL — `useMyPassport` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/queries/kocmax.ts`, add the type after the `Me` type (around line 31):

```ts
export type Passport = {
  level: string;
  xp: number;
  scores: { influence: number | null; reliability: number | null; content: null; brandSafety: null };
  badges: string[];
};
```

Add the hook right after `useMarkLevelSeen` (around line 81):

```ts
export function useMyPassport() {
  return useQuery({ queryKey: ["passport"], queryFn: () => apiFetch<Passport>("/me/passport") });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd adfocate-2 && npx vitest run src/lib/queries/kocmax.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/queries/kocmax.test.tsx
git commit -m "feat(passport): useMyPassport query hook"
```

---

## Task 5: `ScoreRing` component

**Files:**
- Create: `src/components/ScoreRing.tsx`
- Test: `src/components/ScoreRing.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ScoreRing.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from "./ScoreRing";

describe("ScoreRing", () => {
  it("renders the label and the numeric value", () => {
    render(<ScoreRing value={50} label="影響力" accent="var(--color-acid)" />);
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("renders a locked '敬請期待' state for null", () => {
    render(<ScoreRing value={null} label="內容" accent="var(--color-ink)" />);
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("敬請期待")).toBeInTheDocument();
  });

  it("renders a real 0 as the value, not as locked", () => {
    render(<ScoreRing value={0} label="影響力" accent="var(--color-acid)" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("敬請期待")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd adfocate-2 && npx vitest run src/components/ScoreRing.test.tsx`
Expected: FAIL — cannot resolve `./ScoreRing`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ScoreRing.tsx`:

```tsx
/** An SVG circular gauge for a single passport score. `value` is 0..100, or `null` for a
 *  locked score (Content / Brand Safety, or a computed score with no source data yet),
 *  which renders a greyed ring with "敬請期待". A real 0 renders the value, not the lock. */
export function ScoreRing({
  value,
  label,
  accent,
}: {
  value: number | null;
  label: string;
  accent: string;
}) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const locked = value === null;
  const pct = locked ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-ink)" strokeWidth="6" opacity="0.12" />
        {!locked && (
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
          />
        )}
      </svg>
      <span className="font-heading text-sm font-bold">{label}</span>
      <span className="text-xs text-[var(--color-soft-ink)]">{locked ? "敬請期待" : value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd adfocate-2 && npx vitest run src/components/ScoreRing.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/ScoreRing.tsx src/components/ScoreRing.test.tsx
git commit -m "feat(passport): ScoreRing SVG gauge"
```

---

## Task 6: Passport page (`/passport`)

**Files:**
- Create: `src/routes/_app.passport.tsx`
- Test: `src/routes/-_app.passport.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-_app.passport.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", display_name: "阿明", avatar_url: null } },
  passport: {
    data: {
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["level_l1", "social_linked"],
    },
    isLoading: false,
    isError: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useMyPassport: () => hoisted.passport,
}));

import { Route } from "./_app.passport";

function renderPassport() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

describe("Passport page", () => {
  it("renders the four score labels and a computed value", () => {
    renderPassport();
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("可靠度")).toBeInTheDocument();
    expect(screen.getByText("品牌安全")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("renders locked rings as 敬請期待 (content + brand safety + null reliability)", () => {
    renderPassport();
    expect(screen.getAllByText("敬請期待").length).toBeGreaterThanOrEqual(2);
  });

  it("renders earned badge labels", () => {
    renderPassport();
    expect(screen.getByText("升級者")).toBeInTheDocument();
    expect(screen.getByText("已連結社交")).toBeInTheDocument();
  });
});
```

Note: `vi` is available as a global (vitest `globals: true`), matching `-_app.home.test.tsx` usage; the explicit `import { describe, it, expect }` mirrors sibling tests.

- [ ] **Step 2: Run to verify it fails**

Run: `cd adfocate-2 && npx vitest run src/routes/-_app.passport.test.tsx`
Expected: FAIL — cannot resolve `./_app.passport`.

- [ ] **Step 3: Write the implementation**

Create `src/routes/_app.passport.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMe, useMyPassport } from "@/lib/queries/kocmax";
import { progressToNext, LEVELS, levelIndex } from "@/lib/levels";
import { SCORE_META, SCORE_ORDER, BADGES } from "@/lib/passport";
import { ScoreRing } from "@/components/ScoreRing";

export const Route = createFileRoute("/_app/passport")({ component: Passport });

function Passport() {
  const me = useMe();
  const passport = useMyPassport();

  if (passport.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const p = passport.data;
  const prog = progressToNext(p.xp);
  const lvl = LEVELS[levelIndex(p.level)];
  const name = me.data?.display_name ?? "KOC";
  const initial = (name[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
            {me.data?.avatar_url ? <img src={me.data.avatar_url} alt="" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold">{name}</h1>
            <p className="font-heading font-bold">
              <span aria-hidden>{lvl.emoji}</span> {lvl.label} · {p.xp} XP
            </p>
          </div>
        </div>
        {prog.next ? (
          <>
            <div className="h-3 overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white">
              <div className="h-full bg-[var(--color-acid)]" style={{ width: `${prog.pct}%` }} />
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">
              還需 {prog.xpForNext! - prog.xpIntoCurrent} XP 升至 {prog.next.label}
            </p>
          </>
        ) : (
          <p className="text-sm font-heading font-bold">最高等級</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">創作者評分</h2>
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
          {SCORE_ORDER.map((k) => (
            <ScoreRing key={k} value={p.scores[k]} label={SCORE_META[k].label} accent={SCORE_META[k].accent} />
          ))}
        </div>
        <p className="text-xs text-[var(--color-soft-ink)]">影響力為自填數據，未驗證。</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">徽章</h2>
        {p.badges.length ? (
          <div className="grid grid-cols-2 gap-3">
            {p.badges.map((id) => {
              const b = BADGES[id];
              if (!b) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
                >
                  <span className="text-2xl" aria-hidden>
                    {b.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="font-heading text-sm font-bold">{b.label}</p>
                    <p className="truncate text-xs text-[var(--color-soft-ink)]">{b.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-soft-ink)]">完成任務與連結社交帳號即可解鎖徽章。</p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd adfocate-2 && npx vitest run src/routes/-_app.passport.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.passport.tsx src/routes/-_app.passport.test.tsx
git commit -m "feat(passport): /passport page with score rings and badges"
```

---

## Task 7: Entry points (profile link + home chip)

**Files:**
- Modify: `src/routes/_app.profile.tsx`
- Modify: `src/routes/-_app.profile.test.tsx`
- Modify: `src/routes/_app.home.tsx`
- Modify: `src/routes/-_app.home.test.tsx`

- [ ] **Step 1: Write the failing test assertions**

In `src/routes/-_app.profile.test.tsx`, add this test inside the `describe("Profile page", ...)` block:

```ts
  it("links to the creator passport", () => {
    renderProfile();
    expect(screen.getByText("創作者護照").closest("a")).toHaveAttribute("href", "/passport");
  });
```

In `src/routes/-_app.home.test.tsx`, add this test inside the `describe("Home", ...)` block:

```ts
  it("links the level chip to the creator passport", () => {
    renderHome();
    expect(screen.getByLabelText("創作者護照")).toHaveAttribute("href", "/passport");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd adfocate-2 && npx vitest run src/routes/-_app.profile.test.tsx src/routes/-_app.home.test.tsx`
Expected: FAIL — no "創作者護照" element / no element labelled "創作者護照".

- [ ] **Step 3: Add the profile link**

In `src/routes/_app.profile.tsx`, replace the quick-links grid section (the `<section className="grid grid-cols-2 gap-3">` containing the 我的任務 / 兌換記錄 links) with:

```tsx
          <section className="grid grid-cols-2 gap-3">
            <Link
              to="/passport"
              className="col-span-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-4 text-center font-heading font-semibold"
            >
              創作者護照
            </Link>
            <Link
              to="/my"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              我的任務
            </Link>
            <Link
              to="/redemption/history"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              兌換記錄
            </Link>
          </section>
```

- [ ] **Step 4: Wrap the home chip in a Link**

In `src/routes/_app.home.tsx`, replace the level-chip `<span>` block:

```tsx
        {me.data?.level && (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-mono text-xs font-bold">
            {LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}
          </span>
        )}
```

with:

```tsx
        {me.data?.level && (
          <Link
            to="/passport"
            aria-label="創作者護照"
            className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-mono text-xs font-bold"
          >
            {LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}
          </Link>
        )}
```

(`Link` is already imported in `_app.home.tsx`.)

- [ ] **Step 5: Run to verify tests pass**

Run: `cd adfocate-2 && npx vitest run src/routes/-_app.profile.test.tsx src/routes/-_app.home.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app.profile.tsx src/routes/-_app.profile.test.tsx src/routes/_app.home.tsx src/routes/-_app.home.test.tsx
git commit -m "feat(passport): link profile + home chip into /passport"
```

---

## Final gates (after all tasks)

- [ ] `cd adfocate-2 && npm run type-check` — clean (runs `tsr generate` first; the new `/passport` route registers).
- [ ] `cd adfocate-2 && npm run lint` — clean.
- [ ] `cd adfocate-2 && npm test` — all pass (new: `server/lib/passport.test.ts`, `src/lib/passport.test.ts`, `ScoreRing.test.tsx`, `-_app.passport.test.tsx`; updated kocmax/profile/home tests).
- [ ] `cd adfocate-2 && npm run build` — succeeds.
- [ ] Integration: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration` — all pass incl. the 6 new passport tests.
- [ ] Finish with superpowers:finishing-a-development-branch → push → PR (base `main`).

## Self-review notes
- **Spec coverage:** §4 handler (Task 2) · §4.1 Reliability + §4.2 Influence + §4.4 Badges (Task 1, verified Task 2) · §4.3 locked Content/Brand Safety (Tasks 1+2) · §5 `passport.ts`/`ScoreRing`/page/hook/entry points (Tasks 3–7) · §7 tests (every task). The optional `Me.scores` add from §5 is intentionally **skipped** (YAGNI; `creators.scores` is a 6C concern).
- **No migration** — confirmed; zero `supabase/migrations/` changes.
- **Null vs 0** — `ScoreRing` and `buildPassport` both branch on `=== null`, so a real 0 (e.g. 500-follower creator → influence 0) renders as a value, tested in Tasks 1 + 5.
- **Type consistency** — `Passport.scores` shape is identical in `server/lib/passport.ts` and `src/lib/queries/kocmax.ts`; `ScoreKey` ⊆ those keys; `SCORE_ORDER` covers all four.
