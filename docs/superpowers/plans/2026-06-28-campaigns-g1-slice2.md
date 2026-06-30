# Campaigns G1 Slice 2 ("Finish Campaigns") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the campaigns feature automated + engaging — daily cron auto-close, a `campaign_started` matched broadcast on publish, and `↑N/↓N/NEW` leaderboard rank-movement — with the exactly-once payout core untouched.

**Architecture:** One additive migration (`0026_campaigns_s2.sql`): a `campaign_rank_snapshots` table + three service-role SECURITY-DEFINER RPCs (`close_due_campaigns`, `snapshot_campaign_leaderboards`, `broadcast_campaign_started`) + a `notifications` type-CHECK extension. The existing daily cron is generalized to run publish + snapshot + close. `campaign_started` matching is decided in TS (reusing the Mission Matcher primitives) and inserted by the idempotent broadcast RPC, fired best-effort from both publish routes. Leaderboard movement = current live rank vs. the latest snapshot rank, computed in the pure shaper.

**Tech Stack:** Supabase/Postgres (plpgsql RPCs + RLS), Hono server routes, TanStack Router + React Query, Vitest (pure unit + local-stack integration), bilingual i18n (zh-HK default / en).

**Source spec:** [`docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-slice2-design.md`](../specs/2026-06-28-campaigns-challenges-g1-slice2-design.md) (§ refs below).

---

## Critical context (read before Task 1)

