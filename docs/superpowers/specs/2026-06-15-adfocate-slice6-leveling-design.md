# Adfocate 2.0 — Slice 6A: Leveling Engine (Design)

> **Status:** design approved (2026-06-15). Next: `writing-plans`.
> **Branch:** `feat/slice6-leveling`, currently **stacked on `feat/profile-page`** (PR #10, unmerged) because 6A's frontend touches the profile page. Retarget the PR to `main` once #10 merges.
> **Context:** Slice 6 ("Creator Passport") in the master spec (§7) is large and partly blocked on missing data (Influence needs a social API; Content needs brand ratings). It is **decomposed**; this is **sub-slice 6A — the Leveling Engine** only. The passport/DNA page (6B) and the four scores + badges (6C) are deferred.

## 1. Goal
Make creator **levels live**. Today every creator is hardcoded `L0`, so the already-wired mission level-gate only ever admits `required_level='L0'` missions. 6A recomputes `creators.level` from `creators.xp` against the L0–L6 thresholds, surfaces level + progress-to-next-level in the UI, and shows a one-time **level-up celebration**. Once `level` tracks XP, the existing `join_mission` gate activates with no further changes — higher-level missions unlock automatically.

## 2. What already exists (do NOT rebuild)
- `creators.level text default 'L0'`, `creators.xp int default 0`, `creators.scores jsonb`, `missions.required_level text default 'L0'` (migration 0001).
- `level_ordinal(text) → int` maps `L0..L6 → 0..6` (migration 0005). **Reused** here for ordinal comparisons.
- `join_mission` RPC **already gates**: `if level_ordinal(v_level) < level_ordinal(required_level) then raise 'level_locked'` (mapped to a typed API error). XP is **already awarded**: join +10, submit +25, approve +100 (migrations 0005/0007).
- The gap, per the 0005 comment: *"no level recompute this slice; every creator is L0."* Nothing ever recomputes `level` from `xp`.

## 3. Scope

### 3.1 In scope
- **DB:** a `level_for_xp(xp)` threshold function; a trigger that keeps `creators.level` a pure function of `creators.xp`; a `level_seen` column + a one-time backfill; a `POST /me/level-seen` acknowledge endpoint; `level_seen` added to `GET /me`.
- **Frontend:** a shared `levels.ts` table + helpers; a level-progress section on the profile page; a compact level chip on home; a **level-up celebration** modal in the `_app` layout; a `useMarkLevelSeen` hook + `level_seen` on the `Me` type.

### 3.2 Out of scope (deferred)
| Deferred | Note |
|---|---|
| The four passport scores (Influence/Content/Reliability/Brand Safety) | 6C — Influence needs a social API, Content needs brand ratings (no data source yet) |
| Badges | 6C |
| Creator Passport / "DNA" page | 6B (also the page the profile slice deferred) |
| New XP **sources** (referral-converted, profile-complete bonus, affiliate, CPM, live) | later; 6A only makes `level` track the XP that *existing* paths already award |
| Public/shareable passport link | 6B+ |
| "Next level ETA" projection (§6.3) | speculative; 6A shows a concrete `X / Y XP` bar, no time estimate |

## 4. Level metadata (single source of truth)
Thresholds and labels come from the master spec §7.1:

| id | label | emoji | XP required | next-level unlock hint (shown in UI) |
|---|---|---|---|---|
| L0 | Newcomer | 🌱 | 0 | — |
| L1 | Explorer | 🌟 | 500 | 聯盟連結、評測任務、積分兌換 |
| L2 | Creator | 🎨 | 2,000 | UGC 有薪工作、CPM 軌道、工作室 |
| L3 | Amplifier | 📢 | 6,000 | 活動費用、完整 Copilot 工具 |
| L4 | Micro-Influencer | 🚀 | 15,000 | 直播帶貨、優先任務配對 |
| L5 | Pro Creator | 💎 | 40,000 | 品牌大使、Finance Readiness |
| L6 | Elite | 👑 | 100,000 | 客製品牌合作、創作者資本 |

Thresholds appear in **two** places by necessity: the DB `level_for_xp` function (authoritative for the gate) and the frontend `levels.ts` (display + progress math). They must stay in sync; both reference this table. (A future option is to expose levels via an endpoint, but a stable 7-row constant doesn't justify it yet — YAGNI.)

## 5. Backend — migration `0008_leveling.sql`
1. **`level_for_xp(p_xp int) → text`** — `LANGUAGE sql IMMUTABLE`; returns the highest level whose threshold ≤ `p_xp` (a `CASE` over the §4 thresholds; `p_xp` clamped at ≥0 → `L0`).
2. **Trigger** — function `set_level_from_xp()` that sets `NEW.level := public.level_for_xp(NEW.xp)`, attached `BEFORE INSERT OR UPDATE OF xp ON public.creators FOR EACH ROW`. So **any** path that changes `xp` (join/submit/approve now; referral/affiliate/admin-adjust later) keeps `level` consistent — no per-RPC edits, and the level can never drift from XP.
3. **Column** `level_seen text not null default 'L0'` — the highest level the creator has been **shown** a celebration for. The trigger does **not** touch it.
4. **Backfill** (idempotent, runs in the migration): `update creators set level = level_for_xp(xp);` then `update creators set level_seen = level;`. Setting `level_seen = level` means the rollout does **not** retro-celebrate creators who were already past a threshold — only crossings that happen *after* deploy celebrate. (Acceptable: the app is new, few/no creators have crossed L1 yet.)
5. **Grants** — add `level_seen` to the `authenticated` SELECT + UPDATE column grants on `creators` (mirroring migration 0004's pattern) so the user client can read it and the acknowledge endpoint can write it under the existing `creators_self_update` RLS policy. `level`/`xp` remain **not** self-updatable (no cheating).
6. **`POST /api/me/level-seen`** (new handler on the guarded `meRoutes`) — reads the caller's current `level` via the user client, then `update({ level_seen: <that level> }).eq("id", userId)`, returns the row via `ME_PROJECTION`. (Read-then-write mirrors the profile `PUT /me/profile`; the value written is server-read, so a caller can't forge it — and the worst a forged value could do is suppress their own celebration, no security impact.)
7. **`GET /me`** — add `level_seen` to `ME_PROJECTION` (the shared projection in `server/routes/me.ts`; `level` is already included).

## 6. Frontend
- **`src/lib/levels.ts`** — `LEVELS: LevelDef[]` (the §4 table: `{ id, label, emoji, xpRequired, unlock }`), plus pure helpers:
  - `levelIndex(id: string): number` (0–6; unknown → 0)
  - `progressToNext(xp): { current: LevelDef; next: LevelDef | null; xpIntoCurrent: number; xpForNext: number | null; pct: number }` (at L6, `next=null`, `pct=100`).
- **`src/lib/queries/kocmax.ts`** — `Me` gains `level_seen?: string`; new `useMarkLevelSeen()` mutation → `apiFetch<Me>("/me/level-seen", { method: "POST" })`, `onSuccess` invalidates `["me"]`.
- **Profile (`_app.profile.tsx`)** — replace the bare level pill + XP in the header card with a **level-progress** block: `{emoji} {label}`, a progress bar, and `還需 {xpForNext - xpIntoCurrent} XP 升至 {next.label}` + the next unlock hint. At L6, show a "最高等級" state (no bar).
- **Home (`_app.home.tsx`)** — a compact level chip (`{emoji} {id}`) near the existing top-right avatar button.
- **Level-up celebration** — `src/components/LevelUpModal.tsx`, mounted once in the **`_app` layout** (`_app.tsx`, which already loads `me` via the gate) so it can appear over any page. `pending = levelIndex(me.level) > levelIndex(me.level_seen)`. When pending, render a celebratory modal: `🎉 你升級了！{emoji} {label}` + the level's unlocks + a `太好了` button → `useMarkLevelSeen().mutate()`; on success the cache refetches, `pending` becomes false, modal closes. Guard for an absent/undefined `level_seen` (treat as no celebration).

## 7. Data flow
XP changes (join/submit/approve) → DB trigger recomputes `level` → next `GET /me` returns `level` (and `level_seen`) → if `levelIndex(level) > levelIndex(level_seen)` the `_app` layout shows the celebration → `太好了` → `POST /me/level-seen` sets `level_seen = level` → refetch clears `pending`. Gate: once `level_ordinal(level) ≥ level_ordinal(required_level)`, `join_mission` no longer raises `level_locked` — higher missions become joinable with no code change. Because the big jumps come from **operator approval (out of the creator's session)**, the celebration is **server-tracked** (via `level_seen`), so it correctly fires on the creator's *next* visit rather than requiring an in-session before/after comparison (which would essentially never catch the L0→L1 crossing).

## 8. Error handling
- `POST /me/level-seen` — typed `{ error, code }` with 500 on db error (mirrors the other `me` handlers). It's idempotent (setting `level_seen` to the current `level` repeatedly is a no-op).
- Celebration acknowledge failure → keep the modal open with the existing UI (next visit re-detects `pending` and retries); no destructive state.
- `levels.ts` helpers are total (defined for every `xp ≥ 0` and unknown level ids), so the progress UI never throws.

## 9. Testing
- **Backend integration** (`server/test/leveling.test.ts`, added to the `test:integration` script):
  - **Trigger / `level_for_xp` boundaries** — service-set `creators.xp` to `499 → L0`, `500 → L1`, `2000 → L2`, `100000 → L6`; `GET /me` reflects the recomputed `level`.
  - **Gate comes alive** — seed a `required_level='L2'` mission; a fresh (L0) creator's `join` → `level_locked` (403); after XP pushes them to L2, `join` succeeds.
  - **`level_seen` + acknowledge** — after a level-up, `GET /me` shows `level=L1`, `level_seen=L0` (pending); `POST /me/level-seen` → `level_seen=L1`; second call is a no-op.
- **Frontend component:**
  - `levels.test.ts` — `progressToNext` math (xp 0, 250, 500, 100000) and `levelIndex`.
  - Profile renders the correct `還需 N XP 升至 LN` for a mocked `useMe`.
  - `LevelUpModal` — shows when `level` is ahead of `level_seen` and calls `markLevelSeen` on the button; renders nothing when `level_seen === level`.

## 10. User-gated / operational
- **Apply migration `0008` to the cloud DB** (Supabase SQL editor), as with prior slices — the cloud migration *tracker* lags (shows 0001–0002), so `db push` is not used; the user applies SQL manually. Local integration uses `supabase db reset` (applies 0001–0008).
- No new env vars, no dashboard config.

## 11. Risks
- **Threshold duplication** (DB function + `levels.ts`) — mitigated by both referencing the §4 table; a mismatch would only affect the *display* vs the *gate*, caught by the boundary tests. If it becomes a maintenance burden, expose levels via an endpoint later.
- **Backfill retro-celebration** — avoided by `level_seen = level` in the backfill; if the product later *wants* to retro-celebrate, that's a deliberate one-line change.
- **Stacked branch** — 6A sits on the unmerged profile branch; its PR diff will include #10 until #10 merges, after which the base is retargeted to `main`.
