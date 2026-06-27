# Brand Portal Slice 3 — Budget & Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each brand workspace an operator-funded HK$ budget that is debited (and hard-blocks the approval when empty) every time a cash submission is approved.

**Architecture:** A per-workspace wallet (`workspace_budgets`) + append-only ledger (`workspace_budget_transactions`). The atomic check + debit lives inside the existing `approve_submission` RPC (the only path both brand and operator approvals share), gated by a per-workspace `enforced` flag that is OFF by default so existing flows are untouched. Operators top up / toggle enforcement via `/admin` (staff-authed, `serviceClient`); brands read their own wallet via RLS.

**Tech Stack:** Postgres (Supabase migration + plpgsql `security definer` RPCs), Hono server routes, TanStack Router + React Query + Tailwind (Acid Y2K tokens), Vitest (integration + route-stub unit tests).

**Spec:** `docs/superpowers/specs/2026-06-27-brand-portal-slice3-design.md`

**Conventions (read before starting):**
- Every relative import in a non-test `server/**` file MUST carry the `.js` ESM extension (CI-guarded by `npm run build`). `src/**` and `*.test.*` files use `@/...` / relative imports with NO `.js`.
- `src/lib/i18n.dict.ts` has an `en` block and a `zh` block; a unit test asserts the key SETS are identical — every key added to one block MUST be added to the other.
- The integration suite (`server/test/*.test.ts`) auto-skips locally without a Supabase stack (`hasSupabaseEnv`); it runs in CI. Local verification for server tasks = `npm run type-check` + `npm run lint` + `npm run build`. Do NOT try to make the integration suite pass locally.
- New TanStack route files require `npm run type-check` (which runs `tsr generate`) to regenerate the route tree; `src/routeTree.gen.ts` is gitignored — do not commit it.

---

## File structure

**Create:**
- `supabase/migrations/0024_brand_budget.sql` — tables, RLS, the 3 RPCs (Task 1)
- `server/routes/adminBudget.ts` — operator budget endpoints (Task 3)
- `server/routes/brandBudget.ts` — brand read-only budget endpoint (Task 4)
- `server/test/brandBudget.test.ts` — integration proofs (Task 2)
- `src/components/admin/AdminBudgetPanel.tsx` — operator Budget tab body (Task 7)
- `src/components/brand/BrandBudgetCard.tsx` — dashboard balance card (Task 8)
- `src/routes/brand.budget.tsx` — brand budget ledger page (Task 8)
- `src/routes/-brand.budget.test.tsx` — brand page route-stub test (Task 9)

**Modify:**
- `supabase/migrations` is append-only — no edits to existing migrations.
- `server/routes/admin.ts` — mount `adminBudgetRoutes`; map `insufficient_budget` → 402 in the approve handler (Tasks 3)
- `server/routes/brandReview.ts` — map `insufficient_budget` → 402 in the approve handler (Task 4)
- `server/routes/brand.ts` — mount the brand budget route under `guarded` (Task 4)
- `server/test/helpers.ts` — add `seedWorkspaceBudget` (Task 2)
- `package.json` — register `brandBudget.test.ts` in `test:integration` (Task 2)
- `src/lib/admin.ts` — operator budget keys/types/fetchers/mutations (Task 5)
- `src/lib/brand.ts` — brand budget key/type/fetcher (Task 5)
- `src/lib/i18n.dict.ts` — `app.admin.budget.*` + `app.brand.budget.*` (Task 6)
- the operator `/admin` shell — add a "Budget" tab rendering `AdminBudgetPanel` (Task 7)
- `src/routes/brand.index.tsx` — render `BrandBudgetCard` on the dashboard (Task 8)
- `src/components/brand/BrandNav.tsx` — add a Budget nav item (Task 8)
- `src/components/brand/BrandReviewSubmissions.tsx` — a compact balance banner (Task 8)

---

## Task 1: Migration `0024_brand_budget.sql` — tables, RLS, RPCs

**Files:**
- Create: `supabase/migrations/0024_brand_budget.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0024_brand_budget.sql` with EXACTLY this content. The `approve_submission` body below is the current 0009 definition with ONE new block inserted (the budget check/debit, marked `-- Slice 3`); everything else is byte-for-byte preserved.

