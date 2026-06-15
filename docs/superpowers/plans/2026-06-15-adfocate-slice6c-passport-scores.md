# Slice 6C — Passport Scores Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the Creator Passport's Content + Brand Safety scores (operator quality ratings + a non-rejection-rate proxy), persist the four-score snapshot into `creators.scores`, and add three quality-derived badges.

**Architecture:** The pure `server/lib/passport.ts` stays the single source of truth for the math — it gains `contentFor`/`brandSafetyFor` and a `ratings` input. `GET /api/me/passport` still live-computes per request. A new best-effort `persistScores(creatorId)` helper snapshots the computed scores into `creators.scores` at write-moments (approve / reject / social-handle edit). A migration adds `mission_submissions.quality_rating` and rebuilds `approve_submission` to record it and award a +50 XP bonus on a 5★.

**Tech Stack:** TypeScript, Hono, Supabase (Postgres + RLS, SECURITY DEFINER RPCs), Vitest (jsdom unit/component + node integration against a local Supabase stack), React 19 + TanStack Router/Query.

**Spec:** `docs/superpowers/specs/2026-06-15-adfocate-slice6c-passport-scores-design.md`

**Branch:** `feat/slice6c-passport-scores` (already created, stacked on `feat/slice6b-passport`). All work lands here.

**Conventions the engineer must know:**
- **Run a single unit/component test file:** `npx vitest run <path>` (jsdom; `npm test` runs all unit/component tests and self-skips integration).
- **Run integration tests** (need the local Supabase stack up via `supabase start`): source the gitignored local-stack env first, never `.env.local` (that holds PROD creds):
  ```bash
  set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration
  ```
  A single integration file:
  ```bash
  set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/passport.test.ts
  ```
- **Apply a new migration to the local stack:** `supabase db reset` (re-applies `0001`–`0009`). The local DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Type-check:** `npm run type-check` (`tsr generate && tsc --noEmit`). **Lint:** `npm run lint`.
- The Supabase JS client in `server/` is loosely typed — `.select("status, quality_rating")` and `as` casts compile without regenerated DB types.

---

## Task 1: Pure scoring — Content, Brand Safety, badges (extend `server/lib/passport.ts`)

Pure functions + the one in-repo caller, so the tree compiles and unit tests pass with no DB. Runtime correctness is verified by the integration tasks once the migration lands.

**Files:**
- Modify: `server/lib/passport.ts`
- Modify: `server/lib/passport.test.ts`
- Modify: `server/routes/me.ts:145-163` (GET /passport — keep it compiling against the new `buildPassport` signature)

- [ ] **Step 1: Write the failing unit tests**

In `server/lib/passport.test.ts`, update the import line and append/replace tests. Change line 2 to import the two new functions:

```ts
import { influenceFor, reliabilityFor, countTerminal, levelOrdinal, buildPassport, contentFor, brandSafetyFor } from "./passport";
```

Add these two describe blocks (anywhere after the existing `reliabilityFor` block):

```ts
describe("contentFor", () => {
  it("is null when nothing is rated", () => {
    expect(contentFor([])).toBeNull();
  });
  it("scales the average 1-5 rating to 0-100", () => {
    expect(contentFor([5])).toBe(100);
    expect(contentFor([1])).toBe(20);
    expect(contentFor([4, 5])).toBe(90); // round(20 * 4.5)
    expect(contentFor([3, 3, 3])).toBe(60);
  });
});

describe("brandSafetyFor", () => {
  it("is null when nothing is reviewed", () => {
    expect(brandSafetyFor({ approved: 0, rejected: 0, expired: 0 })).toBeNull();
  });
  it("is the non-rejection rate over reviewed (expired excluded)", () => {
    expect(brandSafetyFor({ approved: 3, rejected: 1, expired: 0 })).toBe(75);
    expect(brandSafetyFor({ approved: 0, rejected: 2, expired: 5 })).toBe(0); // expired ignored → 0/2
    expect(brandSafetyFor({ approved: 2, rejected: 0, expired: 9 })).toBe(100); // expired ignored → 2/2
  });
});
```

In the existing `describe("buildPassport", ...)`, update the `base` object to include `ratings` and rewrite the two locked-score tests, then add the 6C-badge tests:

