# Adfocate 2.0 — Slice 5: Wallet & Redemption Writes (Design)

> **Status:** design approved (2026-06-14), spec written. Next: `writing-plans`.
> **Branch:** `feat/slice5-wallet-redemption` (off `main` @ merged Slice 4 + entry-IA).
> **Roadmap ref:** Slice 5 in [architecture rebaseline §4](./2026-06-13-adfocate-2.0-architecture-supabase-rebaseline.md) · product scope: full spec [`adfocate-2-spec.md`](./adfocate-2-spec.md) §9 (Points & Redemption / Earnings), Phase 2.

## 1. Goal

Close the points loop and surface cash earnings: a creator can **spend points on a gift and instantly receive a pre-loaded code**, see their **redemption history**, and view a **read-only cash earnings wallet** where a mission's `cash_reward` accrues on approval.

## 2. Where this sits

Slice 4 made points + XP *accrue* (join → submit → approve). This slice makes points *spendable* (redemption) and makes cash *visible* (earnings). It is strictly **additive** on the live foundation — new tables + one RPC + an extension to the Slice-4 `approve_submission` RPC + new routes + additive UI. Multi-workspace RLS, the `X-Workspace-Slug` header, and existing tables are untouched.

## 3. Scope

### 3.1 In scope
- **Redemption writes:** redeem a gift → atomic point deduction + stock decrement + **claim one pre-loaded code** + a `redemptions` record; the creator sees the code immediately. Redemption history.
- **Code pool:** a `redemption_codes` table (per-gift pool) + an operator endpoint to load codes.
- **Cash earnings wallet (read-only):** `earnings_balances` + `earnings_transactions` (HKD); `cash_reward` accrues to `available` on mission approval (extend `approve_submission`); a derived `pending` figure; earnings history.

### 3.2 Explicitly out (deferred, seams left)
| Deferred | Owning slice / note |
|---|---|
| Withdrawal / payout + bank/FPS detail capture (PII/PDPO) | Slice 5b (Earnings payout) |
| Referral payout (200 pts/side, from Slice 3) | own small slice |
| Affiliate tracking codes (click/conversion) | own slice |
| Earnings simulator (views → projected income) | later |
| Brand code-batch CSV upload UI | Brand Dashboard (Slice 8) — interim is the admin endpoint |
| Server-side redeem idempotency key | follow-up hardening (see §9) |

## 4. Decisions (resolved in brainstorming)
1. **Scope = redemption + earnings/cash wallet** (the bigger roadmap bundle), decomposed away from tracking-codes and referral payout.
2. **Withdrawal deferred** — the cash wallet is **read-only** this slice (accrue + display); the withdraw action + bank-detail capture (PII) land in a follow-on (Slice 5b).
3. **Redemption fulfillment = instant pre-loaded codes** — each gift holds a code pool; redeeming pops one and returns it immediately (uniform across gift types; for physical/experience the code is a claim reference the operator matches).

## 5. Data model — new migration `supabase/migrations/0006_redemption_earnings.sql`

```sql
-- Per-gift code pool. RLS on with NO select policy → never client-readable;
-- only the redeem_gift RPC (SECURITY DEFINER) + service_role touch it.
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

-- One row per redemption.
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

-- Cash earnings ledger (mirrors point_balances / point_transactions; HKD decimals).
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

-- RLS: self-scoped reads; ALL writes via the SECURITY DEFINER RPCs.
alter table public.redemption_codes      enable row level security;  -- no select policy (pool hidden)
alter table public.redemptions           enable row level security;
alter table public.earnings_balances     enable row level security;
alter table public.earnings_transactions enable row level security;
create policy redemptions_self on public.redemptions       for select using (creator_id = auth.uid());
create policy earnings_bal_self on public.earnings_balances for select using (creator_id = auth.uid());
create policy earnings_tx_self on public.earnings_transactions for select using (creator_id = auth.uid());

grant select on public.redemptions, public.earnings_balances, public.earnings_transactions to authenticated;
grant all on public.redemption_codes, public.redemptions, public.earnings_balances, public.earnings_transactions to service_role;
-- NB: redemption_codes gets NO authenticated grant — codes are secret until issued.
```

## 6. Transitions — RPCs (SECURITY DEFINER, mirroring Slice 4)

### 6.1 `redeem_gift(p_gift uuid) returns public.redemptions`
- **Caller:** KOC (`auth.uid()`), guarded route.
- **Guards (raise):** gift exists in caller's workspace; `status='available'`; within `valid_from`/`valid_to` (null = no bound); `stock_remaining > 0`; caller `point_balances.balance >= points_cost` (else `insufficient_points`).
- **Atomic code claim:** `update redemption_codes set status='issued', issued_to=v_creator, issued_at=now() where id = (select id from redemption_codes where gift_id=p_gift and status='available' limit 1 for update skip locked) returning id, code into v_code_id, v_code` — if null, raise `out_of_stock`.
- **Effect:** `update point_balances set balance = balance - points_cost` returning `v_bal`; insert `point_transactions (type='redeem', delta = -points_cost, balance_after=v_bal, source_ref='redemption:'||..., description=gift.name)`; `update redemption_gifts set stock_remaining = stock_remaining - 1`; insert `redemptions (…, code_id=v_code_id, code=v_code, points_spent=points_cost, status='fulfilled')`; return the row (incl. `code`).
- **Grants:** execute to `authenticated`, `service_role`.

