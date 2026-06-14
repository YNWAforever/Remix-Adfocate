# Slice 5 — Wallet & Redemption Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make points *spendable* (redeem a gift → instantly receive a pre-loaded code) and cash *visible* (a read-only earnings wallet where a mission's `cash_reward` accrues on approval).

**Architecture:** Strictly additive on the live Slice-4 foundation. Two new SECURITY-DEFINER subsystems mirroring the existing points ledger: **redemption** (`redemption_codes` pool + `redemptions` ledger + `redeem_gift` RPC that atomically deducts points, claims a code, decrements stock) and **earnings** (`earnings_balances` + `earnings_transactions`, credited by extending the Slice-4 `approve_submission` RPC). RLS is self-scoped SELECT only; all writes go through RPCs / the service client. The code pool table gets **no** `authenticated` grant (codes are secret until issued).

**Tech Stack:** Supabase Postgres (plpgsql SECURITY DEFINER RPCs, RLS), Hono API on Vercel, React 19 + TanStack Router (typed file-based routes) + TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-adfocate-slice5-wallet-redemption-writes-design.md` (commit `1838d16`).

**Note on migration split:** the spec named one migration `0006_redemption_earnings.sql`. This plan splits it into **`0006_redemption.sql`** (Phase A) and **`0007_earnings.sql`** (Phase B) so each phase is a self-contained, reviewable commit — exactly the "two committable phases" the spec's §12 asks for. Both apply together on `supabase db reset`, so the test workflow is unchanged.

---

## File Structure

**Phase A — Redemption**
- Create `supabase/migrations/0006_redemption.sql` — `redemption_codes` + `redemptions` tables, RLS, grants, `redeem_gift` RPC.
- Modify `server/test/helpers.ts` — add `makeGift`, `addCodes`; extend `cleanup` for redemption tables.
- Modify `server/routes/redemption.ts` — add `rpcError` mapper, `POST /redeem`, `GET /history`.
- Modify `server/routes/admin.ts` — add `POST /gifts/:id/codes`.
- Create `server/test/redemption.test.ts` — redeem + history + add-codes integration tests.
- Modify `package.json` — register the new integration test files.
- Modify `src/lib/queries/kocmax.ts` — `useRedeemGift`, `useRedemptions` + types.
- Modify `src/components/RewardCard.tsx` — optional `footer` slot.
- Create `src/components/RedeemGiftCard.tsx` — card + confirm dialog + code reveal.
- Create `src/components/RedeemGiftCard.test.tsx`.
- Modify `src/routes/_app.redemption.tsx` — becomes a thin `<Outlet/>` layout.
- Create `src/routes/_app.redemption.index.tsx` — the gift grid (moved from the old redemption route) + a link to history.
- Create `src/routes/_app.redemption.history.tsx` — redemption history page (`/redemption/history`).
- Create `src/routes/-_app.redemption.history.test.tsx`.
- Create `src/lib/queries/redemption-earnings.test.tsx` — hook URL/queryKey tests.

**Phase B — Earnings**
- Create `supabase/migrations/0007_earnings.sql` — `earnings_balances` + `earnings_transactions`, RLS, grants, backfill, `approve_submission` cash extension.
- Modify `server/test/helpers.ts` — `makeCreator` seeds `earnings_balances`; `makeMission` accepts `cash_reward`; `cleanup` covers earnings tables.
- Modify `server/routes/me.ts` — `/bootstrap` upserts an `earnings_balances` row.
- Modify `server/routes/wallet.ts` — `GET /earnings`, `GET /earnings/history`.
- Create `server/test/wallet.test.ts` — earnings accrual + pending + history integration tests.
- Modify `src/lib/queries/kocmax.ts` — `useEarnings`, `useEarningsHistory` + types.
- Modify `src/routes/_app.wallet.tsx` — earnings section.
- Create `src/routes/-_app.wallet.test.tsx`.
- Modify `supabase/seed.sql` — a `cash_reward` demo mission + a small demo code pool.

---

# PHASE A — REDEMPTION

### Task 1: Migration — redemption tables + `redeem_gift` RPC

**Files:**
- Create: `supabase/migrations/0006_redemption.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_redemption.sql`:

```sql
-- Slice 5A: redemption — a per-gift code pool + a redemptions ledger + the atomic
-- redeem_gift RPC (deduct points, claim a code, decrement stock). Mirrors the
-- Slice-4 RPC pattern. New tables get NO grants under auto_expose_new_tables=false,
-- so grants are explicit (and the code pool deliberately gets none for authenticated).

-- 1. Per-gift code pool. RLS on with NO select policy → never client-readable;
--    only the redeem_gift RPC (SECURITY DEFINER) + service_role touch it.
create table public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  gift_id      uuid not null references public.redemption_gifts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  code   text not null,
  status text not null default 'available' check (status in ('available','issued')),
  issued_to uuid references public.creators(id),
  issued_at timestamptz,
  created_at timestamptz not null default now()
);
create index redemption_codes_pool_idx on public.redemption_codes (gift_id, status);

-- 2. One row per redemption.
create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  gift_id uuid not null references public.redemption_gifts(id),
  code_id uuid references public.redemption_codes(id),
  code    text,                 -- denormalised issued code for display/history
  points_spent integer not null,
  status  text not null default 'fulfilled' check (status in ('fulfilled','cancelled')),
  created_at timestamptz not null default now()
);
create index redemptions_creator_idx on public.redemptions (creator_id);

-- 3. RLS: a creator sees only their own redemptions. All writes via RPC/service.
alter table public.redemption_codes enable row level security;  -- no select policy (pool hidden)
alter table public.redemptions      enable row level security;
create policy redemptions_self on public.redemptions for select using (creator_id = auth.uid());

-- 4. Grants. redemption_codes gets NO authenticated grant — codes are secret until issued.
grant select on public.redemptions to authenticated;
grant all on public.redemption_codes, public.redemptions to service_role;