```ts
describe("buildPassport", () => {
  const base = { level: "L0", xp: 0, socialHandles: null, statuses: [] as string[], ratings: [] as number[], referredCount: 0 };

  it("a fresh creator earns nothing and has all-null scores", () => {
    const p = buildPassport(base);
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
    expect(p.xp).toBe(0);
  });
  it("computes content from ratings and brand safety from reviewed submissions", () => {
    const p = buildPassport({ ...base, statuses: ["approved", "rejected"], ratings: [4] });
    expect(p.scores.content).toBe(80); // round(20 * 4)
    expect(p.scores.brandSafety).toBe(50); // 1 approved / (1 approved + 1 rejected)
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
  it("earns perfect_rating when any submission is rated 5", () => {
    expect(buildPassport({ ...base, statuses: ["approved"], ratings: [5] }).badges).toContain("perfect_rating");
    expect(buildPassport({ ...base, statuses: ["approved"], ratings: [4] }).badges).not.toContain("perfect_rating");
  });
  it("earns content_pro at 3+ ratings AND content >= 80", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "approved"], ratings: [5, 4, 5] }).badges).toContain("content_pro"); // avg 4.67 → 93
    expect(buildPassport({ ...base, statuses: ["approved", "approved"], ratings: [5, 5] }).badges).not.toContain("content_pro"); // only 2 ratings
  });
  it("earns spotless at 3+ reviewed AND brand safety 100", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "approved"] }).badges).toContain("spotless");
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "rejected"] }).badges).not.toContain("spotless"); // 67
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/lib/passport.test.ts`
Expected: FAIL — `contentFor`/`brandSafetyFor` are not exported, and `buildPassport` returns `content: null`/`brandSafety: null` so the computed-score and 6C-badge assertions fail.

- [ ] **Step 3: Implement the new functions and extend `buildPassport`**

In `server/lib/passport.ts`, widen the `PassportScores` type (replace lines 6-11):

```ts
export type PassportScores = {
  influence: number | null; // computed; null = no social handles yet
  reliability: number | null; // computed; null = no concluded submissions yet
  content: number | null; // 6C: round(20 * avg rating); null = nothing rated
  brandSafety: number | null; // 6C: non-rejection rate; null = nothing reviewed
};
```

Add the two functions after `reliabilityFor` (after line 59):

```ts
/** Average of the 1-5 quality ratings, scaled to 0-100. null when nothing is rated. */
export function contentFor(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return Math.round(20 * avg);
}

/** Non-rejection rate over REVIEWED submissions (approved + rejected; expired excluded).
 *  null when nothing has been reviewed. A proxy for compliance pass-rate. */
export function brandSafetyFor(counts: SubmissionCounts): number | null {
  const reviewed = counts.approved + counts.rejected;
  if (reviewed === 0) return null;
  return Math.round((100 * counts.approved) / reviewed);
}
```

Replace the whole `buildPassport` function (lines 61-87) with:

```ts
export function buildPassport(input: {
  level: string;
  xp: number;
  socialHandles: PassportSocialHandle[] | null | undefined;
  statuses: string[];
  ratings: number[];
  referredCount: number;
}): Passport {
  const counts = countTerminal(input.statuses);
  const concluded = counts.approved + counts.rejected + counts.expired;
  const reviewed = counts.approved + counts.rejected;
  const reliability = reliabilityFor(counts);
  const influence = influenceFor(input.socialHandles);
  const content = contentFor(input.ratings);
  const brandSafety = brandSafetyFor(counts);
  const handleCount = input.socialHandles?.length ?? 0;

  const badges: string[] = [];
  if (levelOrdinal(input.level) >= 1) badges.push("level_l1");
  if (counts.approved >= 1) badges.push("first_approval");
  if (concluded >= 3 && (reliability ?? 0) >= 80) badges.push("reliable");
  if (handleCount >= 1) badges.push("social_linked");
  if (input.referredCount >= 1) badges.push("referrer");
  if (input.ratings.some((r) => r === 5)) badges.push("perfect_rating");
  if (input.ratings.length >= 3 && (content ?? 0) >= 80) badges.push("content_pro");
  if (reviewed >= 3 && brandSafety === 100) badges.push("spotless");

  return {
    level: input.level,
    xp: input.xp,
    scores: { influence, reliability, content, brandSafety },
    badges,
  };
}
```