```sql
-- 0024_brand_budget.sql
-- Brand Portal Slice 3: a per-workspace HK$ wallet, debited on cash payout with a hard
-- spend cap. Backward-compatible: a workspace with no budget row, or enforced=false, makes
-- approve_submission behave exactly as before (zero rollout breakage).

-- 1. Wallet + append-only ledger -------------------------------------------------------------
create table if not exists public.workspace_budgets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  balance      numeric(12,2) not null default 0 check (balance >= 0),
  enforced     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.workspace_budget_transactions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  type          text not null check (type in ('topup','debit','adjust')),
  delta         numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  source_ref    text,
  description   text,
  created_at    timestamptz not null default now()
);
create index if not exists wbt_workspace_created_idx
  on public.workspace_budget_transactions (workspace_id, created_at desc);

-- 2. RLS: a brand may READ its own workspace's wallet + ledger; all writes are service_role.
alter table public.workspace_budgets enable row level security;
alter table public.workspace_budget_transactions enable row level security;

create policy workspace_budgets_brand_read on public.workspace_budgets
  for select using (
    workspace_id in (select workspace_id from public.brand_users
                     where user_id = auth.uid() and active)
  );
create policy wbt_brand_read on public.workspace_budget_transactions
  for select using (
    workspace_id in (select workspace_id from public.brand_users
                     where user_id = auth.uid() and active)
  );

grant select on public.workspace_budgets to authenticated;
grant select on public.workspace_budget_transactions to authenticated;

-- 3. Operator funding RPC: signed delta (topup +, adjust ±). Locks the row; rejects < 0.
create or replace function public.credit_workspace_budget(
  p_workspace uuid, p_delta numeric, p_type text, p_description text default null
)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare v_bal numeric;
begin
  if p_type not in ('topup','adjust') then raise exception 'bad_type'; end if;
  insert into public.workspace_budgets (workspace_id) values (p_workspace)
    on conflict (workspace_id) do nothing;
  select balance into v_bal from public.workspace_budgets
    where workspace_id = p_workspace for update;
  if v_bal + p_delta < 0 then raise exception 'negative_balance'; end if;
  update public.workspace_budgets set balance = balance + p_delta, updated_at = now()
    where workspace_id = p_workspace returning balance into v_bal;
  insert into public.workspace_budget_transactions
    (workspace_id, type, delta, balance_after, description)
    values (p_workspace, p_type, p_delta, v_bal, p_description);
  return v_bal;
end;
$$;

-- 4. Enforcement toggle.
create or replace function public.set_workspace_budget_enforcement(
  p_workspace uuid, p_enforced boolean
)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.workspace_budgets (workspace_id, enforced) values (p_workspace, p_enforced)
    on conflict (workspace_id) do update set enforced = excluded.enforced, updated_at = now();
  return p_enforced;
end;
$$;

-- 5. Redefine approve_submission to debit the wallet (only the marked block is new).
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
  v_bgt_bal numeric;
  v_bgt_enforced boolean;
begin
  if p_quality_rating is not null and (p_quality_rating < 1 or p_quality_rating > 5)
    then raise exception 'bad_rating'; end if;

  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'approved' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  select points_reward, title, cash_reward into v_points, v_title, v_cash
    from public.missions where id = v_sub.mission_id;

  -- Slice 3: brand budget hard cap. When the workspace has enforcement ON, the cash payout
  -- must fit the wallet; debit it (a raise here rolls back the whole transaction → nothing paid).
  if coalesce(v_cash, 0) > 0 then
    select balance, enforced into v_bgt_bal, v_bgt_enforced
      from public.workspace_budgets where workspace_id = v_sub.workspace_id for update;
    if v_bgt_enforced is true then
      if v_bgt_bal < v_cash then raise exception 'insufficient_budget'; end if;
      update public.workspace_budgets set balance = balance - v_cash, updated_at = now()
        where workspace_id = v_sub.workspace_id;
      insert into public.workspace_budget_transactions
        (workspace_id, type, delta, balance_after, source_ref, description)
        values (v_sub.workspace_id, 'debit', -v_cash, v_bgt_bal - v_cash,
                'mission_submission:' || p_submission, v_title);
    end if;
  end if;

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

revoke all on function public.approve_submission(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text, smallint) to service_role;
revoke all on function public.credit_workspace_budget(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.credit_workspace_budget(uuid, numeric, text, text) to service_role;
revoke all on function public.set_workspace_budget_enforcement(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_workspace_budget_enforcement(uuid, boolean) to service_role;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `grep -c "create or replace function" supabase/migrations/0024_brand_budget.sql`
Expected: `3` (approve_submission, credit_workspace_budget, set_workspace_budget_enforcement).

There is no local "compile" step for SQL in this repo; correctness is proven by the Task 2 integration test in CI. Do NOT attempt to apply the migration locally (the local stack's migration tracker is known-inconsistent).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0024_brand_budget.sql
git commit -m "feat(brand): workspace budget tables + RPCs (migration 0024)"
```

---

## Task 2: Integration test + `seedWorkspaceBudget` helper

**Files:**
- Modify: `server/test/helpers.ts`
- Create: `server/test/brandBudget.test.ts`
- Modify: `package.json`

This is TDD for the migration: the test exercises the real RPCs against a CI Postgres. It auto-skips locally.

- [ ] **Step 1: Add the `seedWorkspaceBudget` helper to `server/test/helpers.ts`**

Place it after `seedBrandSubmission` (added in Slice 2). Add EXACTLY:

```ts
/** Set a workspace's budget balance + enforcement directly (service-role) for the budget tests.
 *  Upserts the workspace_budgets row. */
export async function seedWorkspaceBudget(opts: {
  workspaceId: string;
  balance?: number;
  enforced?: boolean;
}) {
  await service()
    .from("workspace_budgets")
    .upsert(
      { workspace_id: opts.workspaceId, balance: opts.balance ?? 0, enforced: opts.enforced ?? false },
      { onConflict: "workspace_id" },
    );
}
```

