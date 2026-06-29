# Brand Self-Serve Campaigns (G1 Slice 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a brand self-serve surface to **author and close** campaigns at `/brand/campaigns`, reusing Slice 1's engines/libs/RLS; **settle stays operator-only**.

**Architecture:** A new `server/routes/brandCampaigns.ts` (`Hono<BrandEnv>`) mounted under the existing brand guarded router. Reads/writes go through `makeUserClient(jwt)` so `0025` brand RLS enforces workspace isolation; `serviceClient` is used ONLY for the two SECURITY-DEFINER ops (`close_campaign`, `rank_campaign`), each behind a `brandOwnsCampaign()` RLS-read 404-gate. A client trio `src/routes/brand.campaigns.*` mirrors `admin.campaigns.*`. **No migration, no new env.**

**Tech Stack:** Hono + Supabase RLS (`makeUserClient`), TanStack Router + React Query, Vitest integration (local stack), bilingual i18n.

**Source spec:** [`docs/superpowers/specs/2026-06-28-brand-campaigns-1b-design.md`](../specs/2026-06-28-brand-campaigns-1b-design.md) (§1–§7).

---

## Critical context (read before Task 1)

- **Branch:** `feat/brand-campaigns-1b` (already created off `feat/campaigns-g1`; the spec is committed at `eb43d28`). STAY ON IT — do NOT switch to `main` or `feat/campaigns-g1`.
- **House rules (CI-guarded / hard-won, same as Slice 1):**
  - New `server/**` files MUST use `.js` extensions on relative imports (`npm run check:esm` guards this).
  - Run `npm run type-check` after adding TanStack routes (runs the route-tree codegen; bare `tsc` does not). It MUST report **0 errors** (fix any `TS18047` "possibly null" with a `!` or cast).
  - Run integration tests with the flag + env sourced in ONE command (the bare command flakes at the 5s default; the flag sets 30s):
    `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/brand-campaigns.test.ts`
  - NEVER source `.env.local` (PROD creds). NEVER `vercel --prod` from local.
  - The local Supabase DB is docker container `supabase_db_adfocate-2`; `psql` is not on the host PATH (use `docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres` if you need raw SQL — but this slice needs no migration).
- **Reused, already on this branch:** `server/lib/campaignAuthoring.ts` (`validateCampaign`, `validateEdit`, `canAttachMission`, `CAMPAIGN_EDITABLE_COLS`, types), `server/lib/campaignLeaderboard.ts` (`shapeLeaderboard`), `server/routes/adminCampaigns.ts` (operator analog), `src/routes/admin.campaigns.*` (client analog), `src/components/admin/CampaignPrizeTiers.tsx` (prize-tier editor), `0025` brand RLS on `campaigns`/`campaign_missions` + brand SELECT on `campaign_participants`.
- **Brand portal pattern** (`server/routes/brand.ts`): `requireBrand()` middleware → `c.var.brand = { email, workspaceId, role }`; `bearer(c)` helper; `makeUserClient(bearer(c))` for RLS ops; `serviceClient()` for privileged ops; mounted via `guarded.route(...)` then `brandRoutes.route("/", guarded)`.

## File structure

**Server**
- Create: `server/routes/brandCampaigns.ts` — brand campaign router (author + close + leaderboard).
- Modify: `server/routes/brand.ts` — mount `brandCampaignRoutes` under `guarded`.

**Server tests**
- Create: `server/test/brand-campaigns.test.ts` — integration (RLS isolation + lifecycle).
- Modify: `package.json` — add the file to `test:integration`.

**Client**
- Modify: `src/lib/brand.ts` — `BrandCampaign` types + `brandCampaignKeys` + fetchers/mutations.
- Modify: `src/lib/i18n.dict.ts` — brand campaign nav/page keys (en + zh).
- Modify: `src/components/brand/BrandNav.tsx` — campaigns nav entry.
- Create: `src/routes/brand.campaigns.index.tsx` / `brand.campaigns.new.tsx` / `brand.campaigns.$id.tsx`.
- Create: `src/routes/-brand.campaigns.test.tsx` — route-stub test.