### 6.2 Extend `approve_submission(p_submission, p_notes)` (replace the Slice-4 function in `0006`)
After the existing points/XP award, add cash accrual:
- read `mission.cash_reward`; if `> 0`: `update earnings_balances set available = available + cash_reward, updated_at=now()` returning `v_earn_bal` (raise `earnings_balances row missing` if null — same defensive check as points); insert `earnings_transactions (type='earn', amount=cash_reward, balance_after=v_earn_bal, source_ref='mission_submission:'||p_submission, description=mission.title)`.
- Idempotency is preserved by the existing status guard (a submission only leaves `submitted` once, so cash credits exactly once).

## 7. API

### 7.1 KOC (guarded)
| Method/path | Effect |
|---|---|
| `POST /redemption/redeem` | body `{ gift_id }`; `rpc('redeem_gift')`; returns the redemption incl. `code`; RPC raises map to `409 {code}` (`insufficient_points`, `out_of_stock`, `closed`) / `404`. |
| `GET /redemption/history` | caller's redemptions joined to gift name + the issued code. |
| `GET /wallet/earnings` | `{ available }` (from `earnings_balances`) + `{ pending }` derived = Σ `missions.cash_reward` over the caller's `submitted`/`under_review` submissions. |
| `GET /wallet/earnings/history` | caller's `earnings_transactions`. |

### 7.2 Admin (`server/routes/admin.ts`, `x-admin-secret`)
| Method/path | Effect |
|---|---|
| `POST /admin/gifts/:id/codes` | body `{ codes: string[] }`; bulk-insert into `redemption_codes` (status `available`); `update redemption_gifts set stock_remaining = stock_remaining + n`. Operator loads the pool. |

### 7.3 Bootstrap
`/me/bootstrap` also upserts an `earnings_balances` row (mirrors the existing `point_balances` upsert), so approval-time cash credit always has a target. Backfill existing creators in the migration.

## 8. Frontend
- **`src/lib/queries/kocmax.ts`:** `useRedeemGift` (mutation → invalidate `['gifts']`, `['balance']`, `['redemptions']`, `['history']`), `useRedemptions`, `useEarnings`, `useEarningsHistory`.
- **Redemption** (`src/routes/_app.redemption.tsx`): a **兌換** action per gift → confirm dialog → redeem → **reveal the code** (`你的兌換碼: …`, copyable); disabled when `balance < points_cost` or `stock_remaining = 0`. Points balance is realtime, so the deduction reflects live.
- **Redemption history** (`src/routes/_app.redemption.history.tsx`, `/redemption/history`): list of past redemptions (gift name, code, points spent, date).
- **Earnings** (a section in `src/routes/_app.wallet.tsx`, or a sibling): `可提現收益` (available) + `待審批收益` (pending) + earnings history. **No withdraw button** (deferred).
- i18n stays hardcoded zh-Hant-HK.

## 9. Error handling & idempotency
- RPC raises map to `409`/`404` with a typed `{error, code}` body (Slice-4 convention); the `redeem_gift` route reuses the `rpcError` mapper.
- Admin route returns `401 {code:'no_admin'}` without the secret.
- **Redemption is not naturally idempotent** — a double-click could redeem twice (two codes, double point spend). v1 relies on the disabled-button + the atomic claim. A server-side idempotency key is a noted follow-up (the S4 double-join race was hardened the same way after).

## 10. Testing
- **Backend integration** (`server/test/`, runs in the CI integration job): redeem (ok → returns a code, deducts points, decrements stock, records a redemption; `insufficient_points`; `out_of_stock` when the pool is empty; two redeems claim **distinct** codes); admin add-codes (loads pool, bumps stock); **approve credits cash** for a `cash_reward` mission (+ a non-cash mission credits none); bootstrap seeds `earnings_balances`; earnings `pending` derivation. Helpers: extend `makeMission` with `cash_reward`; add a `makeGift`/`addCodes` seeder; cleanup covers the new tables.
- **Frontend** component tests (mirror existing `-_app.*.test.tsx`): redeem button → code reveal; out-of-points disables; earnings view shows available + pending.

## 11. User-gated / operational
- Operator loads gift code pools via `POST /api/admin/gifts/:id/codes` (with `x-admin-secret`) before those gifts are redeemable. Seed a demo pool + a `cash_reward` demo mission for the live demo.

## 12. Build sequencing (for the plan)
Larger than Slice 4 (two subsystems, 4 tables). The implementation plan sequences it as two committable phases on one branch: **(A) Redemption** (codes table + redemptions + redeem RPC + admin codes + redeem/history UI), then **(B) Earnings** (earnings tables + approve_submission extension + bootstrap seed + earnings endpoints + wallet UI).

## 13. Risks
- **Double-redeem** (double-click): §9 — UI-disabled button + atomic claim now; idempotency key later.
- **Stock vs pool drift:** `stock_remaining` is decremented in lockstep with claiming a code; `add-codes` bumps it by the batch size. Seed gifts so `stock_remaining` equals the loaded code count.
- **Cash-without-earnings-row:** the `approve_submission` cash credit raises loudly if the `earnings_balances` row is missing (bootstrap + migration backfill guarantee it).