- [ ] **Step 4: Update the GET /passport caller so the tree compiles**

In `server/routes/me.ts`, the passport handler calls `buildPassport` without `ratings` (now required). Update the submissions select (line 147) from:

```ts
    .select("status")
```
to:
```ts
    .select("status, quality_rating")
```

And update the `buildPassport` call (lines 157-163) to pass `ratings`:

```ts
  const passport = buildPassport({
    level: creator.level,
    xp: creator.xp,
    socialHandles: creator.social_handles as { followers?: number | null }[] | null,
    statuses: (subs ?? []).map((s) => s.status as string),
    ratings: (subs ?? [])
      .filter((s) => (s as { quality_rating?: number | null }).quality_rating != null)
      .map((s) => (s as { quality_rating: number }).quality_rating),
    referredCount: referredCount ?? 0,
  });
```

- [ ] **Step 5: Run unit tests + type-check to verify green**

Run: `npx vitest run server/lib/passport.test.ts && npm run type-check`
Expected: PASS — all passport unit tests pass; `tsc` reports no errors (the `me.ts` caller now satisfies the new signature).

- [ ] **Step 6: Commit**

```bash
git add server/lib/passport.ts server/lib/passport.test.ts server/routes/me.ts
git commit -m "feat(slice6c): compute Content + Brand Safety scores and quality badges"
```

---

## Task 2: Migration `0009_passport_scores.sql` (quality_rating column + approve_submission rebuild)

**Files:**
- Create: `supabase/migrations/0009_passport_scores.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_passport_scores.sql`:

```sql
-- Slice 6C: passport scores completion. Add a per-submission quality rating (the
-- Content score source) and a 5-star XP bonus; the Brand Safety proxy is computed in
-- TypeScript from existing statuses (no schema needed).

-- 1. Quality rating (1-5), set by the operator at approval time. Nullable: an approval
--    without a rating simply doesn't contribute to the Content score.
alter table public.mission_submissions
  add column quality_rating smallint
  check (quality_rating is null or quality_rating between 1 and 5);

-- 2. Rebuild approve_submission to record the rating and award +50 XP on a 5-star.
--    A defaulted 3rd param would make the existing 2-arg call ambiguous, so drop the
--    old signature first, then recreate (preserving the Slice 4 points + Slice 5 cash body).
drop function if exists public.approve_submission(uuid, text);

create or replace function public.approve_submission(
  p_submission uuid,
  p_notes text,
  p_quality_rating smallint default null
)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
  v_points int;
  v_title text;
  v_cash numeric;
  v_bal int;
  v_earn_bal numeric;
  v_bonus int := 0;
begin
  if p_quality_rating is not null and (p_quality_rating < 1 or p_quality_rating > 5)
    then raise exception 'bad_rating'; end if;

  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'approved' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  select points_reward, title, cash_reward into v_points, v_title, v_cash
    from public.missions where id = v_sub.mission_id;

  -- Points award (unchanged from Slice 4).
  update public.point_balances set balance = balance + v_points, updated_at = now()
    where creator_id = v_sub.creator_id and workspace_id = v_sub.workspace_id
    returning balance into v_bal;
  if v_bal is null then
    raise exception 'point_balances row missing for creator %', v_sub.creator_id;
  end if;
  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (v_sub.creator_id, v_sub.workspace_id, 'earn', v_points, v_bal,
            'mission_submission:' || p_submission, v_title);

  -- Cash accrual (unchanged from Slice 5).
  if coalesce(v_cash, 0) > 0 then
    update public.earnings_balances set available = available + v_cash, updated_at = now()
      where creator_id = v_sub.creator_id and workspace_id = v_sub.workspace_id
      returning available into v_earn_bal;
    if v_earn_bal is null then
      raise exception 'earnings_balances row missing for creator %', v_sub.creator_id;
    end if;
    insert into public.earnings_transactions
      (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
      values (v_sub.creator_id, v_sub.workspace_id, 'earn', v_cash, v_earn_bal,
              'mission_submission:' || p_submission, v_title);
  end if;

  -- Slice 6C: a perfect 5-star rating earns +50 bonus XP (master-spec 7.2).
  if p_quality_rating = 5 then v_bonus := 50; end if;

  update public.mission_submissions set
    status = 'approved', reviewed_at = now(), reviewer_notes = p_notes,
    quality_rating = p_quality_rating,
    points_awarded = v_points, xp_awarded = xp_awarded + 100 + v_bonus
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 100 + v_bonus where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- 3. Re-apply the service-role-only execute grants for the NEW signature.
revoke all on function public.approve_submission(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text, smallint) to service_role;
```

