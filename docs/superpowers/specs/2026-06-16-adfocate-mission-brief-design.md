# Mission Brief (creator-facing) — Design Spec

> **Slice A** of the "mission brief" work. Slice B (operator authoring UI) is deferred.

**Goal:** When a creator opens a mission detail page, give them enough structured information to decide whether to take it — a real *brief*: what to make, what's required, where to post, the reward, how many spots are left, and whether they qualify. Today the page shows only 5 of 14 mission fields and leans entirely on a free-text `description` that is **NULL on every live mission**, so the page reads blank.

## Context / Problem

- **Navigation prerequisite (already fixed):** clicking a mission rendered nothing because `_app.mission.tsx` was the parent route of `_app.mission.$missionSlug` but never rendered `<Outlet/>`. Fixed on branch `fix/mission-detail-navigation` (commit `d02cb36`): list moved to `_app.mission.index.tsx`, parent is now an `<Outlet/>` layout (mirrors the working `/redemption` pattern). **That fix ships as its own PR first** — the brief is invisible until detail pages render.
- **Content gap (this slice):** the detail page (`_app.mission.$missionSlug.tsx`) renders only `title`, `category`, `description`, `points_reward`, `deadline`. Populated-but-hidden columns: `mission_type`, `required_level`, `cash_reward`, `quota`, `filled`. There is **no** column for deliverables, requirements, platform, or effort.
- **Prod data reality (project `mhkoayftiuojxlrkollf`, 6 live missions):** `description`, `cash_reward`, `cpm_*`, `deadline` are NULL on all rows; `category`, `mission_type`, `points_reward`, `quota`, `filled` are populated; all are `access_type=open`, `required_level=L0`. So the numeric/structured fields are usable today; the brief copy needs both new columns **and** data entry.

## Non-goals (YAGNI)

- No operator authoring UI (Slice B).
- No mission *create* flow, no admin endpoints.
- No change to apply/join/submit/earn logic or the action zone on the detail page.
- No new RLS policies or grants (table-level `select` on `missions` already covers new columns).
- `cpm_rate` / `cpm_budget_pool` surfaced only if trivially available — not a focus (no `performance_cpm` missions live).

## Design

### 1. Schema — `supabase/migrations/0011_mission_brief.sql`

Add four columns to `public.missions`:

| Column | Type | Notes |
|---|---|---|
| `deliverables` | `text[] not null default '{}'` | e.g. `{'1 條 Reel ≥30 秒','3 個限時動態'}` |
| `requirements` | `text[] not null default '{}'` | do's & don'ts, e.g. `{'標註 @brand','勿提及競品'}` |
| `platforms` | `text[] not null default '{}'` | e.g. `{'instagram','tiktok'}` (canonical lowercase) |
| `effort` | `text check (effort in ('low','medium','high'))` | nullable |

No RLS/grant changes. Migration applies cleanly to prod (additive, nullable/defaulted). **Prod apply** is manual via SQL editor + `notify pgrst,'reload schema'` **before** deploying the frontend that reads them (degrades gracefully if missing, but follow the established order).

### 2. Backend — `server/routes/missions.ts` + `src/lib/queries/kocmax.ts`

- `GET /missions/:slug`: extend the existing select to return the 4 new columns and **join the brand**: `workspaces(name)` → response gains `brand: string`. (Confirm exact current select shape during implementation; new columns ride along.)
- `Mission` type (`kocmax.ts`) gains `deliverables: string[]`, `requirements: string[]`, `platforms: string[]`, `effort: 'low'|'medium'|'high'|null`, `brand: string | null`.
- List endpoint (`/missions`) unchanged — the brief is detail-only.

### 3. Frontend

**`src/lib/missionMeta.ts`** (pure, unit-tested):
- `MISSION_TYPE_LABEL`: `koc_trial`→體驗開箱, `ugc`→原創內容, `clipping`→短片剪輯, `affiliate`→分潤帶貨, `performance_cpm`→流量任務, `live_commerce`→直播帶貨, `brand_ambassador`→品牌大使. Unknown → raw value (no blank).
- `PLATFORM_LABEL`: instagram→Instagram, tiktok→TikTok, xiaohongshu→小紅書, youtube→YouTube, threads→Threads (unknown → capitalized raw).
- `effortLabel(effort)`: low→{label:'低', tone}, medium→中, high→高; null → null.
- `spotsLeft(quota, filled)`: `Math.max(0, quota - filled)`; helper `isFull` → `額滿`.
- `eligibility(requiredLevel, creatorLevel)`: uses `levels.ts` `levelIndex` → `{ qualified: boolean, label: string }` (e.g. `需 L1 · 你符合` / `需 L2 · 你係 L1`). Display-only — the real gate stays server-side (`level_locked` 409 on join/apply).

