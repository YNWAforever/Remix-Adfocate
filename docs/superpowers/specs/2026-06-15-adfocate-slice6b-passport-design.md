# Adfocate 2.0 — Slice 6B: Creator Passport (Design)

> **Status:** design approved (2026-06-15). Next: `writing-plans`.
> **Branch:** `feat/slice6b-passport`, **stacked on `feat/slice6-leveling`** (PR #11, unmerged) because 6B builds on its `kocmax.ts` / `_app.profile.tsx` / `_app.home.tsx` changes. Rebase the branch / retarget its PR onto `main` once #11 merges.
> **Context:** Slice 6 ("Creator Passport") was decomposed: **6A — Leveling Engine** is DONE (PR #11); this is **6B — the Passport page** (earned-first). **6C** (Content + Brand Safety score computation, a brand-ratings table, badges beyond the data-derived set, persisting to `creators.scores`) and the **public shareable passport link** remain deferred.

## 1. Goal
A dedicated, **live & earned** Creator Passport page (master-spec promise: "static demo data → live, earned, verifiable"). It shows the creator's level + XP, four score rings, and a grid of data-derived badges. Two of the four scores (**Reliability**, **Influence**) are computed from data we already have; the other two (**Content**, **Brand Safety**) render in a **locked / 敬請期待** state until 6C supplies their data. Reached from the profile page and the home level chip. Fully authenticated — no public share link this slice.

## 2. Key decisions (from brainstorming)
- **Earned-first**, not a hollow shell: compute Reliability + Influence now; lock Content + Brand Safety.
- **Dedicated `/passport` route** (not inline on profile, not nested).
- **Basic data-derived badges now** (not deferred).
- **No public share link** this slice (it's a security-sensitive public-read surface; its own slice).

## 3. No migration required
All passport data is **computed on read** from existing tables via the per-request user client (plus one small service-scoped count for referrals — see §4.4). `creators.scores jsonb` already exists (migration 0001, default `{influence,content,reliability,brandSafety:0}`) and is selected in `ME_PROJECTION`, but is **not** written here — persisting computed scores into it is a 6C concern. So **Slice 6B ships with zero schema changes**.

## 4. Backend — `GET /api/me/passport`
A new handler on the guarded `meRoutes` (so the final route is `GET /api/me/passport`). Returns:

```ts
type Passport = {
  level: string;
  xp: number;
  scores: {
    influence: number | null;     // computed; null = no data yet
    reliability: number | null;   // computed; null = no concluded submissions yet
    content: null;                 // locked (no brand-ratings data) — always null in 6B
    brandSafety: null;             // locked (no compliance data) — always null in 6B
  };
  badges: string[];               // earned badge ids
};
```

`null` distinguishes **locked** (Content/Brand Safety — "敬請期待") and **not-earned-yet** (Influence/Reliability with no source data) from a genuine **0**. The frontend renders any `null` as a locked/empty ring.

### 4.1 Reliability (computed)
From the caller's own `mission_submissions` (RLS `submissions_self` already permits self-reads via the user client). Count by terminal status:
- `approved`, `rejected`, `expired` are **concluded**; `joined`, `submitted`, `under_review` are **in-flight** (excluded).
- `reliability = round(100 * approved / (approved + rejected + expired))`.
- If `approved + rejected + expired === 0` → `null` (no track record yet).

### 4.2 Influence (computed)
From `creators.social_handles` (own row, user client). Sum `followers` across handles (treat missing/`null` as 0), then map via tiers:

| total followers | influence |
|---|---|
| 0 | 0 |
| ≥ 1,000 | 20 |
| ≥ 10,000 | 50 |
| ≥ 100,000 | 80 |
| ≥ 1,000,000 | 100 |

(Step function — the highest tier whose threshold is met.) If the creator has **no** social handles at all → `null`. Note: followers are self-entered and unverified — the UI labels Influence "未驗證" (a verified social-API source is a later enhancement).

### 4.3 Content & Brand Safety (locked)
Always `null` in 6B. No data source exists (`mission_submissions.reviewer_notes` is free text, not a structured rating; no compliance records). The ring renders locked.

### 4.4 Badges (computed, earned ids only)
Earned from data we already have:

| id | earned when | source |
|---|---|---|
| `level_l1` | `level_ordinal(level) >= 1` (reached L1+) | own creator row |
| `first_approval` | ≥ 1 `approved` submission | own `mission_submissions` |
| `reliable` | ≥ 3 concluded submissions **and** reliability ≥ 80 | own `mission_submissions` |
| `social_linked` | ≥ 1 entry in `social_handles` | own creator row |
| `referrer` | ≥ 1 creator has `referred_by = me` | **service-scoped count** (see note) |

**Read paths:** the level/social/submission badges and both computed scores use the **user client** (own row + `submissions_self`). The `referrer` count reads *other* creators' rows (`referred_by = my id`), which RLS scopes away from the user client, so the handler uses `serviceClient()` for that one `count` only (it exposes a number, not other creators' data). This keeps 6B migration-free.

### 4.5 Errors
Typed `{ error, code }` with 500 on a db error, mirroring the other `me` handlers. The endpoint is read-only and idempotent. Each sub-computation is total (empty data → `null`/`0`/`[]`), so the handler never throws on a fresh creator.

## 5. Frontend
- **`src/lib/passport.ts`** — presentation metadata + pure helpers (no computation; the server computes values):
  - `SCORE_META: Record<ScoreKey, { label: string; weight: number; accent: string }>` — labels (影響力 / 內容 / 可靠度 / 品牌安全), the master-spec weights (Influence 40 / Content 30 / Reliability 20 / Brand Safety 10), and an accent color per score.
  - `SCORE_ORDER: ScoreKey[]` — display order.
  - `BADGES: Record<string, { emoji: string; label: string; desc: string }>` — render metadata for the five badge ids in §4.4.
- **`src/components/ScoreRing.tsx`** — an SVG circular gauge. Props `{ value: number | null; label: string; accent: string }`. `null` → a locked/greyed ring with "敬請期待"; a number → the filled arc + the value.
- **`src/routes/_app.passport.tsx`** — route `"/_app/passport"`. Header: avatar + name + level emoji/label + XP progress (reuse `progressToNext` from `levels.ts`). Body: a 2×2 grid of `ScoreRing`s in `SCORE_ORDER`; an "未驗證" note under Influence; a badge grid (earned badges from `BADGES`, with an empty-state line if none). Loading / error states mirror the profile page.
- **`src/lib/queries/kocmax.ts`** — `Passport` type + `useMyPassport()` (`useQuery`, key `["passport"]`, `apiFetch<Passport>("/me/passport")`). Also add `scores?: Record<string, number>` to the `Me` type for completeness (the backend already selects it; harmless and unblocks future reads) — optional, low-risk.
- **Profile (`_app.profile.tsx`)** — add a "創作者護照" link/button (e.g., in the quick-links grid or near 編輯) → `/passport`.
- **Home (`_app.home.tsx`)** — wrap the existing level chip in a `<Link to="/passport">` so the chip is tappable.

## 6. Data flow
`GET /me/passport` → user client aggregates own `mission_submissions` (Reliability + submission badges) and reads own `social_handles`/`level` (Influence + level/social badges); `serviceClient()` counts `referred_by = me` (referrer badge) → returns `{ level, xp, scores, badges }` → `useMyPassport` caches under `["passport"]` → the page renders rings + badges. No writes, no realtime, no invalidation needed (it's a read view; values refresh on navigation / refetch).

## 7. Testing
- **Backend integration** (`server/test/passport.test.ts`, registered in the `test:integration` script):
  - **Reliability** — seed a creator with submissions in `approved`/`rejected`/`expired` states (via `serviceClient` inserts or the existing join→submit + service approve/reject RPCs); assert the computed value (e.g. 2 approved / 1 rejected / 1 expired → `round(100*2/4)=50`); a creator with only in-flight submissions → `null`.
  - **Influence** — seed `social_handles` with follower counts (e.g. 12,000 → 50; 0 handles → `null`).
  - **Locked** — `content` and `brandSafety` are always `null`.
  - **Badges** — each id earns under its condition and is absent otherwise (incl. the `referrer` service-count path and the `reliable` ≥3-and-≥80 threshold).
  - **Empty state** — a brand-new creator → scores `{influence:null,reliability:null,content:null,brandSafety:null}`, `badges:[]` (no throw).
- **Frontend:**
  - `src/lib/passport.test.ts` — `SCORE_META`/`SCORE_ORDER`/`BADGES` shape (weights sum to 100; order length 4; every badge id in §4.4 present).
  - `ScoreRing.test.tsx` — renders the value for a number; renders the locked "敬請期待" state for `null`.
  - Passport page render — mock `useMyPassport`; asserts the 4 ring labels, a sample value, and an earned badge label.
  - Profile link test — a "創作者護照" link points to `/passport`.

## 8. Out of scope (deferred)
| Deferred | To |
|---|---|
| Content + Brand Safety **computation** + a brand-ratings table + compliance records | 6C |
| Persisting computed scores into `creators.scores` (+ a recompute job/trigger) | 6C |
| Badges beyond the five data-derived ones (curated/achievement badges) | 6C+ |
| Public / token-based shareable passport link (`GET /creators/:id/passport`) | its own slice |
| Verified social-API follower/engagement data (replaces self-entered followers) | later |

## 9. Risks
- **Influence is self-reported** — followers are unverified user input; mitigated by labeling Influence "未驗證" and keeping the tier map coarse. A real social API supersedes this later.
- **Service-scoped referral count** — the one non-user-client read; it returns only a count of creators the caller referred (no row data), so no exposure. Keeps 6B migration-free.
- **Reliability denominator** — counts `expired` as a miss; acceptable for v1. If it proves harsh, the formula is a one-line change (and Reliability isn't gating anything).
- **Stacked branch** — 6B sits on the unmerged #11; its PR diff includes #11 until #11 merges, after which the base is retargeted to `main`.