**Out of scope:** settle/cash, brand budget UI (Slice 3), brand analytics (Slice 4), brand notifications, any migration.

---

## Phase A — Server

### Task 1: `brandCampaigns.ts` route + mount

**Files:**
- Create: `server/routes/brandCampaigns.ts`
- Modify: `server/routes/brand.ts`

- [ ] **Step 1: Create `server/routes/brandCampaigns.ts` with EXACTLY this code:**

```ts
// server/routes/brandCampaigns.ts
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { type BrandEnv } from "../lib/brandAuth.js";
import {
  type CampaignInput, type CampaignRecord, validateCampaign, validateEdit,
  canAttachMission, CAMPAIGN_EDITABLE_COLS,
} from "../lib/campaignAuthoring.js";
import { shapeLeaderboard } from "../lib/campaignLeaderboard.js";

/** Brand self-serve campaigns: AUTHOR + CLOSE only (settle is operator-only). Reads/writes run
 *  through makeUserClient(jwt) so 0025 brand RLS enforces workspace isolation — a cross-workspace
 *  campaign is invisible (→ 404). workspace_id always comes from c.var.brand, never the body.
 *  serviceClient is used ONLY for the two SECURITY-DEFINER ops (close_campaign, rank_campaign),
 *  each gated by brandOwnsCampaign() (an RLS read that 404s a foreign campaign). */

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

const CAMPAIGN_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_metric, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at, " +
  "created_by, created_at, updated_at";

export const brandCampaignRoutes = new Hono<BrandEnv>();

function pickEditable(body: CampaignInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPAIGN_EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}

/** RLS ownership gate: read the campaign as the brand user; null = not theirs / nonexistent → 404. */
async function brandOwnsCampaign(uc: SupabaseClient, id: string) {
  const { data } = await uc.from("campaigns").select("id, workspace_id, status").eq("id", id).maybeSingle();
  return data as null | { id: string; workspace_id: string; status: string };
}

async function participantCount(uc: SupabaseClient, campaignId: string) {
  const { count } = await uc.from("campaign_participants").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

// List ------------------------------------------------------------------------------------------
brandCampaignRoutes.get("/", async (c) => {
  const b = c.var.brand;
  const status = c.req.query("status") || "";
  let q = makeUserClient(bearer(c)).from("campaigns").select(CAMPAIGN_COLS)
    .eq("workspace_id", b.workspaceId).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) { console.error("[brandCampaigns] list", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ campaigns: data ?? [] });
});

// Detail (campaign + attached missions + participant count) -------------------------------------
brandCampaignRoutes.get("/:id", async (c) => {
  const uc = makeUserClient(bearer(c));
  const { data: campaign, error } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) { console.error("[brandCampaigns] detail", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const cid = (campaign as { id: string }).id;
  const { data: missions } = await uc.from("campaign_missions")
    .select("mission_id, added_at, removed_at, missions(title, slug, status)")
    .eq("campaign_id", cid).is("removed_at", null);
  return c.json({ campaign, missions: missions ?? [], participants: await participantCount(uc, cid) });
});

// Create draft ----------------------------------------------------------------------------------
brandCampaignRoutes.post("/", async (c) => {
  const b = c.var.brand;
  const body = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const input: CampaignInput = { ...body, workspace_id: b.workspaceId };   // never trust the body's workspace
  const { ok, errors } = validateCampaign(input, "draft");
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const insert = { ...pickEditable(input), workspace_id: b.workspaceId, status: "draft" };
  const { data, error } = await makeUserClient(bearer(c)).from("campaigns").insert(insert).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    console.error("[brandCampaigns] create", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data }, 201);
});

// Edit ------------------------------------------------------------------------------------------
brandCampaignRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const uc = makeUserClient(bearer(c));
  const { data: existing, error: exErr } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (exErr) { console.error("[brandCampaigns] edit-read", exErr); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  const hasEngagement = (await participantCount(uc, id)) > 0;
  const { ok, errors } = validateEdit(existing as unknown as CampaignRecord, patch, hasEngagement);
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const updates = { ...pickEditable(patch), updated_at: new Date().toISOString() };   // status/closed_at/settled_at are NOT editable cols
  const { data, error } = await uc.from("campaigns").update(updates).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    console.error("[brandCampaigns] edit", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Publish (draft -> active) ---------------------------------------------------------------------
brandCampaignRoutes.post("/:id/publish", async (c) => {
  const id = c.req.param("id");
  const uc = makeUserClient(bearer(c));
  const { data: existing } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as { status: string }).status !== "draft") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  const { ok, errors } = validateCampaign(existing as unknown as CampaignInput, "publish");
  if (!ok) return c.json({ error: "未符合發佈條件", code: "validation", fields: errors }, 422);
  const now = new Date().toISOString();
  const { data, error } = await uc.from("campaigns")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) { console.error("[brandCampaigns] publish", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ campaign: data });
});

// Attach / detach mission -----------------------------------------------------------------------
brandCampaignRoutes.post("/:id/missions", async (c) => {
  const b = c.var.brand;
  const id = c.req.param("id");
  const { mission_id } = await c.req.json<{ mission_id: string }>().catch(() => ({ mission_id: "" }));
  const uc = makeUserClient(bearer(c));
  const { data: campaign } = await uc.from("campaigns").select("id, status").eq("id", id).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const st = (campaign as { status: string }).status;
  if (st === "closed" || st === "settled") return c.json({ error: "結束後不可加入任務", code: "conflict" }, 409);
  const { data: active } = await uc.from("campaign_missions").select("mission_id").eq("mission_id", mission_id).is("removed_at", null);
  const guard = canAttachMission(new Set((active ?? []).map((r) => r.mission_id as string)), mission_id);
  if (!guard.ok) return c.json({ error: guard.error, code: "conflict" }, 409);
  // RLS insert (with_check brand workspace) + the composite FK guarantees mission ∈ brand workspace.
  const { error } = await uc.from("campaign_missions").insert({ campaign_id: id, mission_id, workspace_id: b.workspaceId });
  if (error) {
    if (error.code === "23505") return c.json({ error: "此任務已連結到進行中的挑戰", code: "conflict" }, 409);
    if (error.code === "23503") return c.json({ error: "此任務不存在或不屬於你的 workspace", code: "conflict" }, 409);  // composite FK
    console.error("[brandCampaigns] attach", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ ok: true }, 201);
});

brandCampaignRoutes.delete("/:id/missions/:missionId", async (c) => {
  const uc = makeUserClient(bearer(c));
  const { data: campaign } = await uc.from("campaigns").select("status").eq("id", c.req.param("id")).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const st = (campaign as { status: string }).status;
  if (st === "closed" || st === "settled") return c.json({ error: "結束後不可移除任務", code: "conflict" }, 409);
  const { error } = await uc.from("campaign_missions").update({ removed_at: new Date().toISOString() })
    .eq("campaign_id", c.req.param("id")).eq("mission_id", c.req.param("missionId")).is("removed_at", null);
  if (error) { console.error("[brandCampaigns] detach", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ ok: true });
});

// Close (active -> closed) — SECURITY-DEFINER RPC behind the RLS ownership gate -------------------
brandCampaignRoutes.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const owned = await brandOwnsCampaign(makeUserClient(bearer(c)), id);
  if (!owned) return c.json({ error: "not_found", code: "not_found" }, 404);
  const { data, error } = await serviceClient().rpc("close_campaign", { p_campaign: id });
  if (error) {
    const msg = String(error.message);
    if (msg.includes("wrong_state")) return c.json({ error: "狀態不符", code: "conflict" }, 409);
    if (msg.includes("not_found")) return c.json({ error: "not_found", code: "not_found" }, 404);
    console.error("[brandCampaigns] close", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Leaderboard — SECURITY-DEFINER rank_campaign behind the RLS ownership gate ----------------------
brandCampaignRoutes.get("/:id/leaderboard", async (c) => {
  const id = c.req.param("id");
  const owned = await brandOwnsCampaign(makeUserClient(bearer(c)), id);
  if (!owned) return c.json({ error: "not_found", code: "not_found" }, 404);
  const svc = serviceClient();
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: id });
  if (error) { console.error("[brandCampaigns] leaderboard", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
```