- [ ] **Step 2: Apply the migration to the local stack**

Ensure the local stack is running (`supabase start` if not), then:

Run: `supabase db reset`
Expected: output lists each migration applying in order, ending with `Applying migration 0009_passport_scores.sql...` and no error (exit 0).

- [ ] **Step 3: Verify the column and function signature exist**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.mission_submissions" -c "\df public.approve_submission"
```
Expected: the `\d` output lists a `quality_rating | smallint` column; the `\df` output shows `approve_submission` with argument types `uuid, text, smallint`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_passport_scores.sql
git commit -m "feat(slice6c): migration 0009 — quality_rating + approve_submission rebuild"
```

---

## Task 3: Passport read integration — Content, Brand Safety, new badges

Verifies the migration + Task 1 end-to-end through `GET /api/me/passport`. Needs the local stack with `0009` applied (Task 2).

**Files:**
- Modify: `server/test/helpers.ts:155-164` (extend `seedSubmission` with an optional rating)
- Modify: `server/test/passport.test.ts`

- [ ] **Step 1: Extend `seedSubmission` to accept an optional quality rating**

In `server/test/helpers.ts`, replace the `seedSubmission` function (lines 155-164) with:

```ts
/** Insert a mission_submissions row in a terminal status (service-role, bypassing the
 *  join→submit→review RPC chain). Creates a throwaway "test-" mission per call so the
 *  (mission_id, creator_id) unique constraint never collides. An optional 1-5
 *  qualityRating seeds the Content-score source (only meaningful on approved rows). */
export async function seedSubmission(creatorId: string, status: string, slug: string, qualityRating?: number) {
  const m = await makeMission({ slug });
  const row: Record<string, unknown> = { mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status };
  if (qualityRating != null) row.quality_rating = qualityRating;
  const { error } = await service().from("mission_submissions").insert(row);
  if (error) throw error;
}
```

- [ ] **Step 2: Write the failing integration tests**

In `server/test/passport.test.ts`, replace the existing test `"content and brand safety are always locked (null)"` (lines 62-67) with the four tests below, and keep all other tests as-is:

```ts
  it("computes content from quality ratings (unrated approvals excluded)", async () => {
    const c = await makeCreator("passport-content@test.local");
    await seedSubmission(c.userId, "approved", "test-pp-con-1", 5);
    await seedSubmission(c.userId, "approved", "test-pp-con-2", 3);
    await seedSubmission(c.userId, "approved", "test-pp-con-3"); // unrated → excluded from content
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBe(80); // round(20 * avg(5,3)) = round(20*4)
    expect(p.badges).toContain("perfect_rating"); // a 5★ is present
  });

  it("computes brand safety as the non-rejection rate (expired excluded)", async () => {
    const c = await makeCreator("passport-bs@test.local");
    await seedSubmission(c.userId, "approved", "test-pp-bs-1");
    await seedSubmission(c.userId, "rejected", "test-pp-bs-2");
    await seedSubmission(c.userId, "expired", "test-pp-bs-3"); // never reviewed → excluded
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.brandSafety).toBe(50); // round(100 * 1/(1+1))
  });

  it("content and brand safety are null for a creator with no rated/reviewed work", async () => {
    const c = await makeCreator("passport-noscore@test.local");
    await seedSubmission(c.userId, "joined", "test-pp-noscore-1"); // in-flight only
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBeNull();
    expect(p.scores.brandSafety).toBeNull();
  });

  it("earns content_pro and spotless from 3+ high-quality reviewed submissions", async () => {
    const c = await makeCreator("passport-pro@test.local");
    await seedSubmission(c.userId, "approved", "test-pp-pro-1", 5);
    await seedSubmission(c.userId, "approved", "test-pp-pro-2", 4);
    await seedSubmission(c.userId, "approved", "test-pp-pro-3", 5);
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.badges).toContain("content_pro"); // content round(20*avg(5,4,5))=93 ≥ 80, 3 ratings
    expect(p.badges).toContain("spotless"); // brand safety 100 over 3 reviewed
  });
```