- [ ] **Step 2: Add cleanup for the new tables in `cleanup()`**

In `server/test/helpers.ts`, inside the `cleanup()` function's "Test missions" loop (which iterates `testMissions`), the `mission_submissions` deletes already cascade. Separately, the `workspace_budgets`/`workspace_budget_transactions` rows reference `workspaces(id) on delete cascade`, and the brand-workspace cleanup (the `test-brand-ws-%` workspaces deleted via the brand cleanup path) cascades them. No extra code is required IF brand workspaces are already deleted in cleanup. Verify by reading `cleanup()`: if it deletes `workspaces` where `slug like 'test-brand-ws-%'`, the budget rows cascade. If it does NOT delete those workspaces, add this block before the staff-users cleanup:

```ts
  // Test brand workspaces (slug "test-brand-ws-%") — cascades brand_users + workspace_budgets.
  const testWs = await service().from("workspaces").select("id").like("slug", "test-brand-ws-%");
  for (const w of testWs.data ?? []) {
    await service().from("brand_users").delete().eq("workspace_id", w.id);
    await service().from("workspaces").delete().eq("id", w.id);
  }
```

(Only add this if the read of `cleanup()` shows brand workspaces are not already removed — do not duplicate an existing delete.)

- [ ] **Step 3: Create `server/test/brandBudget.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import {
  makeBrand,
  makeCreator,
  seedMission,
  seedBrandSubmission,
  seedWorkspaceBudget,
  serviceForTests,
  cleanup,
  hasSupabaseEnv,
} from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

const brandReq = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const ADMIN = process.env.ADMIN_SECRET ?? "test-admin-secret";
const adminReq = (path: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { "X-Admin-Secret": ADMIN, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

async function points(creatorId: string, workspaceId: string) {
  const { data } = await serviceForTests()
    .from("point_balances").select("balance")
    .eq("creator_id", creatorId).eq("workspace_id", workspaceId).single();
  return data?.balance as number;
}
async function budget(workspaceId: string) {
  const { data } = await serviceForTests()
    .from("workspace_budgets").select("balance").eq("workspace_id", workspaceId).single();
  return data?.balance as number;
}

suite("brand budget + spend cap", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let koc: Awaited<ReturnType<typeof makeCreator>>;

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("budget-a@test.local");
    B = await makeBrand("budget-b@test.local");
    koc = await makeCreator("budget-koc@test.local", 0);
  });
  afterAll(cleanup);

  it("enforcement OFF: a cash approval still succeeds and never touches the wallet", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-off", status: "active", points_reward: 10, cash_reward: 50 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
  });

  it("enforced + sufficient: approve debits the wallet by cash_reward and pays the creator", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 100, enforced: true });
    const before = await points(koc.userId, A.workspaceId);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-pay", status: "active", points_reward: 10, cash_reward: 40 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(60);            // 100 − 40
    expect(await points(koc.userId, A.workspaceId)).toBe(before + 10);
  });

  it("enforced + insufficient: approve → 402 insufficient_budget, no payout, no debit", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 10, enforced: true });
    const beforePts = await points(koc.userId, A.workspaceId);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-block", status: "active", points_reward: 10, cash_reward: 40 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("insufficient_budget");
    expect(await budget(A.workspaceId)).toBe(10);            // unchanged
    expect(await points(koc.userId, A.workspaceId)).toBe(beforePts); // not paid
  });

  it("the operator approve path is also bound by the cap (→ 402 when empty)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-op", status: "active", points_reward: 10, cash_reward: 25 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await adminReq(`/admin/submissions/${sub}/approve`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("insufficient_budget");
  });

  it("cash_reward 0 on an enforced+empty workspace still approves (no debit, no block)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-zero", status: "active", points_reward: 10, cash_reward: 0 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
  });

  it("operator top-up raises the balance and unblocks a previously-blocked approval", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const top = await adminReq("/admin/budget/topup", { method: "POST", body: JSON.stringify({ workspace_id: A.workspaceId, amount: 80 }) });
    expect(top.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(80);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-unblock", status: "active", points_reward: 10, cash_reward: 30 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(50);            // 80 − 30
  });

  it("operator adjust cannot push the balance negative (→ 400 negative_balance)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 20, enforced: true });
    const res = await adminReq("/admin/budget/adjust", { method: "POST", body: JSON.stringify({ workspace_id: A.workspaceId, delta: -50, description: "oops" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("negative_balance");
    expect(await budget(A.workspaceId)).toBe(20);
  });

  it("a brand reads only its own wallet; another brand's GET sees a different (zero) balance", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 77, enforced: true });
    const resA = await brandReq("/brand/budget", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).budget.balance).toBe(77);
    const resB = await brandReq("/brand/budget", B.jwt);
    expect((await resB.json()).budget.balance).toBe(0);     // B has no row → zero
  });
});
```