- [ ] **Step 2: Mount under the brand guarded router in `server/routes/brand.ts`.**

Add the import near the top (after the existing imports):
```ts
import { brandCampaignRoutes } from "./brandCampaigns.js";
```
And mount it on `guarded` **before** the final `brandRoutes.route("/", guarded);` line:
```ts
guarded.route("/campaigns", brandCampaignRoutes);
```

- [ ] **Step 3: Verify imports + types.**

Run: `npm run check:esm && npm run type-check`
Expected: both pass (0 errors). If `SupabaseClient` import path differs, copy the import style from `server/routes/brand.ts` / `server/lib/supabase.ts`.

- [ ] **Step 4: Commit.**

```bash
git add server/routes/brandCampaigns.ts server/routes/brand.ts
git commit -m "feat(brand-campaigns): brandCampaigns route (author + close + leaderboard, RLS-scoped) + mount

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Integration test — brand lifecycle + RLS isolation + no-settle

**Files:**
- Create: `server/test/brand-campaigns.test.ts`
- Modify: `package.json` (add to `test:integration`)

- [ ] **Step 1: Confirm the test-helper signatures (they vary — verify, don't assume).**

Run: `grep -nE "export async function makeBrand|export async function seedMission|export async function makeCreator|export async function makeMission" server/test/helpers.ts`
Note for the test below:
- `makeBrand(email, workspaceId?, role?)` — email MUST end `@test.local`; it creates a Supabase user + a throwaway workspace (if none passed) + an active `brand_users` row, and returns a signed-in JWT + the workspace id. **Inspect its exact return shape** (likely `{ userId, jwt, workspaceId }`) and use those field names.
- `seedMission(workspaceId, opts)` — inserts a mission in a GIVEN workspace (slug must start with `test-`). Use it to put a mission in the brand's workspace.
- The global `cleanup()` already removes test campaigns (`slug like 'test-%'`) + throwaway workspaces (`slug like 'test-camp-%'`) and brand `%@test.local` data.

- [ ] **Step 2: Create `server/test/brand-campaigns.test.ts`** (adapt the `makeBrand`/`seedMission` field names to Step 1):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app.js";
import { makeBrand, seedMission, cleanup, hasSupabaseEnv } from "./helpers.js";

const suite = hasSupabaseEnv ? describe : describe.skip;
const { app } = createApp();

// Brand request helper: brand auth is Bearer-JWT only (requireBrand resolves the workspace from the token).
function breq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api/brand${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("brand campaigns — lifecycle + RLS isolation", () => {
  // brandA + brandB live in DIFFERENT workspaces (makeBrand mints a throwaway workspace each).
  let A: { jwt: string; workspaceId: string };
  let B: { jwt: string; workspaceId: string };
  beforeAll(async () => {
    await cleanup();
    // NOTE: adapt destructuring to makeBrand's real return shape (Task 2 Step 1).
    A = await makeBrand("brand-camp-a@test.local");
    B = await makeBrand("brand-camp-b@test.local");
  });
  afterAll(cleanup);

  it("a brand creates, publishes, lists, and closes its OWN campaign", async () => {
    // create draft
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-1", title: "品牌挑戰", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 2, completion_bonus_points: 100, completion_bonus_xp: 20, prize_tiers: [] }),
    });
    expect(created.status).toBe(201);
    const { campaign } = await created.json() as { campaign: { id: string; workspace_id: string; status: string } };
    expect(campaign.workspace_id).toBe(A.workspaceId);   // forced from identity
    expect(campaign.status).toBe("draft");

    // attach a mission from the brand's own workspace
    const m = await seedMission(A.workspaceId, { slug: "test-bc-m1" });
    const attach = await breq(`/campaigns/${campaign.id}/missions`, A.jwt, {
      method: "POST", body: JSON.stringify({ mission_id: (m as { id: string }).id }),
    });
    expect(attach.status).toBe(201);

    // publish
    const pub = await breq(`/campaigns/${campaign.id}/publish`, A.jwt, { method: "POST", body: "{}" });
    expect(pub.status).toBe(200);

    // appears in its own list
    const list = await breq("/campaigns", A.jwt);
    const { campaigns } = await list.json() as { campaigns: { slug: string }[] };
    expect(campaigns.map((c) => c.slug)).toContain("test-bc-1");

    // close (RPC behind the ownership gate)
    const close = await breq(`/campaigns/${campaign.id}/close`, A.jwt, { method: "POST", body: "{}" });
    expect(close.status).toBe(200);
    const { campaign: closed } = await close.json() as { campaign: { status: string } };
    expect(closed.status).toBe("closed");
  });

  it("a brand CANNOT read, edit, close, or see another workspace's campaign (RLS)", async () => {
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-foreign", title: "A 的挑戰", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 1, completion_bonus_points: 50, completion_bonus_xp: 10, prize_tiers: [] }),
    });
    const { campaign } = await created.json() as { campaign: { id: string } };

    // B cannot read A's campaign → 404
    expect((await breq(`/campaigns/${campaign.id}`, B.jwt)).status).toBe(404);
    // B cannot edit A's campaign → 404 (RLS read returns nothing)
    expect((await breq(`/campaigns/${campaign.id}`, B.jwt, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status).toBe(404);
    // B cannot close A's campaign → 404 (ownership gate)
    expect((await breq(`/campaigns/${campaign.id}/close`, B.jwt, { method: "POST", body: "{}" })).status).toBe(404);
    // B cannot read A's leaderboard → 404
    expect((await breq(`/campaigns/${campaign.id}/leaderboard`, B.jwt)).status).toBe(404);
    // A's campaign never appears in B's list
    const { campaigns } = await (await breq("/campaigns", B.jwt)).json() as { campaigns: { slug: string }[] };
    expect(campaigns.map((c) => c.slug)).not.toContain("test-bc-foreign");
  });

  it("there is NO brand settle endpoint (settle is operator-only)", async () => {
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-nosettle", title: "X", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 1, completion_bonus_points: 10, completion_bonus_xp: 5, prize_tiers: [] }),
    });
    const { campaign } = await created.json() as { campaign: { id: string } };
    // POST /brand/campaigns/:id/settle is an unregistered route → 404 (Hono not-found).
    const res = await breq(`/campaigns/${campaign.id}/settle`, A.jwt, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the suite.**

```bash
set -a; source .env.test.local; set +a
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/brand-campaigns.test.ts
```
Expected: all 3 tests PASS, 0 skipped. If they SKIP, the env wasn't sourced. If `makeBrand`'s return field names differ, fix the destructuring (Step 1). If the create returns 422, check that `validateCampaign` "draft" mode only needs slug/title/workspace (it does — window/goal are publish-only).

- [ ] **Step 4: Add the file to `test:integration` in `package.json`.** Append ` server/test/brand-campaigns.test.ts` to the end of that script's space-separated file list.

- [ ] **Step 5: Commit.**

```bash
git add server/test/brand-campaigns.test.ts package.json
git commit -m "test(brand-campaigns): integration — lifecycle, RLS isolation, no-settle + CI wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — Client