**`src/components/MissionFacts.tsx`** — a 2×2 facts grid:
- Reward (`points_reward` 積分, plus `cash_reward` HK$ when non-null).
- Spots left (`尚餘 X 個名額` / `額滿`).
- Deadline (`截止日期` or `無截止日期` — never blank).
- Eligibility (qualified ✓ / locked, computed against the creator's level from `useMe`).

**`src/components/MissionBrief.tsx`** — the content sections, each rendered **only if it has content**:
- Overview (`description`) — under 關於任務.
- Deliverables (交付內容) — checklist.
- Requirements (注意事項) — list.
- Platforms (發佈平台) — chips via `PLATFORM_LABEL`.
- Effort (預計投入) — badge via `effortLabel`.
- If the whole brief is empty → one muted line `詳情陸續更新` (no blank sections — fixes today's blank-`description` render).

**`_app.mission.$missionSlug.tsx`** — replace the current `任務詳情`/reward/deadline blocks with `<MissionFacts mission={…} creatorLevel={…}/>` + `<MissionBrief mission={…}/>`, placed between the header and the **unchanged** action zone. `mission_type` label shown as a pill near the title. `useMe()` added for the eligibility compute.

### 4. Testing

- **Unit** (`src/lib/-missionMeta.test.ts`): label maps incl. unknown fallthrough; `spotsLeft` clamp at 0 + `額滿`; `eligibility` qualified vs locked across level boundaries.
- **Component**: `MissionBrief` populated vs all-empty (`詳情陸續更新`); `MissionFacts` with/without cash, full vs spots-left, qualified vs locked.
- **Integration** (`server/test/missions.test.ts`): `GET /missions/:slug` returns the 4 new fields + `brand`.
- Gates: `npm test`, `npm run test:integration`, `npm run type-check && npm run lint && npm run build`.

### 5. Data / backfill

- Update `supabase/seed.sql` with example brief content on the seed missions so local dev renders a real brief.
- Provide a templated `UPDATE public.missions SET deliverables=…, requirements=…, platforms=…, effort=… WHERE slug=…;` for the 6 live missions — **the actual copy is the operator's (your) data-entry task**, run in the Supabase SQL editor after migration 0011 is applied.

## Decisions & rationale (from brainstorming)

- **Columns on `missions`, not a new table** — strictly 1:1; matches how all mission data already lives on one row.
- **Structured arrays over one free-text blob** — `description` is empty in prod and a single blob can't be rendered as a checklist/eligibility; structured fields make the brief scannable and reusable (platforms can pre-fill the hook generator later).
- **Render existing-but-hidden fields now** — `mission_type`, spots-left, cash, eligibility need *zero* new data and immediately make missions feel informative.
- **Graceful empties** — every section is conditional; the page never renders blank again.
- **Action zone untouched** — apply/join/submit and the Slice 9 application flow are out of scope.

## Risks / open questions

- **Empty live data:** even after this ships, the 6 missions show only the structured facts until someone fills the new copy fields (operator data entry). Acceptable — the facts grid alone is already a big improvement.
- **Deploy order:** apply migration 0011 to prod **before** deploying the reader (same lesson as Slice 9). The frontend guards for missing fields, but follow the order.
- **Branch:** build on `fix/mission-detail-navigation` (or off `main` once that PR merges) so the brief is actually reachable.
- `cpm_rate`/`cpm_budget_pool` deliberately minimal — revisit if `performance_cpm` missions go live.

## File manifest

| File | Action |
|---|---|
| `supabase/migrations/0011_mission_brief.sql` | Create |
| `server/routes/missions.ts` | Modify (`GET /:slug` select + brand join) |
| `src/lib/queries/kocmax.ts` | Modify (`Mission` type) |
| `src/lib/missionMeta.ts` | Create |
| `src/lib/-missionMeta.test.ts` | Create |
| `src/components/MissionFacts.tsx` | Create |
| `src/components/MissionBrief.tsx` | Create |
| `src/components/-MissionFacts.test.tsx` / `-MissionBrief.test.tsx` | Create |
| `src/routes/_app.mission.$missionSlug.tsx` | Modify (wire in facts + brief) |
| `src/routes/-_app.mission.$missionSlug.test.tsx` | Modify (brief renders) |
| `server/test/missions.test.ts` | Modify (new fields + brand) |
| `supabase/seed.sql` | Modify (example brief content) |