-- 5. redeem_gift: validate gift + stock + balance, atomically claim one code,
--    deduct points (+ ledger), decrement stock, record the redemption.
create or replace function public.redeem_gift(p_gift uuid)
returns public.redemptions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  g record;
  v_code_id uuid;
  v_code text;
  v_bal int;
  v_red public.redemptions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id into v_ws from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  -- Lock the gift row to serialise concurrent redeems of the same gift.
  select id, workspace_id, status, points_cost, stock_remaining, valid_from, valid_to, name
    into g from public.redemption_gifts where id = p_gift for update;
  if g.id is null or g.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if g.status <> 'available' then raise exception 'closed'; end if;
  if g.valid_from is not null and g.valid_from > current_date then raise exception 'closed'; end if;
  if g.valid_to   is not null and g.valid_to   < current_date then raise exception 'closed'; end if;
  if g.stock_remaining <= 0 then raise exception 'out_of_stock'; end if;

  select balance into v_bal from public.point_balances
    where creator_id = v_creator and workspace_id = v_ws;
  if v_bal is null or v_bal < g.points_cost then raise exception 'insufficient_points'; end if;

  -- Atomic claim of one available code from the pool.
  update public.redemption_codes set status = 'issued', issued_to = v_creator, issued_at = now()
    where id = (
      select id from public.redemption_codes
      where gift_id = p_gift and status = 'available'
      limit 1 for update skip locked
    )
    returning id, code into v_code_id, v_code;
  if v_code_id is null then raise exception 'out_of_stock'; end if;

  -- Deduct points + write the ledger row.
  update public.point_balances set balance = balance - g.points_cost, updated_at = now()
    where creator_id = v_creator and workspace_id = v_ws
    returning balance into v_bal;
  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (v_creator, v_ws, 'redeem', -g.points_cost, v_bal,
            'redemption:' || p_gift, g.name);

  -- Decrement stock + record the redemption.
  update public.redemption_gifts set stock_remaining = stock_remaining - 1 where id = p_gift;
  insert into public.redemptions
    (creator_id, workspace_id, gift_id, code_id, code, points_spent, status)
    values (v_creator, v_ws, p_gift, v_code_id, v_code, g.points_cost, 'fulfilled')
    returning * into v_red;
  return v_red;
end;
$$;

-- 6. Execute grants: KOCs may redeem (auth.uid); service role too.
revoke all on function public.redeem_gift(uuid) from public, anon;
grant execute on function public.redeem_gift(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply the migration to the local stack and verify it succeeds**

Run: `cd "/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2" && supabase db reset`
Expected: output lists `Applying migration 0006_redemption.sql...` and finishes with `Finished supabase db reset` (no SQL error). If the local stack is not running, start it first per the project convention: `supabase start -x vector -x logflare -x studio -x edge-runtime -x imgproxy -x inbucket`.

- [ ] **Step 3: Smoke-verify the objects exist**

Run: `supabase db reset >/dev/null 2>&1; psql "$(supabase status -o env 2>/dev/null | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "select to_regclass('public.redemption_codes'), to_regclass('public.redemptions'), proname from pg_proc where proname='redeem_gift';"`
Expected: both `to_regclass` values are non-null and a `redeem_gift` row is returned. (If `psql`/`DB_URL` resolution differs in your environment, equivalently confirm via the Supabase MCP `list_tables`/`execute_sql` against the local project, or simply rely on Task 3's integration test, which fails loudly if the objects are missing.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_redemption.sql
git commit -m "feat(slice5): redemption tables + redeem_gift RPC (migration 0006)"
```

---

### Task 2: Test helpers — `makeGift`, `addCodes`, redemption cleanup

**Files:**
- Modify: `server/test/helpers.ts`

- [ ] **Step 1: Add the `makeGift` and `addCodes` seeders**

In `server/test/helpers.ts`, add after the `makeMission` function (before `cleanup`):

```ts
/** Seed a redeemable gift in DEMO_WS. Name MUST start with "test-" so cleanup()
 *  removes it. Stock starts at 0; load codes with addCodes() (which bumps stock). */
export async function makeGift(opts: {
  name: string;
  points_cost?: number;
  status?: string;
  valid_from?: string | null;
  valid_to?: string | null;
}) {
  const { data, error } = await service()
    .from("redemption_gifts")
    .insert({
      workspace_id: DEMO_WS,
      name: opts.name,
      points_cost: opts.points_cost ?? 100,
      stock_qty: 0,
      stock_remaining: 0,
      gift_type: "voucher",
      status: opts.status ?? "available",
      valid_from: opts.valid_from ?? null,
      valid_to: opts.valid_to ?? null,
    })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as { id: string; name: string };
}

/** Load a code pool for a gift and bump its stock_remaining in lockstep. */
export async function addCodes(giftId: string, codes: string[]) {
  const rows = codes.map((code) => ({ gift_id: giftId, workspace_id: DEMO_WS, code }));
  const { error } = await service().from("redemption_codes").insert(rows);
  if (error) throw error;
  const { data: g } = await service().from("redemption_gifts").select("stock_remaining").eq("id", giftId).single();
  await service()
    .from("redemption_gifts")
    .update({ stock_remaining: (g?.stock_remaining ?? 0) + codes.length })
    .eq("id", giftId);
}
```

- [ ] **Step 2: Extend `cleanup` to remove redemption rows + test gifts**

In `server/test/helpers.ts`, replace the entire `cleanup` function with:

```ts
export async function cleanup() {
  // Test creators (delete cascades their mission_submissions).
  const byEmail = await service().from("creators").select("id").like("display_name", "%@test.local");
  const byPhone = await service().from("creators").select("id").like("phone", "+1555%");
  const ids = [...new Set([...(byEmail.data ?? []), ...(byPhone.data ?? [])].map((r) => r.id))];
  for (const id of ids) {
    await service().from("redemptions").delete().eq("creator_id", id);
    await service().from("point_transactions").delete().eq("creator_id", id);
    await service().from("point_balances").delete().eq("creator_id", id);
    await service().from("creators").delete().eq("id", id);
    await service().auth.admin.deleteUser(id);
  }
  // Test missions (slug "test-%") and any leftover submissions on them.
  const testMissions = await service().from("missions").select("id").like("slug", "test-%");
  for (const m of testMissions.data ?? []) {
    await service().from("mission_submissions").delete().eq("mission_id", m.id);
    await service().from("missions").delete().eq("id", m.id);
  }
  // Test gifts (name "test-%") with their codes + redemptions.
  const testGifts = await service().from("redemption_gifts").select("id").like("name", "test-%");
  for (const g of testGifts.data ?? []) {
    await service().from("redemptions").delete().eq("gift_id", g.id);
    await service().from("redemption_codes").delete().eq("gift_id", g.id);
    await service().from("redemption_gifts").delete().eq("id", g.id);
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers.ts
git commit -m "test(slice5): makeGift + addCodes seeders, redemption cleanup"
```

---

### Task 3: Redeem route + integration tests

**Files:**
- Modify: `server/routes/redemption.ts`
- Modify: `server/routes/admin.ts`
- Modify: `package.json`
- Test: `server/test/redemption.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/redemption.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeGift, addCodes, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

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
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("redemption", () => {
  let koc: { userId: string; jwt: string };
  let gift: { id: string; name: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("redeem@test.local", 500);
    gift = await makeGift({ name: "test-gift-redeem", points_cost: 200 });
    await addCodes(gift.id, ["CODE-A", "CODE-B"]);
  });
  afterAll(cleanup);

  it("redeems a gift: returns a code, deducts points, records a redemption", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["CODE-A", "CODE-B"]).toContain(body.code);
    expect(body.points_spent).toBe(200);
    expect(body.status).toBe("fulfilled");

    const bal = await req("/wallet/points", koc.jwt);
    expect((await bal.json()).balance).toBe(300); // 500 - 200

    const hist = await req("/redemption/history", koc.jwt);
    const { redemptions } = await hist.json();
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].redemption_gifts.name).toBe("test-gift-redeem");
  });

  it("a second redeem claims a DISTINCT code", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(200);
    const hist = await req("/redemption/history", koc.jwt);
    const codes = (await hist.json()).redemptions.map((r: { code: string }) => r.code);
    expect(new Set(codes).size).toBe(2);
    expect(codes).toContain("CODE-A");
    expect(codes).toContain("CODE-B");
  });

  it("rejects redeem when the pool is empty (out_of_stock)", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("out_of_stock");
  });

  it("rejects redeem with insufficient points", async () => {
    const poor = await makeCreator("poor@test.local", 50);
    const g2 = await makeGift({ name: "test-gift-pricey", points_cost: 1000 });
    await addCodes(g2.id, ["PRICEY-1"]);
    const res = await req("/redemption/redeem", poor.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: g2.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("insufficient_points");
  });

  it("404s an unknown gift id", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: "00000000-0000-0000-0000-0000000000ff" }),
    });
    expect(res.status).toBe(404);
  });
});

