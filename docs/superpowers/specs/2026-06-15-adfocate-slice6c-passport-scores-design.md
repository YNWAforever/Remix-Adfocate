# Adfocate 2.0 — Slice 6C: Passport Scores Completion (Design)

> **Status:** design approved (2026-06-15). Next: `writing-plans`.
> **Branch:** `feat/slice6c-passport-scores`, **stacked on `feat/slice6b-passport`** (PR #12, unmerged) because 6C extends its `server/lib/passport.ts`, `server/routes/me.ts`, `src/lib/passport.ts`, and `src/lib/queries/kocmax.ts`. Rebase the branch / retarget its PR onto `main` once #12 merges (same pattern 6B used on 6A/#11).
> **Context:** Slice 6 ("Creator Passport") was decomposed into **6A — Leveling Engine** (DONE, PR #11), **6B — the Passport page** (DONE, PR #12: live Reliability + Influence, Content + Brand Safety **locked**), and this **6C — Passport Scores Completion**: unlock the two remaining scores, persist the snapshot, and add quality-derived badges.

## 1. Goal
Complete the Creator Passport's four-score model. 6B shipped Reliability + Influence live and left **Content** and **Brand Safety** in a locked "敬請期待" state because no data source existed. 6C creates those sources and computes both scores:

- **Content** — a 1–5 **quality rating** an operator records when approving a submission, averaged into a 0–100 score (master-spec §7.3: "Brand ratings on submitted content quality", 30%).
- **Brand Safety** — a **non-rejection rate** proxy (`approved / (approved + rejected)`) standing in for the master-spec's "compliance check pass rate" (10%) until the Copilot Compliance Check tool exists. Labeled **暫定** (provisional) in the UI.

It also **persists** the computed scores into the existing `creators.scores jsonb` column (a forward-looking cache for the Mission Matcher) at every write-moment, and adds three quality-derived **badges**. `GET /api/me/passport` stays the single live source of truth for the page.

## 2. Key decisions (from brainstorming)
- **Scope = all of it:** Content score **+** Brand-Safety proxy **+** persistence to `creators.scores` **+** curated (quality-derived) badges. (User chose "All of it" over "Content score only".)
- **Brand-Safety heuristic = non-rejection rate:** `round(100 × approved / (approved + rejected))`; **`expired` excluded** (never reviewed); **`null`** if nothing reviewed yet; **labeled 暫定** because it's a proxy, not a real compliance check. (User chose this over an XP-derived or always-100 heuristic.)
- **TypeScript is the single source of truth** for the math (extend the pure `server/lib/passport.ts`); the score values are **snapshotted** into `creators.scores` by a server helper at write-moments. We do **not** reimplement the scoring in SQL — `GET /me/passport` already live-computes, and a second SQL implementation would drift. The column is a cache for a future consumer (Mission Matcher), not the read path.
- **Quality rating lives on the submission** (`mission_submissions.quality_rating`), set by the operator at approval time; optional (an approval without a rating simply doesn't contribute to Content).
- **Perfect-rating XP bonus:** a 5★ approval awards **+50 bonus XP** (master-spec §7.2 line 625), on top of the existing +100 approval XP.

## 3. Architecture

```
                 write-moments                         read path (unchanged shape)
  approve(+rating) ─┐                              ┌── GET /api/me/passport
  reject ───────────┼─► persistScores(creatorId) ──┤      (user client; live-computes
  PUT /me/profile ──┘     │                         │       from own rows every call)
  (social_handles)        │ service client          │
                          ▼                          ▼
                  buildPassport(...).scores ──► both call the SAME pure
                          │                         server/lib/passport.ts
                          ▼
                  UPDATE creators.scores  (jsonb snapshot; cache only — nothing reads it yet)
```

- **`server/lib/passport.ts`** (pure, no I/O — extended): gains `contentFor(ratings)` and `brandSafetyFor(counts)`; `buildPassport` accepts a `ratings` array, returns **numeric** `content`/`brandSafety`, and emits three new badges. Unit-tested in isolation.
- **`server/lib/persistScores.ts`** (new, I/O): `persistScores(creatorId)` — service-client reads → `buildPassport(...).scores` → `UPDATE creators.scores`. Best-effort (logs and degrades on failure, never throws) so a snapshot error can't fail the user-facing write.
- **Read path is unchanged in shape:** `GET /me/passport` still live-computes per request via the user client; 6C only feeds it `quality_rating` so Content/Brand Safety come back as numbers instead of `null`.

## 4. Data model — `supabase/migrations/0009_passport_scores.sql`

**4.1 Add the quality-rating column**
```sql
alter table public.mission_submissions
  add column quality_rating smallint
  check (quality_rating is null or quality_rating between 1 and 5);
```
Nullable, default null. Set only by `approve_submission`. (No RLS change: the table already grants `select` to `authenticated` and `submissions_self` already scopes self-reads; the new column rides along.)

**4.2 Extend `approve_submission` to take a rating + award the 5★ bonus**

`approve_submission` currently has signature `(p_submission uuid, p_notes text)` (defined in 0005, redefined in 0007 to add cash accrual). Adding a **defaulted** third parameter would make the existing 2-arg call ambiguous, so we **drop the old signature first**, then recreate with the new one, preserving the entire 0007 body (points + cash + XP):

```sql
-- Drop the 2-arg signature so the 3-arg (defaulted) one is unambiguous.
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

  -- Slice 6C: a perfect 5★ rating earns +50 bonus XP (master-spec §7.2).
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

-- Re-apply the service-role-only execute grants for the NEW signature.
revoke all on function public.approve_submission(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text, smallint) to service_role;
```

Notes:
- The `bad_rating` guard is a backstop; the API also validates (§7.2). The check constraint on the column is the final guard.
- `reject_submission(uuid, text)` is **unchanged** — rejected content isn't quality-rated (the rejection itself is the Brand-Safety signal).
- The +50 bonus flows through the existing 6A leveling trigger on `creators.xp` naturally (a 5★ approval can level a creator up); no special handling.

**4.3 No backfill of `creators.scores`.** Existing creators keep the column's default (`{influence:0,content:0,reliability:0,brandSafety:0}`) until their next write-moment refreshes it. This is deliberate: the column is a forward-looking cache that **nothing reads yet**, and `GET /me/passport` always live-computes, so every passport page is correct regardless of snapshot freshness. A SQL backfill would require duplicating the scoring math in SQL — exactly what §3 avoids.

## 5. Scoring rules

| Score | Source | Formula | `null` when | Notes |
|---|---|---|---|---|
| Influence | `social_handles` followers | tiers (1k→20, 10k→50, 100k→80, 1M→100) | no handles | **unchanged** from 6B; self-reported, labeled 自填未驗證 |
| **Content** | `quality_rating` (1–5) on submissions | `round(20 × avg(rating))` over non-null ratings | no rated submissions | 5★→100, 1★→20, avg(4,5)→90 |
| Reliability | submission statuses | `round(100 × approved / (approved + rejected + expired))` | no concluded submissions | **unchanged** from 6B; expired counts as a miss |
| **Brand Safety** | submission statuses | `round(100 × approved / (approved + rejected))` | nothing reviewed | **expired excluded** (never reviewed); proxy, labeled 暫定 |

The conceptual split between Reliability and Brand Safety: **Reliability** asks "did you follow through?" (so `expired` — flaking after joining — counts against you). **Brand Safety** asks "of the content a brand actually reviewed, how much passed?" (so `expired`, which was never reviewed, is excluded). Content is independent — it reflects only the quality of submissions an operator explicitly rated; an approved-but-unrated submission contributes to Reliability and Brand Safety but **not** to Content.

### 5.1 Pure functions (`server/lib/passport.ts`)
```ts
export type PassportScores = {
  influence: number | null;
  reliability: number | null;
  content: number | null;     // 6C: was `null` (locked)
  brandSafety: number | null; // 6C: was `null` (locked)
};

/** Average of the 1–5 quality ratings, scaled to 0–100. null when nothing is rated. */
export function contentFor(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return Math.round(20 * avg);
}

/** Non-rejection rate over REVIEWED submissions (approved + rejected; expired excluded).
 *  null when nothing has been reviewed. Proxy for compliance pass-rate. */
export function brandSafetyFor(counts: SubmissionCounts): number | null {
  const reviewed = counts.approved + counts.rejected;
  if (reviewed === 0) return null;
  return Math.round((100 * counts.approved) / reviewed);
}
```

`buildPassport` gains a required `ratings: number[]` input (the non-null `quality_rating`s of the creator's submissions) and returns the numeric scores:
```ts
export function buildPassport(input: {
  level: string;
  xp: number;
  socialHandles: PassportSocialHandle[] | null | undefined;
  statuses: string[];
  ratings: number[];          // 6C: new
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
  // 6C badges:
  if (input.ratings.some((r) => r === 5)) badges.push("perfect_rating");
  if (input.ratings.length >= 3 && (content ?? 0) >= 80) badges.push("content_pro");
  if (reviewed >= 3 && brandSafety === 100) badges.push("spotless");

  return { level: input.level, xp: input.xp,
    scores: { influence, reliability, content, brandSafety }, badges };
}
```

## 6. Badges — three new (quality-derived)

| id | earned when | label / emoji / desc (frontend `BADGES`) |
|---|---|---|
| `perfect_rating` | ≥ 1 submission rated 5★ | 完美評分 / 🌟 / 獲得 5★ 內容評分 |
| `content_pro` | ≥ 3 rated submissions **and** Content ≥ 80 | 內容達人 / 🎯 / 3+ 個評分任務，內容分 ≥ 80 |
| `spotless` | ≥ 3 reviewed submissions **and** Brand Safety = 100 | 零違規 / 💎 / 3+ 個已審任務，品牌安全分 100 |

Frontend `BADGES` metadata (`src/lib/passport.ts`) gains:
```ts
perfect_rating: { emoji: "🌟", label: "完美評分", desc: "獲得 5★ 內容評分" },
content_pro:    { emoji: "🎯", label: "內容達人", desc: "3+ 個評分任務，內容分 ≥ 80" },
spotless:       { emoji: "💎", label: "零違規", desc: "3+ 個已審任務，品牌安全分 100" },
```
(`perfect_rating` reuses 🌟 like `level_l1`'s "升級者" but with a distinct label/desc; the emoji is cosmetic and may be tuned in the plan to avoid a duplicate glyph.)

## 7. Backend wiring

### 7.1 `server/lib/persistScores.ts` (new)
```ts
import { serviceClient } from "./supabase.js";
import { buildPassport } from "./passport.js";

/** Recompute a creator's passport scores and snapshot them into creators.scores.
 *  Best-effort: logs and returns on any failure (never throws) so a snapshot error
 *  can't turn a successful approve/reject/profile-save into a 500. The read path
 *  (GET /me/passport) always live-computes, so the column is a forward-looking cache
 *  (Mission Matcher) and transient staleness is non-fatal. */
export async function persistScores(creatorId: string): Promise<void> {
  try {
    const svc = serviceClient();
    const { data: creator, error: cErr } = await svc
      .from("creators").select("level, xp, social_handles").eq("id", creatorId).single();
    if (cErr || !creator) { console.error("[persistScores] creator read failed", creatorId, cErr); return; }

    const { data: subs, error: sErr } = await svc
      .from("mission_submissions").select("status, quality_rating").eq("creator_id", creatorId);
    if (sErr) { console.error("[persistScores] submissions read failed", creatorId, sErr); return; }

    const { count, error: rErr } = await svc
      .from("creators").select("id", { count: "exact", head: true }).eq("referred_by", creatorId);
    if (rErr) { console.error("[persistScores] referral count failed", creatorId, rErr); return; }

    const { scores } = buildPassport({
      level: creator.level,
      xp: creator.xp,
      socialHandles: creator.social_handles as { followers?: number | null }[] | null,
      statuses: (subs ?? []).map((s) => s.status as string),
      ratings: (subs ?? []).filter((s) => s.quality_rating != null).map((s) => s.quality_rating as number),
      referredCount: count ?? 0,
    });

    const { error: uErr } = await svc.from("creators").update({ scores }).eq("id", creatorId);
    if (uErr) console.error("[persistScores] snapshot write failed", creatorId, uErr);
  } catch (err) {
    console.error("[persistScores] unexpected error", creatorId, err);
  }
}
```
Always uses the **service client** (the approve/reject caller is the operator, with no creator JWT; using it uniformly keeps the helper callable from every context). It reads only the one creator's rows (`creator_id = creatorId` / `id = creatorId` / `referred_by = creatorId`).

### 7.2 `server/routes/admin.ts` — approve accepts `quality_rating`; both snapshot
```ts
adminRoutes.post("/submissions/:id/approve", async (c) => {
  const body = await c.req.json<{ notes?: string; quality_rating?: number }>().catch(() => ({} as { notes?: string; quality_rating?: number }));
  const notes = body.notes ?? null;
  const raw = body.quality_rating;
  if (raw !== undefined && raw !== null && (!Number.isInteger(raw) || raw < 1 || raw > 5)) {
    return c.json({ error: "quality_rating must be an integer 1-5", code: "bad_rating" }, 400);
  }
  const rating = raw ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("approve_submission", {
    p_submission: c.req.param("id"), p_notes: notes, p_quality_rating: rating,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});
```
The `reject` handler adds the same `await persistScores((data as { creator_id: string }).creator_id);` after its RPC succeeds (a rejection changes Reliability + Brand Safety).

### 7.3 `server/routes/me.ts`
- **`GET /passport`** — change the submissions select to `.select("status, quality_rating")` and pass `ratings: (subs ?? []).filter((s) => s.quality_rating != null).map((s) => s.quality_rating as number)` into `buildPassport`. Content/Brand Safety now return numbers; no other change (the handler already returns whatever `buildPassport` produces).
- **`PUT /profile`** — after a successful update, if `body.social_handles !== undefined` (the only profile field that affects a score — Influence), `await persistScores(c.get("userId"));` before returning. The empty-patch early-return path needs no snapshot.

## 8. Frontend

- **`src/lib/queries/kocmax.ts`** — widen the `Passport` type's scores: `content: number | null; brandSafety: number | null` (were `null`). No hook change.
- **`src/lib/passport.ts`** — add the three badge metadata entries (§6). Add an optional `note?: string` to each `SCORE_META` entry and set `influence.note = "影響力為自填數據，未驗證"` and `brandSafety.note = "品牌安全為暫定代理指標"`. (`content`/`reliability` have no note.)
- **`src/components/ScoreRing.tsx`** — **unchanged.** It already renders a number as a filled arc and `null` as the locked "敬請期待" state, so numeric Content/Brand Safety just render correctly.
- **`src/routes/_app.passport.tsx`** — in each ring's grid cell, render `SCORE_META[key].note` as a small caption beneath the ring when present (drives both the Influence "未驗證" note and the new Brand Safety "暫定" note). This **replaces** the current standalone hard-coded Influence note paragraph, consolidating it into `SCORE_META`. The badge grid already maps earned ids through `BADGES`, so the three new badges render with no page change.

## 9. Data flow
1. **Operator approves** a submission with an optional 1–5 rating → `approve_submission` stores `quality_rating`, awards points/cash/XP (+50 if 5★) → handler calls `persistScores(creator_id)` → `creators.scores` snapshot refreshed.
2. **Operator rejects** → `reject_submission` → `persistScores(creator_id)` (Reliability + Brand Safety move).
3. **Creator edits social handles** → `PUT /me/profile` → `persistScores(self)` (Influence moves).
4. **Creator opens the passport** → `GET /me/passport` live-computes all four scores + badges from own rows (+ the one service-scoped referral count) → page renders four numeric/locked rings + badge grid. The snapshot column is never read by the page.

## 10. Testing

**Unit — `server/lib/passport.test.ts`** (pure, no DB; extends the 6B file):
- `contentFor`: `[]`→`null`; `[5]`→`100`; `[1]`→`20`; `[4,5]`→`90`; `[3,3,3]`→`60`.
- `brandSafetyFor`: `{0,0,0}`→`null`; `{3,1,0}`→`75`; `{0,2,5}`→`0` (expired ignored — denominator is `approved+rejected=2`); `{2,0,9}`→`100`.
- `buildPassport`: returns numeric `content`/`brandSafety`; earns `perfect_rating` (a 5★ present), `content_pro` (≥3 ratings & content ≥ 80), `spotless` (≥3 reviewed & brandSafety 100); each absent when its threshold isn't met.

**Integration — `server/test/passport.test.ts`** (live local Supabase; in `test:integration`):
- A submission approved with rating 5 → `content` = 100; ratings `[5,3]` (avg 4) → `content` = 80.
- An approval with **no** rating → does not affect `content` (stays `null` if it's the only submission) but does move Reliability/Brand Safety.
- One approved + one rejected → `brandSafety` = 50; an expired submission does **not** change `brandSafety`.
- `perfect_rating` / `content_pro` / `spotless` earn under their conditions.

**Integration — `server/test/admin.test.ts`** (extend existing):
- `POST /submissions/:id/approve` with `{ quality_rating: 5 }` → submission row has `quality_rating = 5`; the **approval step** adds **150 XP** (100 + 50 bonus), so the creator's `xp` rises by 150 over its pre-approval value and the submission's cumulative `xp_awarded` is 50 higher than an unrated approval of the same submission. (Assert deltas, not the absolute `xp_awarded` — it also carries the earlier +10 join / +25 submit increments.)
- Approve with an out-of-range rating (e.g. `7`) → 400 `bad_rating`; approve with no rating → succeeds, `quality_rating` null, approval adds 100 XP (no bonus).
- After approve **and** after reject, `creators.scores` is refreshed (read the column via service client; assert it equals the live `buildPassport(...).scores` — i.e. `persistScores` wrote the snapshot).

**Frontend:**
- `src/lib/passport.test.ts` — `BADGES` now contains all eight ids (five from 6B + three new); `SCORE_META` weights still sum to 100; `influence` and `brandSafety` carry a `note`.
- `src/components/ScoreRing.test.tsx` — unchanged behavior (number renders value, null renders locked); add a case asserting a numeric Brand Safety value renders (no longer always locked).
- `src/routes/-_app.passport.test.tsx` — mock `useMyPassport` with numeric `content`/`brandSafety`; assert all four rings show values, the Brand Safety 暫定 note renders, and a new badge (e.g. `content_pro`) shows its label.

## 11. Out of scope (deferred)
| Deferred | To |
|---|---|
| **Copilot Compliance Check** tool (`POST /copilot/compliance-check`) — the real Brand-Safety source that replaces the non-rejection proxy | its own slice |
| Moving the scoring math into SQL / making `creators.scores` the read path (only worthwhile once the **Mission Matcher** consumes the column) | when the Matcher lands |
| Backfilling `creators.scores` for pre-6C creators (no consumer reads it; live-compute keeps the UI correct) | n/a until a consumer needs it |
| Manually-curated / admin-granted achievement badges (all 6C badges are data-derived) | 6C+ |
| Verified social-API follower/engagement data (replaces self-entered followers) | later |
| Public / token-based shareable passport link (`GET /creators/:id/passport`) | its own slice |

## 12. Risks
- **Brand Safety is a proxy.** Non-rejection rate is not a real compliance check; a lenient operator inflates it. Mitigated by the 暫定 label and by it being only 10% of the (not-yet-consumed) composite. The Copilot Compliance Check supersedes it later, and `brandSafetyFor` is a one-line swap.
- **Operator-entered quality rating is subjective.** A single operator rates all content for now; consistency isn't guaranteed. Acceptable for v1 — Content is advisory and not gating anything. The interim admin auth (shared secret) is unchanged; per-workspace operator roles land with the Brand Dashboard (Slice 8).
- **Snapshot can drift from live.** `persistScores` is best-effort; if it fails, `creators.scores` is stale. Non-fatal because nothing reads the column yet and `GET /me/passport` always live-computes. When the Matcher starts reading it, add a periodic reconcile job (out of scope here).
- **Function-signature migration.** Dropping `approve_submission(uuid, text)` and recreating as `(uuid, text, smallint default null)` is required to avoid overload ambiguity; the migration re-applies the service-role execute grant for the new signature. On the production cloud DB the migration tracker shows only 0001–0002, so applying 0009 there is a user-gated, irreversible step (consistent with prior slices).
- **Stacked branch.** 6C sits on the unmerged #12; its PR diff includes #12 until #12 merges, after which the base is retargeted to `main` (and the branch rebased).