- [ ] **Step 3: Run the tests to verify the new path**

Run:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/passport.test.ts
```
Expected: the four new tests PASS (Task 1 + Task 2 already implement the behavior). If `quality_rating` is rejected by PostgREST (`column ... does not exist`), the migration wasn't applied — re-run `supabase db reset` (Task 2).

Note: this is a verification task — the implementation already exists from Tasks 1-2, so these tests confirm the end-to-end path rather than driving new code. The full passport suite (the original fresh-creator / reliability / influence / level tests plus these four) must all pass.

- [ ] **Step 4: Run the full integration suite to confirm no regressions**

Run:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration
```
Expected: PASS — every integration file green (the `seedSubmission` change is backward-compatible: existing 3-arg calls omit the rating).

- [ ] **Step 5: Commit**

```bash
git add server/test/helpers.ts server/test/passport.test.ts
git commit -m "test(slice6c): integration coverage for Content + Brand Safety + badges"
```

---

## Task 4: `persistScores` snapshot helper + write-moment wiring + admin integration

**Files:**
- Create: `server/lib/persistScores.ts`
- Modify: `server/routes/admin.ts:32-46` (approve takes `quality_rating`; approve + reject snapshot)
- Modify: `server/routes/me.ts:118-125` (PUT /profile snapshots after a social-handle change)
- Modify: `server/test/helpers.ts` (add `getCreatorScores`)
- Modify: `server/test/admin.test.ts`

- [ ] **Step 1: Write the failing admin integration tests + the `getCreatorScores` helper**

In `server/test/helpers.ts`, add this helper after `setReferredBy` (after line 171):

```ts
/** Read a creator's persisted passport-score snapshot (creators.scores) for assertions. */
export async function getCreatorScores(userId: string) {
  const { data, error } = await service().from("creators").select("scores").eq("id", userId).single();
  if (error) throw error;
  return data.scores as { influence: number | null; content: number | null; reliability: number | null; brandSafety: number | null };
}
```

In `server/test/admin.test.ts`, add `getCreatorScores` to the helpers import (line 3):

```ts
import { makeCreator, makeMission, getCreatorScores, cleanup, hasSupabaseEnv } from "./helpers";
```

Add these tests inside the `suite("admin submission review", ...)` block (after the existing reject test, before the closing `});`):

```ts
  it("approves with a 5★ rating: stores the rating, awards +50 bonus XP, snapshots scores", async () => {
    const koc3 = await makeCreator("admin-rate@test.local", 0);
    await makeMission({ slug: "test-admin-rate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rate/join", koc3.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rate/submit", koc3.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rate"] }),
    });
    const id = (await sub.json()).id;

    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "great", quality_rating: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quality_rating).toBe(5);

    // 10 join + 25 submit + 100 approve + 50 bonus = 185.
    const me = await koreq("/me", koc3.jwt);
    expect((await me.json()).xp).toBe(185);

    // persistScores wrote the snapshot: 1 approved + rated 5 → content 100, brand safety 100.
    const scores = await getCreatorScores(koc3.userId);
    expect(scores.content).toBe(100);
    expect(scores.brandSafety).toBe(100);
    expect(scores.reliability).toBe(100);
  });

  it("rejects an out-of-range rating with 400 bad_rating", async () => {
    const koc4 = await makeCreator("admin-badrate@test.local", 0);
    await makeMission({ slug: "test-admin-badrate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-badrate/join", koc4.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-badrate/submit", koc4.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/bad"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 7 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_rating");
  });

  it("rejection snapshots scores (brand safety reflects the rejection)", async () => {
    const koc5 = await makeCreator("admin-rej-snap@test.local", 0);
    await makeMission({ slug: "test-admin-rej-snap", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rej-snap/join", koc5.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rej-snap/submit", koc5.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rej"] }),
    });
    const id = (await sub.json()).id;
    await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    const scores = await getCreatorScores(koc5.userId);
    expect(scores.brandSafety).toBe(0); // 0 approved / 1 reviewed
    expect(scores.reliability).toBe(0);
  });
```