suite("admin add-codes", () => {
  let gift: { id: string; name: string };
  beforeAll(async () => {
    await cleanup();
    gift = await makeGift({ name: "test-gift-pool", points_cost: 100 });
  });
  afterAll(cleanup);

  it("loads a code pool and bumps stock so a KOC can redeem", async () => {
    const res = await adminreq(`/admin/gifts/${gift.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["X1", "X2", "X3"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).added).toBe(3);

    const koc = await makeCreator("pool@test.local", 500);
    const r = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(r.status).toBe(200);
  });

  it("rejects add-codes without the admin secret", async () => {
    const res = await adminreq(`/admin/gifts/${gift.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["Y1"] }),
    }, "");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Register the new test file in the integration script**

In `package.json`, change the `test:integration` script to append `server/test/redemption.test.ts`:

```json
"test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/redemption.test.ts",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration -- server/test/redemption.test.ts`
Expected: FAIL — the `/redemption/redeem`, `/redemption/history`, and `/admin/gifts/:id/codes` routes don't exist yet (404s / assertion failures).

- [ ] **Step 4: Implement the redeem + history routes**

Replace the entire contents of `server/routes/redemption.ts` with:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import type { PostgrestError } from "@supabase/supabase-js";

export const redemptionRoutes = new Hono<Env>();

// RPC raise-messages double as stable codes. Map them to HTTP; anything else is a 500.
const RPC_409 = new Set([
  "insufficient_points", "out_of_stock", "closed", "not_authenticated",
]);
function rpcError(c: Context<Env>, error: PostgrestError) {
  const msg = error.message ?? "";
  if (msg === "not_found") return c.json({ error: msg, code: msg }, 404);
  if (RPC_409.has(msg)) return c.json({ error: msg, code: msg }, 409);
  return c.json({ error: msg || "rpc error", code: "db_error" }, 500);
}

redemptionRoutes.get("/gifts", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("redemption_gifts")
    .select("id, name, description, category, points_cost, stock_remaining, gift_type, image_url, status")
    .eq("workspace_id", c.get("workspaceId"))
    .order("points_cost", { ascending: true });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ gifts: data });
});

/** Redeem a gift → atomic point deduction + code claim. Returns the redemption (incl. code). */
redemptionRoutes.post("/redeem", async (c) => {
  const { gift_id } = await c.req.json<{ gift_id?: string }>().catch(() => ({ gift_id: undefined }));
  if (!gift_id) return c.json({ error: "gift_id required", code: "bad_request" }, 400);
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase.rpc("redeem_gift", { p_gift: gift_id });
  if (error) return rpcError(c, error);
  return c.json(data);
});