- **Branch:** `feat/campaigns-g1-s2` (already created off `origin/main` @ `a4e7bc1`, the #50 merge; the spec is committed at `94ce29d`). It already contains `0025_campaigns.sql`, `server/routes/cron.ts`, `server/routes/campaigns.ts`, `server/lib/missionMatch.ts`, `server/lib/campaignLeaderboard.ts`.
- **House rules (CI-guarded / hard-won):**
  - New `server/**` files MUST use `.js` extensions on relative imports (`npm run check:esm` guards this).
  - Add new integration test files to the explicit `test:integration` list in `package.json` (they do **not** auto-discover).
  - Run `npm run type-check` after touching routes (it runs the TanStack route-tree codegen, which bare `tsc` does not).
  - Never `vercel --prod` from local. Deploy via Git.
  - `.env.local` holds **prod** creds — never source it.
- **Integration test workflow (local Supabase stack):**
  - Start the stack: `supabase start -x storage-api,imgproxy,edge-runtime` (a plain `supabase db reset` has been unstable here).
  - Apply migrations to the local stack (Task 1 does this).
  - Tests SKIP unless the shell has `RUN_INTEGRATION=1` **and** `.env.test.local` exported. Run them with: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration` (the script already passes `--no-file-parallelism`).
- **Payout core is OFF-LIMITS:** do not edit `approve_submission`, `campaign_progress_on_approval`, `grant_campaign_completion_bonus`, or `settle_campaign`.
- **Prod application (do at the very end, AFTER merge — NOT during implementation):** the migration tracker is out of sync. Apply `0026` to prod (`mhkoayftiuojxlrkollf`) via **raw SQL** (Supabase MCP `execute_sql`), **after verifying the live `notifications` CHECK constraint name** (`select conname from pg_constraint where conrelid='public.notifications'::regclass and contype='c';`), then `notify pgrst, 'reload schema'`. Ship the `vercel.json` cron-path change in the same deploy.

## Existing identifiers (verified — use exactly)

- `missionMatch.ts` exports: `MatchCreator {level: string; categories: string[]; reliability; brandSafety; content}`, `MatchMission {id; slug; title; category: string|null; mission_type; required_level: string; points_reward; cash_reward; deadline; quota; filled}`, `categoryTerm(creator, mission)` (1 on niche hit, 0 miss, **0.5 when creator has no niches**), `levelFitTerm(creator, mission)` (1 if level meets, else 0).
- `campaignLeaderboard.ts` exports: `RankRow {creator_id; rank; approved; avg_quality}`, `CreatorProfile`, `LeaderboardEntry`, `num(v)`, `shapeLeaderboard(rows, profiles)`, `myStanding`, `spotsToPrize`.
- `cron.ts`: `cronRoutes` Hono router; each handler checks `process.env.CRON_SECRET` vs `Authorization: Bearer …`; calls `serviceClient().rpc(...)`. Daily handler is `GET /publish-scheduled` → `serviceClient().rpc("content_publish_scheduled")` → `{ published }`.
- `campaigns.ts`: `GET /:slug/leaderboard` → loads campaign id by `(workspace_id, slug)`, `svc.rpc("rank_campaign", {p_campaign})`, loads `creators(id, display_name, avatar_url, level)`, returns `{ leaderboard: shapeLeaderboard(ranked, profiles) }`.
- `adminCampaigns.ts`: `POST /campaigns/:id/publish` → `.update({status:'active', published_at, updated_at})…` via `serviceClient`.
- `brandCampaigns.ts`: `POST /:id/publish` → `.update({status:'active', published_at, updated_at}).eq("id", id)…` via `makeUserClient` (arrives with PR #51; may or may not exist on this branch yet — Task 7 guards for that).
- `creators` columns: `level text ("L0".."L6")`, `categories text[]`, `status text`, `workspace_id uuid`, `xp int`.
- `notifications` columns: `(user_id, workspace_id, type, entity_type, entity_id, data jsonb, read_at, created_at)`; current CHECK = 8 types incl. `campaign_goal_reached, campaign_prize_awarded`.

---

## Phase A — Migration `0026` + DB engines

### Task 1: Create migration `0026_campaigns_s2.sql` and load it into the local stack

**Files:**
- Create: `supabase/migrations/0026_campaigns_s2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0026_campaigns_s2.sql
-- Campaigns G1 Slice 2: daily auto-close, campaign_started matched broadcast, and
-- leaderboard rank-movement snapshots. Additive — does NOT touch the payout core
-- (approve_submission, campaign_progress_on_approval, grant_campaign_completion_bonus,
-- settle_campaign). See docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-slice2-design.md.

-- 1. Rank snapshots — append-only daily captures, read by the leaderboard route (serviceClient).
create table if not exists public.campaign_rank_snapshots (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  workspace_id uuid not null,
  creator_id   uuid not null,
  rank         int  not null,
  approved     int  not null,
  captured_at  timestamptz not null default now()
);
create index if not exists campaign_rank_snapshots_campaign_captured_idx
  on public.campaign_rank_snapshots (campaign_id, captured_at desc);
alter table public.campaign_rank_snapshots enable row level security;
grant all on public.campaign_rank_snapshots to service_role;

-- 2. close_due_campaigns — active -> closed for past-deadline campaigns. Idempotent. Never settles.
create or replace function public.close_due_campaigns()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.campaigns
     set status = 'closed', closed_at = now(), updated_at = now()
   where status = 'active' and ends_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.close_due_campaigns() from public;
revoke all on function public.close_due_campaigns() from anon;
revoke all on function public.close_due_campaigns() from authenticated;
grant execute on function public.close_due_campaigns() to service_role;

-- 3. snapshot_campaign_leaderboards — one timestamped batch of rank_campaign() rows per active campaign.
create or replace function public.snapshot_campaign_leaderboards()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.campaign_rank_snapshots (campaign_id, workspace_id, creator_id, rank, approved, captured_at)
  select c.id, c.workspace_id, r.creator_id, r.rank, r.approved, now()
    from public.campaigns c
    cross join lateral public.rank_campaign(c.id) r
   where c.status = 'active';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.snapshot_campaign_leaderboards() from public;
revoke all on function public.snapshot_campaign_leaderboards() from anon;
revoke all on function public.snapshot_campaign_leaderboards() from authenticated;
grant execute on function public.snapshot_campaign_leaderboards() to service_role;

-- 4. broadcast_campaign_started — idempotent fan-out insert (matching is decided in TS).
create or replace function public.broadcast_campaign_started(p_campaign uuid, p_creator_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_title text; v_slug text; v_n int;
begin
  select workspace_id, title, slug into v_ws, v_title, v_slug
    from public.campaigns where id = p_campaign;
  if v_ws is null then return 0; end if;

  insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
  select cid, v_ws, 'campaign_started', 'campaign', p_campaign,
         jsonb_build_object('campaign_title', coalesce(v_title,''), 'campaign_slug', coalesce(v_slug,''))
    from unnest(p_creator_ids) as cid
   where not exists (
     select 1 from public.notifications n
      where n.user_id = cid and n.type = 'campaign_started' and n.entity_id = p_campaign);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from public;
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from anon;
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from authenticated;
grant execute on function public.broadcast_campaign_started(uuid, uuid[]) to service_role;

-- 5. Extend notifications.type CHECK to admit 'campaign_started'.
--    NOTE (prod): verify the live constraint name first.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started'));
```

- [ ] **Step 2: Load it into the local stack and verify it applies cleanly**

Run:
```bash
supabase start -x storage-api,imgproxy,edge-runtime
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/migrations/0026_campaigns_s2.sql
```
Expected: `CREATE TABLE` / `CREATE FUNCTION` (×3) / `ALTER TABLE` with no errors. (If the local stack already has 0026 objects from a prior run, the `create … if not exists` / `or replace` make it a safe no-op.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0026_campaigns_s2.sql
git commit -m "feat(campaigns-s2): migration 0026 — snapshots, close/snapshot/broadcast RPCs, notif CHECK"
```

### Task 2: Integration test — `close_due_campaigns`

**Files:**
- Create: `server/test/campaigns-s2.test.ts`
- Modify: `package.json` (add the file to the `test:integration` list)

- [ ] **Step 1: Add the test file to the integration list**

In `package.json`, find the `"test:integration"` script and append ` server/test/campaigns-s2.test.ts` to its explicit vitest file list (same pattern as `server/test/campaigns.test.ts`).

- [ ] **Step 2: Write the failing test**

Create `server/test/campaigns-s2.test.ts`. Mirror the setup of `server/test/campaigns.test.ts` (it shows how to make a `serviceClient`, a workspace, missions, and a campaign on the local stack; reuse its helpers/imports). Then:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { serviceClient } from "../lib/supabase.js";
// reuse the campaign/workspace/mission fixtures from campaigns.test.ts patterns

const RUN = process.env.RUN_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;

d("close_due_campaigns", () => {
  const svc = serviceClient();

  it("closes only past-deadline active campaigns and is idempotent", async () => {
    // Arrange: one active campaign already past ends_at, one active in the future, one draft.
    const past = await makeCampaign(svc, { status: "active", ends_at: "2000-01-01T00:00:00Z" });
    const future = await makeCampaign(svc, { status: "active", ends_at: "2999-01-01T00:00:00Z" });
    const draft = await makeCampaign(svc, { status: "draft", ends_at: "2000-01-01T00:00:00Z" });

    // Act
    const { data: n1 } = await svc.rpc("close_due_campaigns");

    // Assert: only the past+active one closed.
    expect(n1).toBeGreaterThanOrEqual(1);
    const { data: rows } = await svc.from("campaigns")
      .select("id,status").in("id", [past.id, future.id, draft.id]);
    const byId = Object.fromEntries(rows!.map((r: any) => [r.id, r.status]));
    expect(byId[past.id]).toBe("closed");
    expect(byId[future.id]).toBe("active");
    expect(byId[draft.id]).toBe("draft");

    // Idempotent: a second call closes nothing new among ours.
    const { data: n2 } = await svc.rpc("close_due_campaigns");
    const { data: still } = await svc.from("campaigns").select("status").eq("id", past.id).single();
    expect(still!.status).toBe("closed");
    expect(typeof n2).toBe("number");
  });
});
```

> Implementation note for the worker: factor a small `makeCampaign(svc, overrides)` helper at the top of this file (insert into `campaigns` with required cols: `workspace_id, slug, title, starts_at, ends_at, goal_target`, plus `status`). Use a unique slug per call (e.g. `test-s2-<random>`). Add a `cleanup()` that deletes the `test-s2-` campaigns in `afterAll`.

- [ ] **Step 3: Run it — verify it passes** (the RPC already exists from Task 1)

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "close_due_campaigns"`
Expected: PASS. (If `.env.test.local` is missing or `RUN_INTEGRATION` unset, the suite SKIPs — that is a workflow error, not a pass.)

- [ ] **Step 4: Commit**

```bash
git add server/test/campaigns-s2.test.ts package.json
git commit -m "test(campaigns-s2): close_due_campaigns closes past-deadline active only, idempotent"
```

### Task 3: Integration test — `snapshot_campaign_leaderboards`

**Files:**
- Modify: `server/test/campaigns-s2.test.ts`

- [ ] **Step 1: Write the failing test**

Append a block. Arrange an active campaign with a mission, one approved in-window submission for a creator (reuse the approve path from `campaigns.test.ts`), then:

```ts
d("snapshot_campaign_leaderboards", () => {
  const svc = serviceClient();
  it("writes ranked rows for active campaigns only", async () => {
    const c = await makeActiveCampaignWithApproval(svc); // active campaign + 1 approved in-window sub
    const { data: live } = await svc.rpc("rank_campaign", { p_campaign: c.id });
    const { data: n } = await svc.rpc("snapshot_campaign_leaderboards");
    expect(n).toBeGreaterThanOrEqual((live ?? []).length);
    const { data: snap } = await svc.from("campaign_rank_snapshots")
      .select("creator_id,rank,approved").eq("campaign_id", c.id);
    expect(snap!.length).toBe((live ?? []).length);
    // ranks match the live ranker
    const liveRank = Object.fromEntries((live ?? []).map((r: any) => [r.creator_id, r.rank]));
    for (const s of snap!) expect(s.rank).toBe(liveRank[s.creator_id]);
  });
});
```

- [ ] **Step 2: Run it — verify it passes**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "snapshot_campaign_leaderboards"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/campaigns-s2.test.ts
git commit -m "test(campaigns-s2): snapshot_campaign_leaderboards captures active-campaign ranks"
```

### Task 4: Integration test — `broadcast_campaign_started` idempotency

**Files:**
- Modify: `server/test/campaigns-s2.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
d("broadcast_campaign_started", () => {
  const svc = serviceClient();
  it("inserts once per creator and is idempotent on re-call", async () => {
    const c = await makeCampaign(svc, { status: "active" });
    const creator = await makeCreator(svc, c.workspace_id); // reuse creator fixture helper
    const { data: n1 } = await svc.rpc("broadcast_campaign_started",
      { p_campaign: c.id, p_creator_ids: [creator.id] });
    expect(n1).toBe(1);
    const { data: n2 } = await svc.rpc("broadcast_campaign_started",
      { p_campaign: c.id, p_creator_ids: [creator.id] });
    expect(n2).toBe(0); // not-exists guard
    const { data: notifs } = await svc.from("notifications")
      .select("type,entity_id,data").eq("user_id", creator.id).eq("type", "campaign_started");
    expect(notifs!.length).toBe(1);
    expect(notifs![0].entity_id).toBe(c.id);
    expect(notifs![0].data.campaign_slug).toBe(c.slug);
  });
});
```

- [ ] **Step 2: Run it — verify it passes**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "broadcast_campaign_started"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/campaigns-s2.test.ts
git commit -m "test(campaigns-s2): broadcast_campaign_started inserts once, idempotent"
```

---

## Phase B — `campaign_started` matched broadcast (app layer)

### Task 5: Pure match predicate `creatorQualifiesForCampaign`

**Files:**
- Modify: `server/lib/missionMatch.ts`
- Test: `server/lib/missionMatch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/lib/missionMatch.test.ts`:

```ts
import { creatorQualifiesForCampaign } from "./missionMatch.js";

const mission = (over: Partial<MatchMission> = {}): MatchMission => ({
  id: "m", slug: "m", title: "M", category: "beauty", mission_type: "ugc",
  required_level: "L1", points_reward: 100, cash_reward: null, deadline: null,
  quota: 10, filled: 0, ...over,
});
const creator = (over: Partial<MatchCreator> = {}): MatchCreator => ({
  level: "L2", categories: ["beauty"], reliability: null, brandSafety: null, content: null, ...over,
});

describe("creatorQualifiesForCampaign", () => {
  it("matches on niche + level fit", () => {
    expect(creatorQualifiesForCampaign(creator(), [mission()])).toBe(true);
  });
  it("no match when niche differs", () => {
    expect(creatorQualifiesForCampaign(creator({ categories: ["food"] }), [mission()])).toBe(false);
  });
  it("no match when under-level even if niche fits", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L0" }), [mission({ required_level: "L3" })])).toBe(false);
  });
  it("EXCLUDES no-niche creators (categoryTerm 0.5)", () => {
    expect(creatorQualifiesForCampaign(creator({ categories: [] }), [mission()])).toBe(false);
  });
  it("matches if ANY mission in the set qualifies", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L1", categories: ["food"] }),
      [mission(), mission({ category: "food" })])).toBe(true);
  });
});
```

(Use the existing `MatchMission`/`MatchCreator` imports already at the top of the test file; add only what's missing.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/lib/missionMatch.test.ts -t "creatorQualifiesForCampaign"`
Expected: FAIL — `creatorQualifiesForCampaign is not a function`.

- [ ] **Step 3: Implement**

Append to `server/lib/missionMatch.ts` (after `levelFitTerm`):

```ts
/** True iff SOME mission in the set is both unlocked for the creator AND a niche match.
 *  No-niche creators never match (categoryTerm is 0.5, never 1). */
export function creatorQualifiesForCampaign(creator: MatchCreator, missions: MatchMission[]): boolean {
  return missions.some((m) => levelFitTerm(creator, m) === 1 && categoryTerm(creator, m) === 1);
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/lib/missionMatch.test.ts -t "creatorQualifiesForCampaign"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionMatch.ts server/lib/missionMatch.test.ts
git commit -m "feat(campaigns-s2): creatorQualifiesForCampaign match predicate (reuses matcher terms)"
```

### Task 6: I/O helper `notifyCampaignStarted`

**Files:**
- Create: `server/lib/notifyCampaignStarted.ts`

- [ ] **Step 1: Implement the helper**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase.js";
import { creatorQualifiesForCampaign, type MatchCreator, type MatchMission } from "./missionMatch.js";

/** Best-effort: fan out a campaign_started notification to category/level-matched creators.
 *  NEVER throws — a broadcast failure must not affect the publish response. */
export async function notifyCampaignStarted(campaignId: string): Promise<{ matched: number } | null> {
  try {
    const svc: SupabaseClient = serviceClient();
    const { data: campaign } = await svc.from("campaigns")
      .select("id, workspace_id").eq("id", campaignId).maybeSingle();
    if (!campaign) return null;

    const { data: cmRows } = await svc.from("campaign_missions")
      .select("missions(id, slug, title, category, mission_type, required_level, points_reward, cash_reward, deadline, quota, filled)")
      .eq("campaign_id", campaignId).is("removed_at", null);
    const missions = (cmRows ?? [])
      .map((r: any) => r.missions)
      .filter(Boolean) as MatchMission[];
    if (missions.length === 0) return { matched: 0 };

    const { data: creators } = await svc.from("creators")
      .select("id, level, categories").eq("workspace_id", campaign.workspace_id).eq("status", "active");

    const matchedIds = (creators ?? [])
      .filter((c: any) => creatorQualifiesForCampaign(
        { level: c.level ?? "L0", categories: c.categories ?? [], reliability: null, brandSafety: null, content: null } as MatchCreator,
        missions))
      .map((c: any) => c.id);
    if (matchedIds.length === 0) return { matched: 0 };

    await svc.rpc("broadcast_campaign_started", { p_campaign: campaignId, p_creator_ids: matchedIds });
    return { matched: matchedIds.length };
  } catch (err) {
    console.error("[notifyCampaignStarted] non-fatal", err);
    return null;
  }
}
```

- [ ] **Step 2: ESM-extension + type check**

Run: `npm run check:esm && npm run type-check`
Expected: both pass (no missing `.js` extension; types resolve).

- [ ] **Step 3: Commit**

```bash
git add server/lib/notifyCampaignStarted.ts
git commit -m "feat(campaigns-s2): notifyCampaignStarted best-effort matched fan-out helper"
```

### Task 7: Wire the broadcast into both publish routes

**Files:**
- Modify: `server/routes/adminCampaigns.ts` (`POST /campaigns/:id/publish`)
- Modify: `server/routes/brandCampaigns.ts` (`POST /:id/publish`) — **only if the file exists on this branch** (it arrives with PR #51; if absent, skip this file and note it for the #51 rebase).

- [ ] **Step 1: Add the call in `adminCampaigns.ts`**

Add the import at the top:
```ts
import { notifyCampaignStarted } from "../lib/notifyCampaignStarted.js";
```
In `POST /campaigns/:id/publish`, immediately AFTER the `.update({ status: "active", … })` succeeds (and before `return c.json(...)`), insert:
```ts
  await notifyCampaignStarted(id);   // best-effort; never throws
```
(`id` is the campaign id param already in scope.)

- [ ] **Step 2: Add the call in `brandCampaigns.ts` (if present)**

```bash
test -f server/routes/brandCampaigns.ts && echo PRESENT || echo "ABSENT — defer to #51 rebase"
```
If PRESENT: same import + same `await notifyCampaignStarted(id);` line after the publish `.update(...)` succeeds.

- [ ] **Step 3: Type check**

Run: `npm run check:esm && npm run type-check`
Expected: pass.

- [ ] **Step 4: Integration test — publish notifies matched, not unmatched**

Append to `server/test/campaigns-s2.test.ts` a test that calls the helper directly (route-level publish is exercised elsewhere; here assert the matching policy end-to-end):

```ts
d("notifyCampaignStarted policy", () => {
  const svc = serviceClient();
  it("notifies a matched creator but not an unmatched one", async () => {
    const c = await makeActiveCampaignWithMission(svc, { category: "beauty", required_level: "L1" });
    const match = await makeCreator(svc, c.workspace_id, { level: "L2", categories: ["beauty"], status: "active" });
    const noMatch = await makeCreator(svc, c.workspace_id, { level: "L2", categories: ["food"], status: "active" });
    const { notifyCampaignStarted } = await import("../lib/notifyCampaignStarted.js");
    await notifyCampaignStarted(c.id);
    const { data: a } = await svc.from("notifications").select("id")
      .eq("user_id", match.id).eq("type", "campaign_started").eq("entity_id", c.id);
    const { data: b } = await svc.from("notifications").select("id")
      .eq("user_id", noMatch.id).eq("type", "campaign_started").eq("entity_id", c.id);
    expect(a!.length).toBe(1);
    expect(b!.length).toBe(0);
  });
});
```

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "notifyCampaignStarted policy"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminCampaigns.ts server/routes/brandCampaigns.ts server/test/campaigns-s2.test.ts 2>/dev/null
git commit -m "feat(campaigns-s2): fire campaign_started broadcast on publish (best-effort)"
```

### Task 8: Render-at-read for `campaign_started`

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/i18n.dict.ts`
- Test: `src/lib/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/notifications.test.ts` (mirror an existing render case):

```ts
it("renders campaign_started → title/body/href", () => {
  const r = renderNotification("campaign_started",
    { campaign_title: "夏日挑戰", campaign_slug: "summer" }, tStub);
  expect(r.href).toBe("/campaigns/summer");
  expect(r.title).toContain("夏日挑戰");   // adjust to the dict template wording
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/lib/notifications.test.ts -t "campaign_started"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/lib/notifications.ts`: add `"campaign_started"` to the `NotificationType` union, and a case in `renderNotification`:
```ts
case "campaign_started":
  return {
    title: t("app.notif.campaign_started.title", { campaign: data.campaign_title ?? "" }),
    body:  t("app.notif.campaign_started.body",  { campaign: data.campaign_title ?? "" }),
    href:  "/campaigns/" + (data.campaign_slug ?? ""),
    icon:  Megaphone,   // import from lucide-react alongside existing icons
  };
```
In `src/lib/i18n.dict.ts`, add under the `app.notif` group (both `zh` and `en` trees):
```ts
// zh-HK
"app.notif.campaign_started.title": "新挑戰開始！",
"app.notif.campaign_started.body": "「{campaign}」啱你參加，立即睇下點贏獎賞 🎯",
// en
"app.notif.campaign_started.title": "New challenge live!",
"app.notif.campaign_started.body": "\"{campaign}\" is a fit for you — see how to win 🎯",
```
(Match the exact key/placeholder style already used by the other `app.notif.*` entries.)

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run src/lib/notifications.test.ts -t "campaign_started"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/lib/i18n.dict.ts src/lib/notifications.test.ts
git commit -m "feat(campaigns-s2): render-at-read campaign_started notification (zh/en)"
```

---

## Phase C — Daily cron (auto-close + snapshot)

### Task 9: Generalize the daily cron to a maintenance pass

**Files:**
- Modify: `server/routes/cron.ts`
- Modify: `vercel.json`
- Modify/Rename: `server/test/cron-publish-scheduled.test.ts` → `server/test/cron-daily.test.ts`

- [ ] **Step 1: Update the route**

In `server/routes/cron.ts`, replace the `GET /publish-scheduled` handler with `GET /daily`:

```ts
cronRoutes.get("/daily", async (c) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || c.req.header("Authorization") !== `Bearer ${expected}`)
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  const svc = serviceClient();
  const out: { published: number | null; snapshotted: number | null; campaignsClosed: number | null; errors: string[] } =
    { published: null, snapshotted: null, campaignsClosed: null, errors: [] };

  try { const { data, error } = await svc.rpc("content_publish_scheduled"); if (error) throw error; out.published = data ?? 0; }
  catch (e: any) { out.errors.push("publish:" + (e?.message ?? "err")); }

  try { const { data, error } = await svc.rpc("snapshot_campaign_leaderboards"); if (error) throw error; out.snapshotted = data ?? 0; }
  catch (e: any) { out.errors.push("snapshot:" + (e?.message ?? "err")); }

  try { const { data, error } = await svc.rpc("close_due_campaigns"); if (error) throw error; out.campaignsClosed = data ?? 0; }
  catch (e: any) { out.errors.push("close:" + (e?.message ?? "err")); }

  return c.json(out);
});
```
(Order matters: snapshot BEFORE close, so final pre-close ranks are captured.)

- [ ] **Step 2: Update `vercel.json`**

Change the daily cron entry path from `/api/cron/publish-scheduled` to `/api/cron/daily` (schedule stays `0 0 * * *`). Leave `social-refresh` untouched. Confirm the file still has exactly **2** cron entries.

- [ ] **Step 3: Update the test**

Rename `server/test/cron-publish-scheduled.test.ts` → `server/test/cron-daily.test.ts`; update the path under test to `/api/cron/daily`. Keep the existing auth tests (401 without/with wrong bearer). Add a success case asserting the response shape `{ published, snapshotted, campaignsClosed, errors }` (mock `serviceClient().rpc` to return counts, as the existing test mocks it). Add a per-task-isolation case: make `close_due_campaigns` rpc reject; assert HTTP 200 with `campaignsClosed: null` and a `close:` entry in `errors`, while `published`/`snapshotted` still carry their values. If `package.json`'s `test:integration`/unit list names the old file explicitly, update that reference.

- [ ] **Step 4: Run the cron test**

Run: `npx vitest run server/test/cron-daily.test.ts`
Expected: PASS (auth + shape + isolation).

- [ ] **Step 5: Commit**

```bash
git add server/routes/cron.ts vercel.json server/test/cron-daily.test.ts package.json
git rm server/test/cron-publish-scheduled.test.ts 2>/dev/null
git commit -m "feat(campaigns-s2): daily cron runs publish + snapshot + auto-close (2-cron cap kept)"
```

---

## Phase D — Leaderboard rank-movement

### Task 10: `shapeLeaderboard` movement (pure)

**Files:**
- Modify: `server/lib/campaignLeaderboard.ts`
- Test: `server/lib/campaignLeaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/lib/campaignLeaderboard.test.ts`:

```ts
it("computes movement vs previous ranks (up/down/new/unchanged)", () => {
  const rows = [
    { creator_id: "a", rank: 1, approved: 5, avg_quality: 0 },
    { creator_id: "b", rank: 2, approved: 3, avg_quality: 0 },
    { creator_id: "c", rank: 3, approved: 1, avg_quality: 0 },
  ];
  const profiles = rows.map((r) => ({ id: r.creator_id, display_name: r.creator_id }));
  const prev = new Map([["a", 2], ["b", 2], ["c", 5]]); // a was 2 (→up1), b unchanged, c was 5 (→up2); no entry = NEW
  const out = shapeLeaderboard(rows, profiles, prev);
  expect(out.find((e) => e.creator_id === "a")!.movement).toBe(1);   // 2 - 1
  expect(out.find((e) => e.creator_id === "b")!.movement).toBe(0);   // 2 - 2
  expect(out.find((e) => e.creator_id === "c")!.movement).toBe(2);   // 5 - 3
});
it("movement is null when no previous rank exists (NEW)", () => {
  const rows = [{ creator_id: "z", rank: 1, approved: 1, avg_quality: 0 }];
  const out = shapeLeaderboard(rows, [{ id: "z", display_name: "Z" }], new Map());
  expect(out[0].movement).toBeNull();
});
it("back-compat: omitting prevRanks yields null movement", () => {
  const out = shapeLeaderboard([{ creator_id: "z", rank: 1, approved: 1, avg_quality: 0 }],
    [{ id: "z", display_name: "Z" }]);
  expect(out[0].movement).toBeNull();
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/lib/campaignLeaderboard.test.ts -t "movement"`
Expected: FAIL — `movement` undefined / arg not accepted.

- [ ] **Step 3: Implement**

In `server/lib/campaignLeaderboard.ts`: add `movement: number | null` to `LeaderboardEntry`, and extend `shapeLeaderboard`:

```ts
export function shapeLeaderboard(
  rows: RankRow[], profiles: CreatorProfile[], prevRanks?: Map<string, number>,
): LeaderboardEntry[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.creator_id);
    const prev = prevRanks?.get(r.creator_id);
    return {
      creator_id: r.creator_id,
      rank: num(r.rank),
      approved: num(r.approved),
      avg_quality: num(r.avg_quality),
      display_name: p?.display_name ?? "",
      avatar_url: p?.avatar_url ?? null,
      level: num(p?.level),
      movement: prev == null ? null : prev - num(r.rank),
    };
  });
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/lib/campaignLeaderboard.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Commit**

```bash
git add server/lib/campaignLeaderboard.ts server/lib/campaignLeaderboard.test.ts
git commit -m "feat(campaigns-s2): shapeLeaderboard computes rank movement vs prior snapshot"
```

### Task 11: Leaderboard route joins the latest snapshot

**Files:**
- Modify: `server/routes/campaigns.ts` (`GET /:slug/leaderboard`)

- [ ] **Step 1: Implement the prevRank fetch**

In `GET /:slug/leaderboard`, after resolving `campaign.id` and the `ranked` rows, before shaping, add:

```ts
  // latest snapshot batch → prevRank map
  const { data: latest } = await svc.from("campaign_rank_snapshots")
    .select("captured_at").eq("campaign_id", campaign.id)
    .order("captured_at", { ascending: false }).limit(1).maybeSingle();
  const prevRanks = new Map<string, number>();
  if (latest?.captured_at) {
    const { data: snap } = await svc.from("campaign_rank_snapshots")
      .select("creator_id, rank").eq("campaign_id", campaign.id).eq("captured_at", latest.captured_at);
    for (const s of snap ?? []) prevRanks.set(s.creator_id, s.rank);
  }
```
Then pass it through: `shapeLeaderboard(ranked ?? [], profiles ?? [], prevRanks)`.

- [ ] **Step 2: Type check**

Run: `npm run check:esm && npm run type-check`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add server/routes/campaigns.ts
git commit -m "feat(campaigns-s2): leaderboard route joins latest snapshot for rank movement"
```

### Task 12: Leaderboard UI renders movement

**Files:**
- Modify: the campaign leaderboard component + its response type (locate via `grep -rl "leaderboard" src/routes src/components src/lib/queries`)
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add `movement` to the client leaderboard entry type**

Wherever the leaderboard response is typed (e.g. `src/lib/queries/kocmax.ts`), add `movement: number | null` to the entry type so it flows from the API.

- [ ] **Step 2: Render the indicator**

In the leaderboard row JSX, next to the rank, render:
```tsx
{entry.movement == null ? (
  <span aria-label={t("app.campaign.lb.new")} title={t("app.campaign.lb.new")}>NEW</span>
) : entry.movement > 0 ? (
  <span className="text-emerald-600" aria-label={t("app.campaign.lb.up", { n: entry.movement })}>↑{entry.movement}</span>
) : entry.movement < 0 ? (
  <span className="text-muted-foreground" aria-label={t("app.campaign.lb.down", { n: -entry.movement })}>↓{-entry.movement}</span>
) : (
  <span aria-label={t("app.campaign.lb.same")}>—</span>
)}
```
Match the component's existing class/token conventions.

- [ ] **Step 3: i18n keys**

Add to `src/lib/i18n.dict.ts` (zh + en): `app.campaign.lb.new` ("新上榜"/"New"), `app.campaign.lb.up` ("升 {n} 位"/"Up {n}"), `app.campaign.lb.down` ("跌 {n} 位"/"Down {n}"), `app.campaign.lb.same` ("無變"/"No change").

- [ ] **Step 4: Type check + relevant route test**

Run: `npm run type-check && npx vitest run src/routes -t "campaign"`
Expected: pass (and any existing campaign route-stub test still green; update its mock to include `movement: null` if it asserts on leaderboard rows).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/i18n.dict.ts src/routes src/components 2>/dev/null
git commit -m "feat(campaigns-s2): leaderboard UI shows rank movement (↑/↓/—/NEW, bilingual)"
```

---

## Phase E — Full verification

### Task 13: Full suite + lint + type-check

- [ ] **Step 1: Pure/unit + frontend tests**

Run: `npm run type-check && npm run lint && npx vitest run`
Expected: all green (unit suites; integration SKIP without `RUN_INTEGRATION`).

- [ ] **Step 2: Integration suite (local stack)**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration`
Expected: all green, including `server/test/campaigns-s2.test.ts`.

- [ ] **Step 3: ESM guard**

Run: `npm run check:esm`
Expected: pass.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A && git commit -m "chore(campaigns-s2): lint/type fixups" --allow-empty
```

---

## Post-merge prod runbook (NOT during implementation)

1. Merge the PR to `main`.
2. Verify the live notifications CHECK name: `select conname from pg_constraint where conrelid='public.notifications'::regclass and contype='c';` (Supabase MCP, project `mhkoayftiuojxlrkollf`). If it differs from `notifications_type_check`, adjust the `drop constraint` name in the SQL you run.
3. Apply `0026` to prod via raw SQL (`execute_sql`) — it is idempotent (`if not exists` / `or replace`). Then `notify pgrst, 'reload schema';`.
4. Confirm the deploy carries the `vercel.json` `/api/cron/daily` path and still has exactly 2 crons (Hobby cap).
5. Smoke: `curl -H "Authorization: Bearer $CRON_SECRET" https://adfocate-2.vercel.app/api/cron/daily` → `{published, snapshotted, campaignsClosed, errors:[]}`.
6. Document `0026` as "applied via raw SQL — not in tracker, do not re-apply."

---

## Self-review notes (author)

- **Spec coverage:** §3.1→T1, §3.2→T1/T2, §3.3→T1/T3, §3.4→T1/T4, §3.5→T1; §4 cron→T9; §5 predicate→T5, helper→T6, wiring→T7, render→T8; §6 movement shaper→T10, route→T11, UI→T12; §7 tests distributed; §9 prod→runbook. No gaps.
- **Type consistency:** `creatorQualifiesForCampaign(MatchCreator, MatchMission[])`, `shapeLeaderboard(rows, profiles, prevRanks?)` + `movement: number|null`, `notifyCampaignStarted(campaignId)`, RPCs `close_due_campaigns()/snapshot_campaign_leaderboards()/broadcast_campaign_started(uuid,uuid[])` — consistent across tasks.
- **Known soft spots for the worker:** the integration fixture helpers (`makeCampaign`, `makeCreator`, `makeActiveCampaignWithApproval`, `makeActiveCampaignWithMission`) must be adapted from `server/test/campaigns.test.ts`'s existing setup; `brandCampaigns.ts` may be absent pre-#51 (Task 7 guards). Confirm the exact lucide icon name and `app.notif.*` key style against the existing dict before copying.