- [ ] **Step 2: Run the new admin tests to verify they fail**

Run:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/admin.test.ts
```
Expected: FAIL — `quality_rating` is ignored (not passed to the RPC), the +50 bonus isn't awarded (xp 135 not 185), the out-of-range rating isn't rejected (no `bad_rating`), and `creators.scores` stays at the default (snapshot never written).

- [ ] **Step 3: Create the `persistScores` helper**

Create `server/lib/persistScores.ts`:

```ts
import { serviceClient } from "./supabase.js";
import { buildPassport } from "./passport.js";

/** Recompute a creator's passport scores and snapshot them into creators.scores.
 *  Best-effort: logs and returns on any failure (never throws) so a snapshot error
 *  can't turn a successful approve/reject/profile-save into a 500. The read path
 *  (GET /me/passport) always live-computes, so creators.scores is a forward-looking
 *  cache (Mission Matcher) and transient staleness is non-fatal. Uses the service
 *  client throughout: the approve/reject caller is the operator (no creator JWT). */
export async function persistScores(creatorId: string): Promise<void> {
  try {
    const svc = serviceClient();

    const { data: creator, error: cErr } = await svc
      .from("creators")
      .select("level, xp, social_handles")
      .eq("id", creatorId)
      .single();
    if (cErr || !creator) {
      console.error("[persistScores] creator read failed", creatorId, cErr);
      return;
    }

    const { data: subs, error: sErr } = await svc
      .from("mission_submissions")
      .select("status, quality_rating")
      .eq("creator_id", creatorId);
    if (sErr) {
      console.error("[persistScores] submissions read failed", creatorId, sErr);
      return;
    }

    const { count, error: rErr } = await svc
      .from("creators")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", creatorId);
    if (rErr) {
      console.error("[persistScores] referral count failed", creatorId, rErr);
      return;
    }

    const { scores } = buildPassport({
      level: creator.level,
      xp: creator.xp,
      socialHandles: creator.social_handles as { followers?: number | null }[] | null,
      statuses: (subs ?? []).map((s) => s.status as string),
      ratings: (subs ?? [])
        .filter((s) => (s as { quality_rating?: number | null }).quality_rating != null)
        .map((s) => (s as { quality_rating: number }).quality_rating),
      referredCount: count ?? 0,
    });

    const { error: uErr } = await svc.from("creators").update({ scores }).eq("id", creatorId);
    if (uErr) console.error("[persistScores] snapshot write failed", creatorId, uErr);
  } catch (err) {
    console.error("[persistScores] unexpected error", creatorId, err);
  }
}
```

- [ ] **Step 4: Wire approve (with rating + validation) and reject to snapshot**

In `server/routes/admin.ts`, add the import after line 2:

```ts
import { persistScores } from "../lib/persistScores.js";
```

Replace the approve handler (lines 32-38) with:

```ts
adminRoutes.post("/submissions/:id/approve", async (c) => {
  const body = await c.req
    .json<{ notes?: string; quality_rating?: number }>()
    .catch(() => ({}) as { notes?: string; quality_rating?: number });
  const notes = body.notes ?? null;
  const raw = body.quality_rating;
  if (raw !== undefined && raw !== null && (!Number.isInteger(raw) || raw < 1 || raw > 5)) {
    return c.json({ error: "quality_rating must be an integer 1-5", code: "bad_rating" }, 400);
  }
  const rating = raw ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("approve_submission", {
    p_submission: c.req.param("id"),
    p_notes: notes,
    p_quality_rating: rating,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});
```

Replace the reject handler (lines 40-46) with:

```ts
adminRoutes.post("/submissions/:id/reject", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("reject_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});
```

- [ ] **Step 5: Snapshot after a profile social-handle change**

In `server/routes/me.ts`, add the import after line 4:

```ts
import { persistScores } from "../lib/persistScores.js";
```

In the PUT /profile handler, the successful-update block currently ends (lines 118-125):

```ts
  const { data, error } = await supabase
    .from("creators")
    .update(patch)
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
```

Insert a snapshot call before the final `return`, guarded to the only score-affecting field (Influence):

```ts
  const { data, error } = await supabase
    .from("creators")
    .update(patch)
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (body.social_handles !== undefined) await persistScores(c.get("userId"));
  return c.json(data);
```

- [ ] **Step 6: Run the admin tests to verify they pass + full suite + type-check**

Run:
```bash
set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration && npm run type-check
```
Expected: PASS — all admin tests (including the three new) green, every other integration file green, `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add server/lib/persistScores.ts server/routes/admin.ts server/routes/me.ts server/test/helpers.ts server/test/admin.test.ts
git commit -m "feat(slice6c): persistScores snapshot + quality_rating on approve + write-moment wiring"
```

---

## Task 5: Frontend — numeric scores, badge metadata, provisional notes

**Files:**
- Modify: `src/lib/queries/kocmax.ts:35` (widen `Passport` scores type)
- Modify: `src/lib/passport.ts` (3 new badges + optional `note` on `SCORE_META`)
- Modify: `src/lib/passport.test.ts`
- Modify: `src/routes/_app.passport.tsx:64-70` (per-ring notes; drop the standalone Influence note)
- Modify: `src/routes/-_app.passport.test.tsx`
- Modify: `src/components/ScoreRing.test.tsx`

- [ ] **Step 1: Write the failing frontend metadata + page tests**

In `src/lib/passport.test.ts`, replace the `"defines the five data-derived badges"` test (lines 13-17) and add a notes test:

```ts
  it("defines all eight passport badges (5 data-derived + 3 quality-derived)", () => {
    for (const id of [
      "level_l1", "first_approval", "reliable", "social_linked", "referrer",
      "perfect_rating", "content_pro", "spotless",
    ]) {
      expect(BADGES[id]).toBeDefined();
    }
  });
  it("carries provisional notes on the self-reported / proxy scores", () => {
    expect(SCORE_META.influence.note).toBeTruthy();
    expect(SCORE_META.brandSafety.note).toBeTruthy();
    expect(SCORE_META.content.note).toBeUndefined();
    expect(SCORE_META.reliability.note).toBeUndefined();
  });
```

In `src/components/ScoreRing.test.tsx`, add a case after the existing tests (before the closing `});`):

```ts
  it("renders a numeric brand-safety value (no longer always locked in 6C)", () => {
    render(<ScoreRing value={90} label="品牌安全" accent="var(--color-ink)" />);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.queryByText("敬請期待")).not.toBeInTheDocument();
  });
```

In `src/routes/-_app.passport.test.tsx`, replace the `hoisted` mock (lines 4-16) with numeric scores:

```ts
const hoisted = vi.hoisted(() => ({
  me: { data: { id: "u1", display_name: "阿明", avatar_url: null } },
  passport: {
    data: {
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: 70, content: 80, brandSafety: 90 },
      badges: ["level_l1", "content_pro"],
    },
    isLoading: false,
    isError: false,
  },
}));
```

And replace the `describe("Passport page", ...)` body (lines 29-49) with:

```ts
describe("Passport page", () => {
  it("renders the four score labels and their computed values", () => {
    renderPassport();
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("可靠度")).toBeInTheDocument();
    expect(screen.getByText("品牌安全")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });

  it("shows the provisional brand-safety note", () => {
    renderPassport();
    expect(screen.getByText("品牌安全為暫定代理指標")).toBeInTheDocument();
  });

  it("renders earned badge labels", () => {
    renderPassport();
    expect(screen.getByText("升級者")).toBeInTheDocument();
    expect(screen.getByText("內容達人")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run: `npx vitest run src/lib/passport.test.ts src/components/ScoreRing.test.tsx "src/routes/-_app.passport.test.tsx"`
Expected: FAIL — `perfect_rating`/`content_pro`/`spotless` missing from `BADGES`; `SCORE_META.*.note` undefined; the page renders no "品牌安全為暫定代理指標" note.

- [ ] **Step 3: Add the badge metadata + score notes**

In `src/lib/passport.ts`, change the `SCORE_META` type to allow an optional `note` and set notes on Influence + Brand Safety (replace lines 6-11):

```ts
export const SCORE_META: Record<ScoreKey, { label: string; weight: number; accent: string; note?: string }> = {
  influence: { label: "影響力", weight: 40, accent: "var(--color-acid)", note: "影響力為自填數據，未驗證" },
  content: { label: "內容", weight: 30, accent: "var(--color-ink)" },
  reliability: { label: "可靠度", weight: 20, accent: "var(--color-magenta)" },
  brandSafety: { label: "品牌安全", weight: 10, accent: "var(--color-ink)", note: "品牌安全為暫定代理指標" },
};
```

Add the three badges to `BADGES` (inside the object, after `referrer`, line 22):

```ts
  perfect_rating: { emoji: "🌟", label: "完美評分", desc: "獲得 5★ 內容評分" },
  content_pro: { emoji: "🎯", label: "內容達人", desc: "3+ 個評分任務，內容分 ≥ 80" },
  spotless: { emoji: "💎", label: "零違規", desc: "3+ 個已審任務，品牌安全分 100" },
```

- [ ] **Step 4: Widen the `Passport` query type**

In `src/lib/queries/kocmax.ts`, replace the scores line (line 35) so Content + Brand Safety are numeric:

```ts
  scores: { influence: number | null; reliability: number | null; content: number | null; brandSafety: number | null };
```

- [ ] **Step 5: Render per-ring notes and drop the standalone Influence note**

In `src/routes/_app.passport.tsx`, replace the scores grid + standalone note (lines 64-69) with a wrapped ring + optional caption per cell:

```tsx
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
          {SCORE_ORDER.map((k) => (
            <div key={k} className="flex flex-col items-center gap-1">
              <ScoreRing value={p.scores[k]} label={SCORE_META[k].label} accent={SCORE_META[k].accent} />
              {SCORE_META[k].note && (
                <p className="text-center text-[10px] leading-tight text-[var(--color-soft-ink)]">{SCORE_META[k].note}</p>
              )}
            </div>
          ))}
        </div>
```

(The old standalone `<p className="text-xs ...">影響力為自填數據，未驗證。</p>` line is removed — the note is now driven by `SCORE_META.influence.note`.)

- [ ] **Step 6: Run the frontend tests + type-check + lint to verify green**

Run: `npx vitest run src/lib/passport.test.ts src/components/ScoreRing.test.tsx "src/routes/-_app.passport.test.tsx" && npm run type-check && npm run lint`
Expected: PASS — all three frontend test files green, `tsc` clean, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/passport.ts src/lib/passport.test.ts src/routes/_app.passport.tsx "src/routes/-_app.passport.test.tsx" src/components/ScoreRing.test.tsx
git commit -m "feat(slice6c): numeric Content/Brand Safety scores, quality badges, provisional notes"
```

---

## Final verification (after all tasks)

- [ ] **Full unit/component suite:** `npm test` — expected all pass, integration self-skipped.
- [ ] **Type-check:** `npm run type-check` — clean.
- [ ] **Lint:** `npm run lint` — clean.
- [ ] **Build:** `npm run build` — succeeds.
- [ ] **Full integration suite:** `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration` — every file green (passport + admin include the new 6C tests).
- [ ] Then invoke **superpowers:finishing-a-development-branch** to push + open the PR (base `main`; note the stack on #12).

## Notes / gotchas
- **`xp_awarded` is cumulative** (join +10, submit +25, approve +100[+50]). Assert XP deltas / the creator's total `xp`, not absolute `xp_awarded`.
- **Migration not applied → `quality_rating` errors.** If integration tests report `column "quality_rating" does not exist`, run `supabase db reset` (Task 2 Step 2).
- **`persistScores` is best-effort** — it logs and returns on failure, never throwing, so a snapshot error can't 500 a successful approve/reject/profile-save. Integration assertions exercise the happy path (the snapshot is written).
- **No SQL backfill** of `creators.scores` for pre-6C creators — nothing reads the column yet and `GET /me/passport` live-computes. Snapshots refresh on the next write-moment.
- **Cloud DB is PRODUCTION** (`mhkoayftiuojxlrkollf`). Do NOT apply `0009` there as part of this plan — that's a user-gated, irreversible step (the cloud migration tracker shows only 0001-0002; reconcile separately as in prior slices).