### Task 3: Brand client lib (`src/lib/brand.ts`) — types, keys, fetchers + i18n keys

**Files:**
- Modify: `src/lib/brand.ts`
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Learn the existing brand client conventions.**

Run: `grep -nE "brandFetch|brandKeys|export function fetchBrandMissions|export type BrandMission|AdminRequestError|BrandRequestError|export class" src/lib/brand.ts`
Read the result + 1-2 fetcher bodies. Match the file's actual `brandFetch` signature, its keys object name (`brandKeys` or similar), and its error class for the campaigns additions below. (If it has no keys object, add one; if it reuses `adminKeys`-style inline arrays, follow that.)

- [ ] **Step 2: Add to `src/lib/brand.ts`** (adapt `brandFetch`/keys names to Step 1; mirror `fetchBrandMissions`):

```ts
export type BrandCampaign = {
  id: string; workspace_id: string; slug: string; title: string; description: string | null; status: string;
  starts_at: string; ends_at: string; goal_target: number;
  completion_bonus_points: number; completion_bonus_xp: number;
  prize_tiers: { rank_from: number; rank_to: number; cash: number; points: number; xp: number }[];
};
export type BrandCampaignDraft = Omit<BrandCampaign, "id" | "workspace_id" | "status">;

// keys — add to the brand keys object (or define brandCampaignKeys if there is no keys object):
export const brandCampaignKeys = {
  list: (status: string) => ["brand-campaigns", status] as const,
  detail: (id: string) => ["brand-campaign", id] as const,
  leaderboard: (id: string) => ["brand-campaign-board", id] as const,
};

export function fetchBrandCampaigns(status = "") {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return brandFetch<{ campaigns: BrandCampaign[] }>(`/brand/campaigns${qs}`);
}
export function fetchBrandCampaign(id: string) {
  return brandFetch<{ campaign: BrandCampaign; missions: unknown[]; participants: number }>(`/brand/campaigns/${id}`);
}
export function createBrandCampaign(body: Partial<BrandCampaignDraft>) {
  return brandFetch<{ campaign: BrandCampaign }>("/brand/campaigns", { method: "POST", body: JSON.stringify(body) });
}
export function updateBrandCampaign(id: string, patch: Partial<BrandCampaignDraft>) {
  return brandFetch<{ campaign: BrandCampaign }>(`/brand/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function publishBrandCampaign(id: string) {
  return brandFetch(`/brand/campaigns/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
}
export function attachBrandCampaignMission(id: string, mission_id: string) {
  return brandFetch(`/brand/campaigns/${id}/missions`, { method: "POST", body: JSON.stringify({ mission_id }) });
}
export function detachBrandCampaignMission(id: string, missionId: string) {
  return brandFetch(`/brand/campaigns/${id}/missions/${missionId}`, { method: "DELETE" });
}
export function closeBrandCampaign(id: string) {
  return brandFetch(`/brand/campaigns/${id}/close`, { method: "POST", body: JSON.stringify({}) });
}
export function fetchBrandCampaignLeaderboard(id: string) {
  return brandFetch<{ leaderboard: { creator_id: string; rank: number; approved: number; avg_quality: number; display_name: string; avatar_url: string | null; level: number }[] }>(`/brand/campaigns/${id}/leaderboard`);
}
```
> The actual `brandFetch` may be named differently and may already prefix `/brand` or `/api` — match its real signature (Step 1). If it adds `/api` itself, drop it from the paths above; if it already scopes to `/brand`, use relative `/campaigns/...` paths.

- [ ] **Step 3: Add i18n keys to `src/lib/i18n.dict.ts` — BOTH en and zh, identical key sets** (there's a parity guard). Add to the en block:
```ts
"app.brand.navCampaigns": "Challenges",
"app.brand.campaigns.title": "Challenges",
"app.brand.campaigns.new": "New challenge",
"app.brand.campaigns.settleHint": "Settlement (cash prizes) is handled by your Fimmick operator.",
```
And the SAME keys in the zh block:
```ts
"app.brand.navCampaigns": "挑戰",
"app.brand.campaigns.title": "挑戰",
"app.brand.campaigns.new": "新增挑戰",
"app.brand.campaigns.settleHint": "結算（現金獎賞）由你的 Fimmick 營運團隊處理。",
```
Reuse the existing `app.campaigns.*` keys (goalProgress/leaderboard/prizes/completionBonus/active/upcoming/endsIn — already shipped in Slice 1) for shared labels.

- [ ] **Step 4: Verify + commit.**

Run: `npm run type-check && npx vitest run src/lib/i18n.test.tsx`
Expected: 0 type errors; i18n parity test green.
```bash
git add src/lib/brand.ts src/lib/i18n.dict.ts
git commit -m "feat(brand-campaigns): brand client fetchers/keys/types + i18n keys (en/zh)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Brand routes (`brand.campaigns` trio) + nav + route-stub test

**Files:**
- Create: `src/routes/brand.campaigns.index.tsx` / `brand.campaigns.new.tsx` / `brand.campaigns.$id.tsx`
- Create: `src/routes/-brand.campaigns.test.tsx`
- Modify: `src/components/brand/BrandNav.tsx`

> **Mirror two existing things:** (a) the operator campaign UI `src/routes/admin.campaigns.index.tsx` / `admin.campaigns.new.tsx` / `admin.campaigns.$id.tsx` for the form/edit-lock/prize-tier structure (reuse `src/components/admin/CampaignPrizeTiers.tsx`), and (b) `src/routes/brand.missions.index.tsx` / `brand.missions.new.tsx` / `brand.missions.$missionId.tsx` for the brand auth context, route paths (`/brand/campaigns/...`), and `brandFetch`-based mutations. Read all of these before writing. The route PATHS in `createFileRoute(...)` MUST match the file names exactly (`/brand/campaigns/`, `/brand/campaigns/new`, `/brand/campaigns/$id`).

- [ ] **Step 1: List route `src/routes/brand.campaigns.index.tsx`.** Mirror `brand.missions.index.tsx`'s auth/context + `admin.campaigns.index.tsx`'s table/actions. Use `useQuery({ queryKey: brandCampaignKeys.list(status), queryFn: () => fetchBrandCampaigns(status), enabled: <brand authed>, retry: false })`, a status-chip filter, a "New" `<Link to="/brand/campaigns/new">`, and per-row **Publish** + **Close** mutations (NO Settle) that invalidate `["brand-campaigns"]`. Route any brand-auth error the same way `brand.missions.index.tsx` does (copy its error handling exactly — likely a `reportAuthError`-in-`useEffect` or a redirect). Add an `onError` to EVERY mutation (auth errors must not fail silently).

- [ ] **Step 2: New route `src/routes/brand.campaigns.new.tsx`.** Mirror `admin.campaigns.new.tsx` (draft form: slug/title/description/window/goal/bonus points+xp + `<PrizeTierEditor>` from `@/components/admin/CampaignPrizeTiers`) but use `createBrandCampaign` → on success `useNavigate({ to: "/brand/campaigns/$id", params: { id: created.campaign.id } })`. Render field errors from the brand request error's `.fields`. Add `onError` to the create mutation.

- [ ] **Step 3: Manage route `src/routes/brand.campaigns.$id.tsx`.** Mirror `admin.campaigns.$id.tsx`: load via `useQuery(brandCampaignKeys.detail(id), () => fetchBrandCampaign(id))`; edit form honoring the lock matrix (disable slug/goal/bonus/tiers/starts_at once `status !== "draft"`); mission attach/detach (`attachBrandCampaignMission`/`detachBrandCampaignMission`); **Publish** + **Close** actions; a read-only leaderboard via `fetchBrandCampaignLeaderboard`. **NO Settle button.** On a `closed` campaign, render the `app.brand.campaigns.settleHint` string. Add `onError` to every mutation.

- [ ] **Step 4: Brand nav entry.** In `src/components/brand/BrandNav.tsx`, add a campaigns item (import a `Trophy` icon from lucide-react) pointing to `/brand/campaigns` with label key `app.brand.navCampaigns`, following the file's existing item shape (mirror the missions nav item).

- [ ] **Step 5: Route-stub test `src/routes/-brand.campaigns.test.tsx`.** Mirror `src/routes/-admin.campaigns.test.tsx`: mock `@/lib/brand` (`fetchBrandCampaigns`, `publishBrandCampaign`, `closeBrandCampaign`, `brandCampaignKeys`), the brand auth context (copy how `-admin.campaigns.test.tsx` mocks the admin context, adapted to the brand context provider used by `brand.missions.index.tsx`), `@/lib/i18n` (`useI18n: () => ({ t: (k) => k })`), and `@tanstack/react-router`. Render the list route's component; assert a campaign row renders and Publish calls `publishBrandCampaign(id)`.

- [ ] **Step 6: Verify + commit.**

Run: `npm run type-check && npx vitest run src/routes/-brand.campaigns.test.tsx`
Expected: type-check 0 errors (route tree wires the 3 routes); test green.
```bash
git add src/routes/brand.campaigns.index.tsx src/routes/brand.campaigns.new.tsx "src/routes/brand.campaigns.\$id.tsx" src/routes/-brand.campaigns.test.tsx src/components/brand/BrandNav.tsx
git commit -m "feat(brand-campaigns): brand routes (list/new/manage) + nav + route-stub test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — Verification & ship

### Task 5: Full gate + PR

**Files:** none (verification + ops)

- [ ] **Step 1: Full local gate.** Run, in order:
```bash
npm run check:esm
npm run lint
npm run type-check
npx vitest run            # all unit + route-stub tests
set -a; source .env.test.local; set +a
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/brand-campaigns.test.ts
npm run build
```
Expected: every command green (fix any failure before proceeding). NOTE: the full `npm run test:integration` has one **pre-existing** `insights.test.ts > activeCreators` failure (wallet→insights ordering contamination) that is unrelated to this slice — verify it is the ONLY failure and that `brand-campaigns.test.ts` itself is green.

- [ ] **Step 2: Open the PR (do NOT deploy from local).**
```bash
git push -u origin feat/brand-campaigns-1b
gh pr create --base feat/campaigns-g1 --head feat/brand-campaigns-1b \
  --title "Brand Self-Serve Campaigns (G1 Slice 1b) — author + close" \
  --body "$(cat <<'EOF'
Brand self-serve campaign authoring at /brand/campaigns (create/edit/publish/close + attach
missions + read leaderboard), RLS-scoped via makeUserClient; settle stays operator-only.
NO migration — reuses 0025 brand RLS + Slice 1 engines/libs.

Privileged ops (close_campaign, rank_campaign) are behind a brandOwnsCampaign RLS-read 404-gate.
Integration tests cover lifecycle, cross-workspace RLS isolation, and absence of a settle route.

Stacked on feat/campaigns-g1 (PR #50); base will retarget to main once #50 merges.

Spec: docs/superpowers/specs/2026-06-28-brand-campaigns-1b-design.md
Plan: docs/superpowers/plans/2026-06-28-brand-campaigns-1b.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
> Base is `feat/campaigns-g1` (this stacks on it). When #50 merges to `main`, retarget this PR's base to `main` (`gh pr edit --base main`).

- [ ] **Step 3: Update project memory.** Append to `adfocate-g1-campaigns-status.md`: Slice 1b implemented (PR #), brand author+close (settle operator-only), no migration. Update the `MEMORY.md` line.

---

## Self-Review (run against the spec — completed during planning)

**Spec coverage:** §1 scope/non-goals → Tasks 1 (no settle endpoint) + 2 (no-settle test); §2 auth/isolation (makeUserClient RLS + brandOwnsCampaign gate) → Task 1 + Task 2 RLS test; §3 endpoints → Task 1 (every row of the table has a handler); §4 reused libs → Task 1 imports; §5 client surfaces → Tasks 3/4; §6 tests → Tasks 2 (integration) + 4 (route-stub); §7 risks (one-active index 409, close-via-RPC not raw status flip, operator co-visibility, stacked branch) → Task 1 attach 23505→409 + edit pickEditable excludes status + Task 5 PR base note.

**Type consistency:** `CampaignInput`/`CampaignRecord`/`CAMPAIGN_EDITABLE_COLS` imported from `campaignAuthoring` (defined in Slice 1); `shapeLeaderboard` from `campaignLeaderboard`; `BrandCampaign`/`BrandCampaignDraft`/`brandCampaignKeys` defined in Task 3 and consumed in Task 4; the route's `close_campaign`/`rank_campaign` RPC names match `0025`.

**Known adaptation points the implementer MUST confirm (flagged inline, not placeholders):** `makeBrand`/`seedMission` return field names (Task 2 Step 1); `brandFetch` real name/signature + whether it prefixes `/api`/`/brand` (Task 3 Step 1); the brand auth context provider + its error-handling idiom (Task 4 Steps 1/5); `SupabaseClient` import path (Task 1 Step 3). Each has a concrete grep + fallback.

**Scope:** one feature, no migration, 5 tasks, reuses Slice 1 wholesale.