/** The caller's redemption history (joined to the gift name). */
redemptionRoutes.get("/history", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("redemptions")
    .select("id, code, points_spent, status, created_at, redemption_gifts(name)")
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ redemptions: data ?? [] });
});
```

- [ ] **Step 5: Implement the admin add-codes route**

In `server/routes/admin.ts`, add this route at the end of the file (after the `reject` route). The file already imports `serviceClient`:

```ts
adminRoutes.post("/gifts/:id/codes", async (c) => {
  const body = await c.req.json<{ codes?: string[] }>().catch(() => ({} as { codes?: string[] }));
  const codes = (body.codes ?? []).map((s) => s.trim()).filter(Boolean);
  if (codes.length === 0) return c.json({ error: "no codes", code: "empty_codes" }, 400);
  const giftId = c.req.param("id");
  const svc = serviceClient();

  const { data: g, error: gErr } = await svc
    .from("redemption_gifts")
    .select("id, workspace_id, stock_remaining")
    .eq("id", giftId)
    .maybeSingle();
  if (gErr) return c.json({ error: gErr.message, code: "db_error" }, 500);
  if (!g) return c.json({ error: "not_found", code: "not_found" }, 404);

  const rows = codes.map((code) => ({ gift_id: giftId, workspace_id: g.workspace_id, code }));
  const { error: insErr } = await svc.from("redemption_codes").insert(rows);
  if (insErr) return c.json({ error: insErr.message, code: "db_error" }, 500);

  // Bump stock by the batch size (single operator → no contention on this read-modify-write).
  await svc
    .from("redemption_gifts")
    .update({ stock_remaining: (g.stock_remaining ?? 0) + codes.length })
    .eq("id", giftId);
  return c.json({ added: codes.length });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:integration -- server/test/redemption.test.ts`
Expected: PASS — all `redemption` and `admin add-codes` tests green.

- [ ] **Step 7: Commit**

```bash
git add server/routes/redemption.ts server/routes/admin.ts server/test/redemption.test.ts package.json
git commit -m "feat(slice5): redeem + redemption history + admin add-codes routes"
```

---

### Task 4: Frontend queries — `useRedeemGift`, `useRedemptions`

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Test: `src/lib/queries/redemption-earnings.test.tsx`

- [ ] **Step 1: Write the failing hook test**

Create `src/lib/queries/redemption-earnings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { useRedemptions } from "./kocmax";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useRedemptions", () => {
  it("fetches the caller's redemption history", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ redemptions: [{ id: "r1" }] });
    const { result } = renderHook(() => useRedemptions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/redemption/history");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/queries/redemption-earnings.test.tsx`
Expected: FAIL — `useRedemptions` is not exported from `./kocmax`.

- [ ] **Step 3: Add the types + hooks**

In `src/lib/queries/kocmax.ts`, add at the end of the file:

```ts
/** The raw redeem_gift RPC result (the redemptions row, incl. the issued code). */
export type RedeemResult = {
  id: string;
  gift_id: string;
  code: string | null;
  points_spent: number;
  status: string;
  created_at: string;
};
/** A redemption history row (gift name embedded). */
export type RedemptionHistoryItem = {
  id: string;
  code: string | null;
  points_spent: number;
  status: string;
  created_at: string;
  redemption_gifts: { name: string } | null;
};

export function useRedeemGift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (giftId: string) =>
      apiFetch<RedeemResult>("/redemption/redeem", { method: "POST", body: JSON.stringify({ gift_id: giftId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gifts"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["redemptions"] });
      qc.invalidateQueries({ queryKey: ["history"] }); // points ledger gains a 'redeem' row
    },
  });
}

export function useRedemptions() {
  return useQuery({
    queryKey: ["redemptions"],
    queryFn: async () => (await apiFetch<{ redemptions: RedemptionHistoryItem[] }>("/redemption/history")).redemptions,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/queries/redemption-earnings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/queries/redemption-earnings.test.tsx
git commit -m "feat(slice5): useRedeemGift + useRedemptions query hooks"
```

---

### Task 5: Redemption UI — code-reveal card

**Files:**
- Modify: `src/components/RewardCard.tsx`
- Create: `src/components/RedeemGiftCard.tsx`
- Test: `src/components/RedeemGiftCard.test.tsx`

- [ ] **Step 1: Add an optional `footer` slot to `RewardCard`**

Replace the entire contents of `src/components/RewardCard.tsx` with:

```tsx
import { Star } from "lucide-react";

export function RewardCard({
  name,
  pointsCost,
  stockRemaining,
  imageUrl,
  footer,
}: {
  name: string;
  pointsCost: number;
  stockRemaining: number;
  imageUrl?: string;
  footer?: React.ReactNode;
}) {
  const soldOut = stockRemaining <= 0;
  return (
    <article className="pastel-card relative flex flex-col overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-0">
      <div className="relative h-32 w-full border-b-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center bg-black/55 font-heading font-bold text-white">已換罄</span>
        )}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 font-heading font-semibold">{name}</h3>
        <p className="mt-1 flex items-center gap-1 font-bold text-[var(--color-ink)]">
          <Star size={14} className="text-[var(--color-magenta)]" aria-hidden /> {pointsCost} 積分
        </p>
        {footer}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Write the failing component test**

Create `src/components/RedeemGiftCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
const hoisted = vi.hoisted(() => ({ state: { isPending: false, isError: false } }));
vi.mock("@/lib/queries/kocmax", () => ({ useRedeemGift: () => ({ mutate, ...hoisted.state }) }));

import { RedeemGiftCard } from "./RedeemGiftCard";

const gift = {
  id: "g1", name: "咖啡券", points_cost: 200, stock_remaining: 5,
  gift_type: "voucher", status: "available",
} as never;

describe("RedeemGiftCard", () => {
  it("disables redeem when the balance is insufficient", () => {
    render(<RedeemGiftCard gift={gift} balance={100} />);
    expect(screen.getByRole("button", { name: "積分不足" })).toBeDisabled();
  });

  it("reveals the issued code after a successful redeem", () => {
    mutate.mockImplementation((_id: string, opts: { onSuccess: (r: { code: string }) => void }) =>
      opts.onSuccess({ code: "CODE-XYZ" }),
    );
    render(<RedeemGiftCard gift={gift} balance={500} />);
    fireEvent.click(screen.getByRole("button", { name: "兌換" }));
    fireEvent.click(screen.getByRole("button", { name: "確認" }));
    expect(screen.getByText("CODE-XYZ")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/RedeemGiftCard.test.tsx`
Expected: FAIL — `./RedeemGiftCard` does not exist.

- [ ] **Step 4: Implement `RedeemGiftCard`**

Create `src/components/RedeemGiftCard.tsx`:

```tsx
import { useState } from "react";
import { RewardCard } from "./RewardCard";
import { useRedeemGift, type Gift } from "@/lib/queries/kocmax";

export function RedeemGiftCard({ gift, balance }: { gift: Gift; balance: number }) {
  const redeem = useRedeemGift();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const soldOut = gift.stock_remaining <= 0;
  const poor = balance < gift.points_cost;
  const disabled = soldOut || poor;

  function confirm() {
    redeem.mutate(gift.id, { onSuccess: (r) => setCode(r.code) });
  }

  return (
    <>
      <RewardCard
        name={gift.name}
        pointsCost={gift.points_cost}
        stockRemaining={gift.stock_remaining}
        imageUrl={gift.image_url}
        footer={
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setCode(null); setOpen(true); }}
            className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 font-heading text-sm font-bold text-white disabled:opacity-40"
          >
            {soldOut ? "已換罄" : poor ? "積分不足" : "兌換"}
          </button>
        }
      />
      {open && (
        <div
          role="dialog"
          aria-label="兌換"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {code === null ? (
              <>
                <h2 className="font-display text-lg font-bold">確認兌換</h2>
                <p className="mt-2 text-sm">用 {gift.points_cost} 積分兌換「{gift.name}」？</p>
                {redeem.isError && <p className="mt-2 text-sm text-[var(--color-magenta)]">兌換失敗，請再試</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={redeem.isPending}
                    onClick={confirm}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-2 font-heading text-sm font-bold text-white disabled:opacity-40"
                  >
                    {redeem.isPending ? "處理中…" : "確認"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold">兌換成功 🎉</h2>
                <p className="mt-2 text-sm">你的兌換碼：</p>
                <p className="mt-1 select-all rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] bg-[var(--color-muted,#F4F4F4)] p-3 text-center font-mono text-lg font-bold">
                  {code}
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(code)}
                  className="mt-3 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                >
                  複製兌換碼
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold text-white"
                >
                  完成
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/RedeemGiftCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RewardCard.tsx src/components/RedeemGiftCard.tsx src/components/RedeemGiftCard.test.tsx
git commit -m "feat(slice5): RedeemGiftCard with confirm dialog + code reveal"
```

---

### Task 6: Redemption page split (layout + index) + history page

**Files:**
- Modify: `src/routes/_app.redemption.tsx` (→ thin layout)
- Create: `src/routes/_app.redemption.index.tsx` (gift grid + history link)
- Create: `src/routes/_app.redemption.history.tsx`
- Test: `src/routes/-_app.redemption.history.test.tsx`

> **Why the split:** TanStack file-based routing treats `_app.redemption.tsx` as the parent of `_app.redemption.history.tsx`. For the child to render, the parent must become a layout that renders `<Outlet/>`, and the `/redemption` page content moves to `_app.redemption.index.tsx`.

- [ ] **Step 1: Convert `_app.redemption.tsx` into a thin layout**

Replace the entire contents of `src/routes/_app.redemption.tsx` with:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/redemption")({ component: () => <Outlet /> });
```

- [ ] **Step 2: Create the gift-grid index route**

Create `src/routes/_app.redemption.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useGifts, useBalance } from "@/lib/queries/kocmax";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { FilterPills } from "@/components/FilterPills";
import { RedeemGiftCard } from "@/components/RedeemGiftCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/redemption/")({ component: Redemption });

const CATEGORIES = ["全部", "美容", "餐飲", "娛樂", "生活", "電子", "健康", "時尚"] as const;

function Redemption() {
  const [category, setCategory] = useState<string>("全部");
  const balance = useBalance();
  const gifts = useGifts(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">積分兌換</h1>
        <Link to="/redemption/history" className="text-sm font-bold text-[var(--color-magenta)]">兌換記錄</Link>
      </div>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {gifts.isLoading && (
        <div className="grid grid-cols-2 gap-3">
          <SkeletonCard className="h-48" />
          <SkeletonCard className="h-48" />
        </div>
      )}
      {gifts.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
      {!gifts.isLoading && !gifts.isError && gifts.data?.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">此分類暫無獎賞</p>
      )}
      {!gifts.isLoading && !gifts.isError && (gifts.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {gifts.data!.map((g) => (
            <RedeemGiftCard key={g.id} gift={g} balance={balance.data?.balance ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the failing history-page test**

Create `src/routes/-_app.redemption.history.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useRedemptions: () => ({
    data: [
      { id: "r1", code: "CODE-A", points_spent: 200, status: "fulfilled", created_at: "2026-06-14T00:00:00Z", redemption_gifts: { name: "咖啡券" } },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { Route } from "./_app.redemption.history";

function renderHistory() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Redemption history", () => {
  it("lists past redemptions with their code", () => {
    renderHistory();
    expect(screen.getByText("咖啡券")).toBeInTheDocument();
    expect(screen.getByText("兌換碼：CODE-A")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.redemption.history.test.tsx`
Expected: FAIL — `./_app.redemption.history` does not exist.

- [ ] **Step 5: Implement the history route**

Create `src/routes/_app.redemption.history.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRedemptions } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/redemption/history")({ component: RedemptionHistory });

function RedemptionHistory() {
  const q = useRedemptions();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">兌換記錄</h1>
        <Link to="/redemption" className="text-sm font-bold text-[var(--color-magenta)]">返回兌換</Link>
      </div>
      {q.isLoading && <SkeletonCard className="h-24" />}
      {q.isError && <p className="text-sm text-[var(--color-magenta)]">記錄載入失敗</p>}
      <ul className="space-y-2">
        {q.data?.map((r) => (
          <li key={r.id} className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="font-heading font-semibold">{r.redemption_gifts?.name ?? "獎賞"}</p>
              <span className="font-display font-bold text-[var(--color-magenta)]">-{r.points_spent}</span>
            </div>
            <p className="mt-1 font-mono text-sm">兌換碼：{r.code ?? "—"}</p>
            <p className="text-xs text-[var(--color-soft-ink)]">{r.created_at.slice(0, 10)}</p>
          </li>
        ))}
        {!q.isLoading && !q.isError && q.data?.length === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">暫無兌換記錄</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Run the history test + regenerate the typed route tree + build**

Run: `npx vitest run src/routes/-_app.redemption.history.test.tsx && npm run type-check`
Expected: the test PASSES, and `type-check` (which runs `tsr generate` first) regenerates `src/routeTree.gen.ts` with the new `/redemption/`, `/redemption/history` routes and reports no type errors. The `<Link to="/redemption/history">` and `<Link to="/redemption">` references must type-check against the regenerated tree.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_app.redemption.tsx src/routes/_app.redemption.index.tsx src/routes/_app.redemption.history.tsx src/routes/-_app.redemption.history.test.tsx src/routeTree.gen.ts
git commit -m "feat(slice5): redemption page split + history page"
```

---

### Task 7: Phase A green gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS (all component/hook suites; integration suites skip without `RUN_INTEGRATION`).

- [ ] **Step 2: Run lint + build**

Run: `npm run lint && npm run build`
Expected: both PASS (`build` runs `tsr generate && tsc --noEmit && vite build`).

- [ ] **Step 3: Run the redemption integration tests**

Run: `npm run test:integration -- server/test/redemption.test.ts`
Expected: PASS.

(No commit — verification only. Phase A is complete.)

---

# PHASE B — EARNINGS

### Task 8: Migration — earnings tables + `approve_submission` cash extension

**Files:**
- Create: `supabase/migrations/0007_earnings.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_earnings.sql`:

```sql
-- Slice 5B: cash earnings — a read-only HKD wallet that accrues a mission's
-- cash_reward on approval. Mirrors point_balances / point_transactions (numeric
-- decimals). approve_submission is extended to credit cash; idempotency is the
-- existing status guard (a submission only leaves 'submitted' once).

-- 1. Tables ------------------------------------------------------------------
create table public.earnings_balances (
  id uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  available numeric(10,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (creator_id, workspace_id)
);
create table public.earnings_transactions (
  id uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  type text not null check (type in ('earn','adjust')),
  amount        numeric(10,2) not null,
  balance_after numeric(10,2) not null,
  source_ref text,
  description text,
  created_at timestamptz not null default now()
);
create index earnings_tx_creator_idx on public.earnings_transactions (creator_id);

-- 2. RLS: self-scoped reads; ALL writes via the SECURITY DEFINER RPCs.
alter table public.earnings_balances     enable row level security;
alter table public.earnings_transactions enable row level security;
create policy earnings_bal_self on public.earnings_balances     for select using (creator_id = auth.uid());
create policy earnings_tx_self  on public.earnings_transactions for select using (creator_id = auth.uid());

-- 3. Grants (auto_expose_new_tables=false → explicit).
grant select on public.earnings_balances, public.earnings_transactions to authenticated;
grant all    on public.earnings_balances, public.earnings_transactions to service_role;

-- 4. Backfill an earnings row for every existing creator, so approval-time cash
--    credit always has a target (the bootstrap upsert covers creators going forward).
insert into public.earnings_balances (creator_id, workspace_id)
  select id, workspace_id from public.creators
  on conflict (creator_id, workspace_id) do nothing;

-- 5. approve_submission: Slice-4 body + cash accrual. (create-or-replace; this
--    redefinition supersedes the one in 0005.)
create or replace function public.approve_submission(p_submission uuid, p_notes text)
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
begin
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

  -- Slice 5: accrue the mission's cash_reward (if any) to the earnings wallet.
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

  update public.mission_submissions set
    status = 'approved', reviewed_at = now(), reviewer_notes = p_notes,
    points_awarded = v_points, xp_awarded = xp_awarded + 100
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 100 where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- approve_submission keeps the Slice-4 execute grants (service_role only) — the
-- revoke/grant from 0005 still applies to this same signature.
```

- [ ] **Step 2: Apply the migration and verify it succeeds**

Run: `cd "/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2" && supabase db reset`
Expected: lists `Applying migration 0006_redemption.sql...` then `Applying migration 0007_earnings.sql...` and finishes without a SQL error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_earnings.sql
git commit -m "feat(slice5): earnings tables + approve_submission cash credit (migration 0007)"
```

---

### Task 9: Test helpers + bootstrap — seed earnings, `cash_reward` missions

**Files:**
- Modify: `server/test/helpers.ts`
- Modify: `server/routes/me.ts`

- [ ] **Step 1: Seed an `earnings_balances` row in `makeCreator`**

In `server/test/helpers.ts`, inside `makeCreator`, add the earnings insert right after the `point_balances` insert (so cash credit on approval has a target).

Find:
```ts
  await service().from("creators").insert({ id: userId, workspace_id: DEMO_WS, display_name: email });
  await service().from("point_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, balance });
```
Replace with:
```ts
  await service().from("creators").insert({ id: userId, workspace_id: DEMO_WS, display_name: email });
  await service().from("point_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, balance });
  await service().from("earnings_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, available: 0 });
```

- [ ] **Step 2: Add a `cash_reward` option to `makeMission`**

In `server/test/helpers.ts`, in the `makeMission` options type add `cash_reward?: number;`, and in the `.insert({...})` add `cash_reward: opts.cash_reward ?? null,`.

The options type becomes:
```ts
export async function makeMission(opts: {
  slug: string;
  title?: string;
  mission_type?: string;
  access_type?: "open" | "application";
  points_reward?: number;
  cash_reward?: number;
  quota?: number;
  filled?: number;
  status?: string;
  required_level?: string;
  deadline?: string | null;
  category?: string;
}) {
```
and the insert gains the `cash_reward` line:
```ts
      points_reward: opts.points_reward ?? 100,
      cash_reward: opts.cash_reward ?? null,
```

- [ ] **Step 3: Delete earnings rows in `cleanup`**

In `server/test/helpers.ts`, in the per-creator loop inside `cleanup`, add the two earnings deletes (before the `point_transactions` delete).

Find:
```ts
    await service().from("redemptions").delete().eq("creator_id", id);
    await service().from("point_transactions").delete().eq("creator_id", id);
```
Replace with:
```ts
    await service().from("redemptions").delete().eq("creator_id", id);
    await service().from("earnings_transactions").delete().eq("creator_id", id);
    await service().from("earnings_balances").delete().eq("creator_id", id);
    await service().from("point_transactions").delete().eq("creator_id", id);
```

- [ ] **Step 4: Bootstrap an `earnings_balances` row on first login**

In `server/routes/me.ts`, in `meBootstrap`, add an earnings upsert right after the `point_balances` upsert.

Find:
```ts
  await svc.from("point_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, balance: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );
```
Add immediately after:
```ts
  await svc.from("earnings_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, available: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );
```

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/test/helpers.ts server/routes/me.ts
git commit -m "test(slice5): seed earnings_balances + cash_reward missions; bootstrap earnings row"
```

---

### Task 10: Earnings endpoints + integration tests

**Files:**
- Modify: `server/routes/wallet.ts`
- Modify: `package.json`
- Test: `server/test/wallet.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/wallet.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

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
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("earnings wallet", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("earn@test.local", 0);
  });
  afterAll(cleanup);

  it("starts at zero available + zero pending", async () => {
    const res = await req("/wallet/earnings", koc.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(0);
    expect(body.pending).toBe(0);
  });

  it("counts a submitted cash mission as pending (not yet available)", async () => {
    await makeMission({ slug: "test-earn-pending", points_reward: 100, cash_reward: 50, quota: 5 });
    await req("/missions/test-earn-pending/join", koc.jwt, { method: "POST" });
    await req("/missions/test-earn-pending/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://x"] }),
    });
    const body = await (await req("/wallet/earnings", koc.jwt)).json();
    expect(body.pending).toBe(50);
    expect(body.available).toBe(0);
  });

  it("moves cash to available on approval + records an earnings transaction", async () => {
    const subs = await (await adminreq("/admin/submissions?status=submitted")).json();
    const sub = subs.submissions.find((s: { missions: { slug: string } }) => s.missions.slug === "test-earn-pending");
    const res = await adminreq(`/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "ok" }),
    });
    expect(res.status).toBe(200);

    const body = await (await req("/wallet/earnings", koc.jwt)).json();
    expect(body.available).toBe(50);
    expect(body.pending).toBe(0);

    const { transactions } = await (await req("/wallet/earnings/history", koc.jwt)).json();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("earn");
    expect(transactions[0].amount).toBe(50);
  });

  it("a non-cash mission credits no earnings", async () => {
    const koc2 = await makeCreator("earn2@test.local", 0);
    await makeMission({ slug: "test-earn-nocash", points_reward: 100, quota: 5 }); // cash_reward null
    await req("/missions/test-earn-nocash/join", koc2.jwt, { method: "POST" });
    await req("/missions/test-earn-nocash/submit", koc2.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://y"] }),
    });
    const subs = await (await adminreq("/admin/submissions?status=submitted")).json();
    const sub = subs.submissions.find((s: { missions: { slug: string } }) => s.missions.slug === "test-earn-nocash");
    await adminreq(`/admin/submissions/${sub.id}/approve`, { method: "POST" });
    const body = await (await req("/wallet/earnings", koc2.jwt)).json();
    expect(body.available).toBe(0);
  });
});
```

- [ ] **Step 2: Register the new test file in the integration script**

In `package.json`, append `server/test/wallet.test.ts` to the `test:integration` script:

```json
"test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/redemption.test.ts server/test/wallet.test.ts",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration -- server/test/wallet.test.ts`
Expected: FAIL — `/wallet/earnings` and `/wallet/earnings/history` don't exist yet.

- [ ] **Step 4: Implement the earnings endpoints**

In `server/routes/wallet.ts`, add these two routes at the end of the file (after `/points/history`):

```ts
walletRoutes.get("/earnings", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");

  const { data: bal, error: balErr } = await supabase
    .from("earnings_balances")
    .select("available")
    .eq("creator_id", userId)
    .maybeSingle();
  if (balErr) return c.json({ error: balErr.message, code: "db_error" }, 500);

  // pending = Σ cash_reward over the caller's submitted / under_review submissions.
  const { data: pend, error: pErr } = await supabase
    .from("mission_submissions")
    .select("missions!inner(cash_reward)")
    .eq("creator_id", userId)
    .in("status", ["submitted", "under_review"]);
  if (pErr) return c.json({ error: pErr.message, code: "db_error" }, 500);
  const pending = (pend ?? []).reduce(
    (sum, r) => sum + Number((r as { missions?: { cash_reward?: number | null } }).missions?.cash_reward ?? 0),
    0,
  );

  return c.json({ available: Number(bal?.available ?? 0), pending });
});

walletRoutes.get("/earnings/history", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("earnings_transactions")
    .select("id, type, amount, balance_after, description, created_at")
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const transactions = (data ?? []).map((t) => ({
    ...t,
    amount: Number(t.amount),
    balance_after: Number(t.balance_after),
  }));
  return c.json({ transactions });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -- server/test/wallet.test.ts`
Expected: PASS — all four earnings tests green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/wallet.ts server/test/wallet.test.ts package.json
git commit -m "feat(slice5): earnings + earnings history endpoints"
```

---

### Task 11: Frontend queries — `useEarnings`, `useEarningsHistory`

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Test: `src/lib/queries/redemption-earnings.test.tsx`

- [ ] **Step 1: Add a failing test for `useEarnings`**

In `src/lib/queries/redemption-earnings.test.tsx`, change the `./kocmax` import to also import `useEarnings`, and add a second `describe` block.

Change the import line to:
```tsx
import { useRedemptions, useEarnings } from "./kocmax";
```
Add at the end of the file:
```tsx
describe("useEarnings", () => {
  it("fetches the earnings summary", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ available: 50, pending: 30 });
    const { result } = renderHook(() => useEarnings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(50);
    expect(api.apiFetch).toHaveBeenCalledWith("/wallet/earnings");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/queries/redemption-earnings.test.tsx`
Expected: FAIL — `useEarnings` is not exported.

- [ ] **Step 3: Add the types + hooks**

In `src/lib/queries/kocmax.ts`, add at the end of the file:

```ts
export type Earnings = { available: number; pending: number };
export type EarningsTxn = {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description?: string;
  created_at: string;
};

export function useEarnings() {
  return useQuery({ queryKey: ["earnings"], queryFn: () => apiFetch<Earnings>("/wallet/earnings") });
}
export function useEarningsHistory() {
  return useQuery({
    queryKey: ["earnings-history"],
    queryFn: async () => (await apiFetch<{ transactions: EarningsTxn[] }>("/wallet/earnings/history")).transactions,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/queries/redemption-earnings.test.tsx`
Expected: PASS (both `useRedemptions` and `useEarnings` describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/queries/redemption-earnings.test.tsx
git commit -m "feat(slice5): useEarnings + useEarningsHistory query hooks"
```

---

### Task 12: Wallet earnings UI

**Files:**
- Modify: `src/routes/_app.wallet.tsx`
- Test: `src/routes/-_app.wallet.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/routes/-_app.wallet.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: () => {} }));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1" } }),
  useBalance: () => ({ data: { balance: 250, available_to: null }, isLoading: false, isError: false }),
  usePointHistory: () => ({ data: [], isLoading: false, isError: false }),
  useEarnings: () => ({ data: { available: 50, pending: 30 }, isLoading: false, isError: false }),
  useEarningsHistory: () => ({
    data: [{ id: "e1", type: "earn", amount: 50, balance_after: 50, description: "任務獎金", created_at: "2026-06-14T00:00:00Z" }],
    isLoading: false,
    isError: false,
  }),
}));

import { Route } from "./_app.wallet";

function renderWallet() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Wallet earnings", () => {
  it("shows the available + pending earnings", () => {
    renderWallet();
    expect(screen.getByText("收益錢包")).toBeInTheDocument();
    expect(screen.getByText("HK$50.00")).toBeInTheDocument();
    expect(screen.getByText("HK$30.00")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.wallet.test.tsx`
Expected: FAIL — the wallet route doesn't render an earnings section / doesn't call `useEarnings` yet.

- [ ] **Step 3: Add the earnings section to the wallet route**

Replace the entire contents of `src/routes/_app.wallet.tsx` with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useBalance, usePointHistory, useMe, useEarnings, useEarningsHistory } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/wallet")({ component: Wallet });

function Wallet() {
  const me = useMe();
  const balance = useBalance();
  const history = usePointHistory();
  const earnings = useEarnings();
  const earningsHistory = useEarningsHistory();
  useRealtimeBalance(me.data?.id);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-2xl font-bold">錢包</h1>
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}

      <h2 className="font-heading font-bold">積分記錄</h2>
      {history.isLoading && <SkeletonCard className="h-24" />}
      {history.isError && <p className="text-sm text-[var(--color-magenta)]">記錄載入失敗</p>}
      <ul className="space-y-2">
        {history.data?.map((t) => (
          <li key={t.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div>
              <p className="font-heading font-semibold">{t.description ?? t.type}</p>
              <p className="text-xs text-[var(--color-soft-ink)]">{t.created_at.slice(0, 10)}</p>
            </div>
            <span className={`font-display font-bold ${t.delta >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-magenta)]"}`}>{t.delta >= 0 ? "+" : ""}{t.delta}</span>
          </li>
        ))}
        {!history.isLoading && !history.isError && history.data?.length === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">暫無記錄</li>
        )}
      </ul>

      <h2 className="font-heading font-bold">收益錢包</h2>
      <div className="pastel-card grid grid-cols-2 gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <div>
          <p className="text-xs text-[var(--color-soft-ink)]">可提現收益</p>
          <p className="font-display text-2xl font-bold">HK${(earnings.data?.available ?? 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-soft-ink)]">待審批收益</p>
          <p className="font-display text-2xl font-bold text-[var(--color-soft-ink)]">HK${(earnings.data?.pending ?? 0).toFixed(2)}</p>
        </div>
      </div>
      {earnings.isError && <p className="text-sm text-[var(--color-magenta)]">收益載入失敗</p>}
      <ul className="space-y-2">
        {earningsHistory.data?.map((t) => (
          <li key={t.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div>
              <p className="font-heading font-semibold">{t.description ?? t.type}</p>
              <p className="text-xs text-[var(--color-soft-ink)]">{t.created_at.slice(0, 10)}</p>
            </div>
            <span className="font-display font-bold text-[var(--color-ink)]">+HK${t.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-_app.wallet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.wallet.tsx src/routes/-_app.wallet.test.tsx
git commit -m "feat(slice5): earnings section on the wallet page"
```

---

### Task 13: Demo seed — a cash mission + a demo code pool

**Files:**
- Modify: `supabase/seed.sql`

> So the live demo works end-to-end: one demo gift becomes redeemable (its pool loaded), and one demo mission carries a `cash_reward` that lands in the earnings wallet on approval.

- [ ] **Step 1: Inspect the current seed to find the gift + mission to extend**

Run: `grep -n "insert into public.redemption_gifts\|insert into public.missions\|咖啡券\|現金券" supabase/seed.sql`
Expected: shows the gifts insert (with `咖啡券`, `HK$50 現金券`, …) and the missions insert. Demo gifts are inserted without an explicit id (uuid default), so the seed must look them up by name to load codes.

- [ ] **Step 2: Append a demo code pool + a cash reward to the seed**

At the **end** of `supabase/seed.sql`, append:

```sql
-- Slice 5 demo: make the 咖啡券 gift redeemable by loading a small code pool,
-- and keep its stock in lockstep with the pool size.
insert into public.redemption_codes (gift_id, workspace_id, code)
  select g.id, g.workspace_id, c.code
  from public.redemption_gifts g
  cross join (values ('DEMO-CAFE-001'),('DEMO-CAFE-002'),('DEMO-CAFE-003')) as c(code)
  where g.workspace_id = '00000000-0000-0000-0000-0000000000aa' and g.name = '咖啡券';

update public.redemption_gifts g
  set stock_remaining = (select count(*) from public.redemption_codes rc where rc.gift_id = g.id and rc.status = 'available')
  where g.workspace_id = '00000000-0000-0000-0000-0000000000aa' and g.name = '咖啡券';

-- Slice 5 demo: give the first demo mission a HK$ cash reward so approval credits
-- the earnings wallet (points still award as before).
update public.missions
  set cash_reward = 80.00
  where workspace_id = '00000000-0000-0000-0000-0000000000aa'
    and slug = (select slug from public.missions
                where workspace_id = '00000000-0000-0000-0000-0000000000aa'
                order by slug limit 1);
```

- [ ] **Step 3: Re-seed and verify the demo pool loaded**

Run: `supabase db reset && psql "$(supabase status -o env 2>/dev/null | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "select name, stock_remaining from public.redemption_gifts where name='咖啡券'; select count(*) from public.redemption_codes;"`
Expected: `咖啡券` `stock_remaining` reflects the loaded pool (3), and `redemption_codes` count ≥ 3. (Equivalently confirm via the Supabase MCP `execute_sql` if `psql` resolution differs.)

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore(slice5): demo code pool + cash_reward demo mission seed"
```

---

### Task 14: Phase B green gate + full integration run

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm run test`
Expected: PASS (all component/hook suites).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 3: Full integration suite**

Run: `npm run test:integration`
Expected: PASS — every suite green, including the new `redemption` and `earnings wallet` suites and the unchanged Slice-1→4 suites (rls, bootstrap, onboarding, missions, admin).

(No commit — verification only. Slice 5 implementation is complete; hand off to `superpowers:finishing-a-development-branch`.)

---

## Post-implementation (operational, user-gated)

These are tracked in `docs/deployment-config-runbook.md` and are **not** code tasks:
- Run `0006_redemption.sql` + `0007_earnings.sql` against the **cloud** project (`mhkoayftiuojxlrkollf`). The new tables carry their own explicit grants in the migrations, so they apply regardless of the `auto_expose_new_tables` flag.
- For each gift that should be redeemable in production, the operator loads a code pool via `POST /api/admin/gifts/:id/codes` with the `x-admin-secret` header (the same `ADMIN_SECRET` set for Slice 4).
- Seed gifts so `stock_remaining` equals the loaded code count (the migration/seed keep them in lockstep; manual cloud inserts must match).
```