- [ ] **Step 4: Register the suite in `package.json`**

In the `"test:integration"` script, append ` server/test/brandBudget.test.ts` to the end of the space-separated file list (after `server/test/brandReview.test.ts`). Change nothing else.

- [ ] **Step 5: Verify locally (type-check + lint only — suite skips without a stack)**

Run: `npm run type-check && npm run lint`
Expected: both pass. (If `seedWorkspaceBudget` or any import doesn't resolve, fix before committing.)

- [ ] **Step 6: Commit**

```bash
git add server/test/helpers.ts server/test/brandBudget.test.ts package.json
git commit -m "test(brand): budget spend-cap + payout integration tests"
```

---

## Task 3: Operator endpoints (`adminBudget.ts`) + mount + 402 mapping

**Files:**
- Create: `server/routes/adminBudget.ts`
- Modify: `server/routes/admin.ts`

- [ ] **Step 1: Create `server/routes/adminBudget.ts`**

```ts
// server/routes/adminBudget.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";

/** Operator budget management (Slice 3). Mounted under the /admin staff-auth gate; uses
 *  serviceClient (bypasses RLS) and the SECURITY DEFINER funding RPCs. All relative imports
 *  carry the .js ESM extension. */
export const adminBudgetRoutes = new Hono();

adminBudgetRoutes.get("/budget", async (c) => {
  const ws = c.req.query("workspace");
  if (!ws) return c.json({ error: "workspace required", code: "no_workspace" }, 400);
  const svc = serviceClient();
  const { data: row } = await svc
    .from("workspace_budgets").select("balance, enforced").eq("workspace_id", ws).maybeSingle();
  const { data: txns, error } = await svc
    .from("workspace_budget_transactions")
    .select("id, type, delta, balance_after, source_ref, description, created_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(100);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ budget: { balance: row?.balance ?? 0, enforced: row?.enforced ?? false }, transactions: txns ?? [] });
});

adminBudgetRoutes.post("/budget/topup", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; amount?: number }>().catch(() => ({}));
  const ws = body.workspace_id;
  const amount = Number(body.amount);
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: "amount must be > 0", code: "bad_amount" }, 400);
  const { data, error } = await serviceClient().rpc("credit_workspace_budget", {
    p_workspace: ws, p_delta: amount, p_type: "topup", p_description: null,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json({ balance: data });
});

adminBudgetRoutes.post("/budget/adjust", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; delta?: number; description?: string }>().catch(() => ({}));
  const ws = body.workspace_id;
  const delta = Number(body.delta);
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  if (!Number.isFinite(delta) || delta === 0) return c.json({ error: "delta must be non-zero", code: "bad_amount" }, 400);
  const { data, error } = await serviceClient().rpc("credit_workspace_budget", {
    p_workspace: ws, p_delta: delta, p_type: "adjust", p_description: body.description ?? null,
  });
  if (error) {
    if (error.message === "negative_balance") return c.json({ error: "balance cannot go negative", code: "negative_balance" }, 400);
    return c.json({ error: error.message, code: "rpc_error" }, 400);
  }
  return c.json({ balance: data });
});

adminBudgetRoutes.post("/budget/enforcement", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; enforced?: boolean }>().catch(() => ({}));
  const ws = body.workspace_id;
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  const { data, error } = await serviceClient().rpc("set_workspace_budget_enforcement", {
    p_workspace: ws, p_enforced: Boolean(body.enforced),
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json({ enforced: data });
});
```

- [ ] **Step 2: Mount it + add the 402 mapping in `server/routes/admin.ts`**

Add the import near the other admin sub-router imports (after `import { adminMissionRoutes } from "./adminMissions.js";`):

```ts
import { adminBudgetRoutes } from "./adminBudget.js";
```

Add the mount alongside the other `adminRoutes.route("/", ...)` lines (e.g. after `adminRoutes.route("/", adminMissionRoutes);`):

```ts
adminRoutes.route("/", adminBudgetRoutes);
```

In the operator approve handler, change the single error line (currently `if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);` at `admin.ts:103`) to map the budget exception to 402:

```ts
  if (error) {
    if (error.message === "insufficient_budget") return c.json({ error: "budget exhausted", code: "insufficient_budget" }, 402);
    return c.json({ error: error.message, code: "rpc_error" }, 400);
  }
```

- [ ] **Step 3: Gates**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass (build runs the ESM-extension guard; the new file's imports carry `.js`).

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminBudget.ts server/routes/admin.ts
git commit -m "feat(brand): operator budget endpoints + 402 mapping (admin)"
```

---

## Task 4: Brand budget endpoint + 402 mapping (brandReview)

**Files:**
- Create: `server/routes/brandBudget.ts`
- Modify: `server/routes/brand.ts`, `server/routes/brandReview.ts`

- [ ] **Step 1: Create `server/routes/brandBudget.ts`**

```ts
// server/routes/brandBudget.ts
import { Hono } from "hono";
import { makeUserClient } from "../lib/supabase.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-facing READ-ONLY wallet. Mounted under requireBrand; reads through makeUserClient so
 *  the RLS policy (migration 0024) scopes rows to the caller's workspace. The brand can never
 *  top-up or toggle enforcement — that's operator-only. All relative imports carry .js. */
export const brandBudgetRoutes = new Hono<BrandEnv>();

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

brandBudgetRoutes.get("/budget", async (c) => {
  const ws = c.var.brand.workspaceId;
  const uc = makeUserClient(bearer(c));
  const { data: row, error: rErr } = await uc
    .from("workspace_budgets").select("balance, enforced").eq("workspace_id", ws).maybeSingle();
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);
  const { data: txns, error: tErr } = await uc
    .from("workspace_budget_transactions")
    .select("id, type, delta, balance_after, source_ref, description, created_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(50);
  if (tErr) return c.json({ error: tErr.message, code: "db_error" }, 500);
  return c.json({ budget: { balance: row?.balance ?? 0, enforced: row?.enforced ?? false }, transactions: txns ?? [] });
});
```

- [ ] **Step 2: Mount it under the brand gate in `server/routes/brand.ts`**

Add the import near the top (after `import { brandReviewRoutes } from "./brandReview.js";`):

```ts
import { brandBudgetRoutes } from "./brandBudget.js";
```

Add the mount immediately before the final `brandRoutes.route("/", guarded);` (next to `guarded.route("/review", brandReviewRoutes);`):

```ts
guarded.route("/", brandBudgetRoutes);
```

(`brandBudgetRoutes` defines `/budget` at its root, so mounting at `/` yields `/api/brand/budget`.)

- [ ] **Step 3: Add the 402 mapping in `server/routes/brandReview.ts`**

In the `POST /submissions/:id/approve` handler, change `if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);` to:

```ts
  if (error) {
    if (error.message === "insufficient_budget") return c.json({ error: "budget exhausted", code: "insufficient_budget" }, 402);
    return c.json({ error: error.message, code: "rpc_error" }, 400);
  }
```

- [ ] **Step 4: Gates**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/brandBudget.ts server/routes/brand.ts server/routes/brandReview.ts
git commit -m "feat(brand): brand read-only budget endpoint + 402 mapping"
```

---

## Task 5: Client lib — keys, types, fetchers, mutations

**Files:**
- Modify: `src/lib/brand.ts`, `src/lib/admin.ts`

- [ ] **Step 1: Brand budget in `src/lib/brand.ts`**

Add a `budget` key to the existing `brandKeys` object (alongside `submissions`/`applications`/`engaged`):

```ts
  budget: () => ["brand-budget"] as const,
```

Append at the bottom of the file:

```ts
// --- Slice 3: budget (read-only) -------------------------------------------------------------
export type BudgetTxn = {
  id: string; type: "topup" | "debit" | "adjust"; delta: number; balance_after: number;
  source_ref: string | null; description: string | null; created_at: string;
};
export type BrandBudget = { balance: number; enforced: boolean };
export const fetchBrandBudget = () =>
  brandFetch<{ budget: BrandBudget; transactions: BudgetTxn[] }>("/budget");
```

- [ ] **Step 2: Operator budget in `src/lib/admin.ts`**

Add to the `adminKeys` object (read the file first to match its exact shape — `adminKeys` entries are workspace-scoped functions per Slice B2):

```ts
  budget: (workspace: string) => ["admin-budget", workspace] as const,
```

Append at the bottom of `src/lib/admin.ts` (reuse the existing `adminFetch` helper + `wsq`/workspace-query convention already in the file):

```ts
// --- Slice 3: operator budget ---------------------------------------------------------------
import type { BudgetTxn, BrandBudget } from "@/lib/brand";
export const fetchAdminBudget = (workspace: string) =>
  adminFetch<{ budget: BrandBudget; transactions: BudgetTxn[] }>(`/admin/budget?workspace=${encodeURIComponent(workspace)}`);
export const topupAdminBudget = (workspaceId: string, amount: number) =>
  adminFetch<{ balance: number }>("/admin/budget/topup", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId, amount }) });
export const adjustAdminBudget = (workspaceId: string, delta: number, description?: string) =>
  adminFetch<{ balance: number }>("/admin/budget/adjust", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId, delta, description }) });
export const setAdminBudgetEnforcement = (workspaceId: string, enforced: boolean) =>
  adminFetch<{ enforced: boolean }>("/admin/budget/enforcement", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId, enforced }) });
```

> If `src/lib/admin.ts` keeps its `import` statements at the top only, move the `import type { BudgetTxn, BrandBudget }` line up to join the other imports rather than mid-file. Match the file's existing style.

- [ ] **Step 3: Gates**

Run: `npm run type-check && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/brand.ts src/lib/admin.ts
git commit -m "feat(brand): client budget keys, types, fetchers, mutations"
```

---

## Task 6: i18n keys (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add the English keys** (in the `en` block, immediately after the `app.brand.review.notesPlaceholder` line added in Slice 2):

```ts
    "app.brand.navBudget": "Budget",
    "app.brand.budget.title": "Budget",
    "app.brand.budget.balance": "Remaining balance",
    "app.brand.budget.enforced": "Spend cap active",
    "app.brand.budget.unenforced": "No spend cap",
    "app.brand.budget.lowHint": "Ask your operator to top up to keep approving paid missions.",
    "app.brand.budget.ledgerEmpty": "No budget activity yet.",
    "app.admin.budget.tab": "Budget",
    "app.admin.budget.pickWorkspace": "Select a workspace",
    "app.admin.budget.balance": "Balance",
    "app.admin.budget.enforcement": "Spend cap",
    "app.admin.budget.topup": "Top up",
    "app.admin.budget.adjust": "Adjust",
    "app.admin.budget.amount": "Amount",
    "app.admin.budget.reason": "Reason",
    "app.admin.budget.ledgerEmpty": "No budget activity yet.",
```

- [ ] **Step 2: Add the Traditional Chinese keys** (in the `zh` block, immediately after the zh `app.brand.review.notesPlaceholder` line):

```ts
    "app.brand.navBudget": "預算",
    "app.brand.budget.title": "預算",
    "app.brand.budget.balance": "剩餘額度",
    "app.brand.budget.enforced": "已啟用支出上限",
    "app.brand.budget.unenforced": "未設支出上限",
    "app.brand.budget.lowHint": "請聯絡營運人員增值，以繼續批核付費任務。",
    "app.brand.budget.ledgerEmpty": "暫無預算紀錄。",
    "app.admin.budget.tab": "預算",
    "app.admin.budget.pickWorkspace": "選擇 workspace",
    "app.admin.budget.balance": "結餘",
    "app.admin.budget.enforcement": "支出上限",
    "app.admin.budget.topup": "增值",
    "app.admin.budget.adjust": "調整",
    "app.admin.budget.amount": "金額",
    "app.admin.budget.reason": "原因",
    "app.admin.budget.ledgerEmpty": "暫無預算紀錄。",
```

- [ ] **Step 3: Verify parity**

Run: `npm run type-check && npm run test -- src/lib/i18n`
Expected: type-check passes; the i18n parity test passes (en and zh key sets match — 17 keys added to each).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "i18n(brand): budget keys (en + zh)"
```

---

## Task 7: Operator Budget tab UI

**Files:**
- Create: `src/components/admin/AdminBudgetPanel.tsx`
- Modify: the operator `/admin` shell (add a "Budget" tab)

- [ ] **Step 1: Read the `/admin` shell to find the tab pattern**

Read the route that renders the operator dashboard tabs (search: `grep -rln "app.admin" src/routes/admin*.tsx src/routes/operator*.tsx` and the component holding the tab list — likely `src/routes/admin.index.tsx` or an `AdminTabs`/`AdminTopBar` component). Identify (a) how a tab is registered (a key + label + panel), and (b) where the operator's selected workspace comes from. The plan's Step 3 assumes a `workspace` value is available in the admin context; if the shell already exposes a workspace selector/value, reuse it. If NOT, the `AdminBudgetPanel` below renders its own minimal workspace `<input>` (paste a workspace id) so the task is self-contained.

- [ ] **Step 2: Create `src/components/admin/AdminBudgetPanel.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { AdminRequestError } from "@/lib/admin";
import {
  adminKeys, fetchAdminBudget, topupAdminBudget, adjustAdminBudget, setAdminBudgetEnforcement,
} from "@/lib/admin";

export function AdminBudgetPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [ws, setWs] = useState("");
  const [amount, setAmount] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: adminKeys.budget(ws),
    queryFn: () => fetchAdminBudget(ws),
    enabled: ws.length > 0,
    retry: false,
  });
  const onErr = (e: unknown) => window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  const refetch = () => qc.invalidateQueries({ queryKey: adminKeys.budget(ws) });
  const topup = useMutation({ mutationFn: () => topupAdminBudget(ws, Number(amount)), onSuccess: () => { setAmount(""); refetch(); }, onError: onErr });
  const adjust = useMutation({ mutationFn: () => adjustAdminBudget(ws, Number(delta), reason || undefined), onSuccess: () => { setDelta(""); setReason(""); refetch(); }, onError: onErr });
  const toggle = useMutation({ mutationFn: (next: boolean) => setAdminBudgetEnforcement(ws, next), onSuccess: refetch, onError: onErr });

  return (
    <div className="space-y-4">
      <input
        value={ws}
        onChange={(e) => setWs(e.target.value.trim())}
        placeholder={t("app.admin.budget.pickWorkspace")}
        className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm"
      />
      {q.data && (
        <div className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-heading text-lg font-bold">{t("app.admin.budget.balance")}: HK${q.data.budget.balance}</p>
            <label className="flex items-center gap-2 text-sm font-semibold">
              {t("app.admin.budget.enforcement")}
              <input type="checkbox" checked={q.data.budget.enforced} onChange={(e) => toggle.mutate(e.target.checked)} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={t("app.admin.budget.amount")}
              className="h-9 w-32 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <button onClick={() => topup.mutate()} disabled={!amount || topup.isPending}
              className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">
              {t("app.admin.budget.topup")}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" placeholder="±"
              className="h-9 w-24 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("app.admin.budget.reason")}
              className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <button onClick={() => adjust.mutate()} disabled={!delta || adjust.isPending}
              className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">
              {t("app.admin.budget.adjust")}
            </button>
          </div>
          <ul className="space-y-1 border-t-2 border-[var(--color-ink)] pt-2 text-sm">
            {q.data.transactions.length === 0 && <li className="text-[var(--color-soft-ink)]">{t("app.admin.budget.ledgerEmpty")}</li>}
            {q.data.transactions.map((tx) => (
              <li key={tx.id} className="flex justify-between gap-2">
                <span>{tx.type} {tx.description ? `· ${tx.description}` : ""}</span>
                <span className="font-bold">{tx.delta > 0 ? "+" : ""}{tx.delta} → {tx.balance_after}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register a "Budget" tab in the `/admin` shell**

Following the tab pattern you identified in Step 1, add a tab whose label is `t("app.admin.budget.tab")` and whose panel renders `<AdminBudgetPanel />`. (Exact edit depends on the shell; mirror how the existing Missions tab is registered.)

- [ ] **Step 4: Gates**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminBudgetPanel.tsx <the modified shell file>
git commit -m "feat(brand): operator Budget tab (top-up, adjust, enforcement, ledger)"
```

---

## Task 8: Brand budget UI — card, page, nav, review banner

**Files:**
- Create: `src/components/brand/BrandBudgetCard.tsx`, `src/routes/brand.budget.tsx`
- Modify: `src/routes/brand.index.tsx`, `src/components/brand/BrandNav.tsx`, `src/components/brand/BrandReviewSubmissions.tsx`

- [ ] **Step 1: Create `src/components/brand/BrandBudgetCard.tsx`** (the dashboard card + a tiny banner variant)

```tsx
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandBudget } from "@/lib/brand";

function useBudget() {
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.budget(), queryFn: fetchBrandBudget, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);
  return q;
}

export function BrandBudgetCard() {
  const { t } = useI18n();
  const q = useBudget();
  if (!q.data) return null;
  const { balance, enforced } = q.data.budget;
  const low = enforced && balance <= 0;
  return (
    <div className="space-y-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading font-bold">{t("app.brand.budget.balance")}</span>
        <span className="font-display text-xl font-bold">HK${balance}</span>
      </div>
      <p className="text-xs text-[var(--color-soft-ink)]">
        {enforced ? t("app.brand.budget.enforced") : t("app.brand.budget.unenforced")}
      </p>
      {low && <p className="text-xs font-semibold">{t("app.brand.budget.lowHint")}</p>}
    </div>
  );
}

/** Compact one-line balance banner for the review page. */
export function BrandBudgetBanner() {
  const { t } = useI18n();
  const q = useBudget();
  if (!q.data || !q.data.budget.enforced) return null;
  return (
    <p className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
      {t("app.brand.budget.balance")}: HK${q.data.budget.balance}
    </p>
  );
}
```

- [ ] **Step 2: Create `src/routes/brand.budget.tsx`** (ledger page)

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandBudget } from "@/lib/brand";

export const Route = createFileRoute("/brand/budget")({ component: BrandBudget });

function BrandBudget() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.budget(), queryFn: fetchBrandBudget, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <p className="font-display text-2xl font-bold">HK${q.data?.budget.balance ?? 0}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">
          {q.data?.budget.enforced ? t("app.brand.budget.enforced") : t("app.brand.budget.unenforced")}
        </p>
      </div>
      <ul className="space-y-2">
        {(q.data?.transactions.length ?? 0) === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.budget.ledgerEmpty")}</li>
        )}
        {q.data?.transactions.map((tx) => (
          <li key={tx.id} className="flex items-center justify-between gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm">
            <span>{tx.type}{tx.description ? ` · ${tx.description}` : ""}</span>
            <span className="font-bold">{tx.delta > 0 ? "+" : ""}{tx.delta} → {tx.balance_after}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add `BrandBudgetCard` to the dashboard `src/routes/brand.index.tsx`**

Read the file; import `BrandBudgetCard` from `@/components/brand/BrandBudgetCard` and render `<BrandBudgetCard />` near the top of the dashboard content (above the mission summary). Match the surrounding JSX style.

- [ ] **Step 4: Add a Budget nav item to `src/components/brand/BrandNav.tsx`**

Change the lucide import to add `Wallet`:

```ts
import { LayoutDashboard, Target, ClipboardCheck, Wallet } from "lucide-react";
```

Add a 4th `ITEMS` entry:

```ts
  { to: "/brand/budget", exact: false, icon: Wallet, labelKey: "app.brand.navBudget" },
```

- [ ] **Step 5: Add the balance banner to `src/components/brand/BrandReviewSubmissions.tsx`**

Import `BrandBudgetBanner` from `@/components/brand/BrandBudgetCard` and render `<BrandBudgetBanner />` at the very top of the returned list `<div className="space-y-3">` (above the submission cards), so a brand sees its remaining balance while reviewing.

- [ ] **Step 6: Gates** (all UI lands together so `tsr generate` registers `/brand/budget`)

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass; `<Link to="/brand/budget">` resolves after codegen.

- [ ] **Step 7: Commit**

```bash
git add src/components/brand/BrandBudgetCard.tsx src/routes/brand.budget.tsx src/routes/brand.index.tsx src/components/brand/BrandNav.tsx src/components/brand/BrandReviewSubmissions.tsx
git commit -m "feat(brand): budget card, ledger page, nav item, review banner"
```

---

## Task 9: Route-stub test for `/brand/budget`

**Files:**
- Create: `src/routes/-brand.budget.test.tsx`

- [ ] **Step 1: Create `src/routes/-brand.budget.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchBrandBudget: vi.fn(), reportAuthError: vi.fn() }));

vi.mock("@/lib/brand", () => ({
  fetchBrandBudget: h.fetchBrandBudget,
  brandKeys: { budget: () => ["brand-budget"] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({ brand: { workspaceId: "w1" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.budget";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand budget page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders the balance and a ledger row", async () => {
    h.fetchBrandBudget.mockResolvedValue({
      budget: { balance: 120, enforced: true },
      transactions: [{ id: "t1", type: "topup", delta: 120, balance_after: 120, source_ref: null, description: "初始增值", created_at: "2026-06-27" }],
    });
    r();
    await waitFor(() => expect(screen.getByText("HK$120")).toBeInTheDocument());
    expect(screen.getByText(/初始增值/)).toBeInTheDocument();
  });

  it("shows the empty-ledger copy when there are no transactions", async () => {
    h.fetchBrandBudget.mockResolvedValue({ budget: { balance: 0, enforced: false }, transactions: [] });
    r();
    await waitFor(() => expect(screen.getByText("暫無預算紀錄。")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the targeted test**

Run: `npm run test -- src/routes/-brand.budget.test.tsx`
Expected: 2 passing.

- [ ] **Step 3: Full gate (last implementation task)**

Run: `npm run type-check && npm run lint && npm run test && npm run build`
Expected: all green (full unit suite + type-check + lint + build). Ignore the pre-existing `_site.smoke.test.tsx` route-export warning if present.

- [ ] **Step 4: Commit**

```bash
git add src/routes/-brand.budget.test.tsx
git commit -m "test(brand): route-stub test for /brand/budget"
```

---

## Final: holistic review + finish branch

- [ ] Dispatch a final reviewer over the whole branch diff (`git diff feat/brand-portal-slice2...HEAD`), focused on: the `approve_submission` redefinition is byte-for-byte the old behavior PLUS the budget block (no regression to points/cash/XP); the budget check is inside the `v_cash > 0` guard and only acts when `enforced`; the `for update` lock; both approve routes map `insufficient_budget` → 402; brand reads are RLS-scoped and the brand has NO write endpoint; ESM `.js` extensions on server imports.
- [ ] Use superpowers:finishing-a-development-branch to open a PR (base `feat/brand-portal-slice2`, stacked; auto-retargets to main as the stack merges).

**PR deploy checklist:**
- Apply `0024_brand_budget.sql` to prod **before** the deploy, then `notify pgrst, 'reload schema'`.
- No new env vars. Backward-compatible: existing workspaces (no budget row / enforced=false) and the operator approve flow are unchanged — there is no flag-day.
- Merge order: this stack is #46 → #47 → this PR. Merge the lower slices first.
- Post-deploy smoke: as an operator, top up a test workspace + toggle enforcement; as that brand, `GET /api/brand/budget` shows the balance; approve a cash submission and confirm the balance drops by `cash_reward`; with the wallet empty, an approve returns 402.

## Self-review (done by plan author)

- **Spec coverage:** Section 1 (data model + 3 RPCs) → Task 1. Section 2 (operator endpoints, brand endpoint, 402 mapping on both paths) → Tasks 3+4. Section 3 (operator tab, brand card, review banner, /brand/budget page, nav, i18n) → Tasks 6+7+8. Section 4 (8 integration proofs + seed helper + route-stub unit tests + rollout) → Tasks 2+9 + Final. All covered.
- **Type consistency:** `BudgetTxn`/`BrandBudget` defined in `src/lib/brand.ts` (Task 5) and imported by `src/lib/admin.ts` (Task 5) and the UI (Tasks 7/8). `brandKeys.budget()` / `adminKeys.budget(workspace)` used consistently. RPC names (`credit_workspace_budget`, `set_workspace_budget_enforcement`, `approve_submission`) and the `insufficient_budget` / `negative_balance` raise-strings match between the migration, the routes, and the tests.
- **No placeholders:** every code step shows complete code; the two "read the shell / dashboard first" steps (Tasks 7 Step 1/3, Task 8 Step 3) are genuine integration points where the exact edit depends on existing files — each gives the concrete component to render and the pattern to follow, not a TODO.
