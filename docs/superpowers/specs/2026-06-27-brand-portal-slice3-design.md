# Brand Portal Slice 3 — Budget & Wallet (design)

**Date:** 2026-06-27
**Branch:** `feat/brand-portal-slice3` (stacked on `feat/brand-portal-slice2` → `feat/brand-portal-slice1`)
**Status:** approved design, ready for implementation plan

## Context & goal

Slice 2 gave brands review + payout: approving a submission credits the creator's
points **and** cash (`approve_submission`, migration 0009), but there is **no brand-side
debit or spend cap** — a brand could approve unlimited payouts. This slice adds a
per-workspace **budget** that is debited when a brand (or operator) approves a cash
payout, and **hard-blocks** the approval when funds run out.

This is an **internal, operator-funded** model (Fimmick agency runs KOCmax for brands) —
**no payment gateway**. It is one migration, fully in-app.

## Locked decisions (from brainstorming)

1. **Funding** — operator-allocated internal credit. Staff top up a brand's balance in
   `/admin`; the brand spends it down. No Stripe/payment integration.
2. **What's metered** — **cash (HK$) only**. The budget is a HK$ credit balance, debited by
   the mission's `cash_reward` on each approval. Points stay a platform-funded loyalty
   currency (unmetered). A `cash_reward = 0` mission costs the brand nothing and never blocks.
3. **Enforcement** — **hard block**. An approval that would exceed the remaining balance
   fails atomically; the creator is **not** paid and the submission stays pending. The
   check + debit + creator-credit happen in one transaction inside `approve_submission`
   (no TOCTOU / double-spend).
4. **Granularity** — **one pool per brand workspace**. Any approval on any of the brand's
   missions debits the shared balance. (Not per-mission; `missions.cpm_budget_pool` stays
   dormant.)
5. **Cap scope** — **per-workspace opt-in flag that binds everyone**. Enforcement is OFF by
   default, so existing workspaces and operator approvals are unaffected (zero rollout
   breakage). When the operator turns it ON for a brand, **both** brand-portal and
   operator/staff approvals debit + are hard-blocked. One source of truth.

## Architecture — Approach A (extend the shared RPC)

The atomic budget check + debit lives **inside** `approve_submission`, the same RPC both
the brand route (`brandReview.ts`) and the operator route (`admin.ts`) already call. This
is the only race-safe option that binds both approval paths from a single source of truth.
(Approach B — guard in the route + a separate debit RPC — was rejected: not atomic, and the
operator path would bypass it. Approach C — per-mission pools — was rejected in decision 4.)

**Corrections:** debit happens only on approve (terminal — reject never paid, nothing to
refund). For claw-backs/mistakes the operator gets an `adjust` action (signed credit/debit).
**No reservations/holds** on pending submissions — first-come-first-served until funds run
out (deliberate YAGNI).

## Section 1 — Data model (migration `0024_brand_budget.sql`)

Two new tables, mirroring the `earnings_balances` / `earnings_transactions` shapes:

```
workspace_budgets
  id            uuid pk default gen_random_uuid()
  workspace_id  uuid not null unique → workspaces(id) on delete cascade
  balance       numeric(12,2) not null default 0   check (balance >= 0)
  enforced      boolean not null default false
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

workspace_budget_transactions            -- append-only ledger
  id            uuid pk default gen_random_uuid()
  workspace_id  uuid not null → workspaces(id) on delete cascade
  type          text not null check (type in ('topup','debit','adjust'))
  delta         numeric(12,2) not null    -- signed: topup +, debit −, adjust ±
  balance_after numeric(12,2) not null
  source_ref    text          -- submission id for debits; null/operator note otherwise
  description   text
  created_at    timestamptz not null default now()
  -- index (workspace_id, created_at desc)
```

**RLS:** a brand may `SELECT` its own workspace's budget + ledger rows (membership via
`brand_users`, read through `makeUserClient` like the brand mission reads). All writes are
`service_role` only (operator-funded). Mirror the `missions` brand-RLS policy shape from 0023.

**RPCs** (all `security definer`, `revoke from public/anon/authenticated`, `grant execute to service_role`):

- **`approve_submission` redefined** — after it computes `v_cash` (the mission's `cash_reward`)
  and only when `v_cash > 0`:
  `select balance, enforced into v_bal, v_enforced from workspace_budgets where workspace_id = v_workspace for update;`
  (the `for update` row lock kills the double-spend race). If a row exists **and** `v_enforced`:
  - `v_bal < v_cash` → `raise exception 'insufficient_budget';` (whole tx rolls back, nothing paid);
  - else `update workspace_budgets set balance = balance - v_cash, updated_at = now()` and insert a
    `debit` ledger row (`delta = -v_cash`, `balance_after = v_bal - v_cash`, `source_ref = p_submission`),
    then credit the creator exactly as today.
  No budget row, or `enforced = false`, or `v_cash = 0/null` → **behaves identically to today**.
- **`credit_workspace_budget(p_workspace uuid, p_delta numeric, p_type text, p_description text)`** —
  upserts the budget row, applies the signed `delta` (top-up = +, adjust = ±), inserts a ledger row,
  returns the new balance; raises `negative_balance` if the result would be `< 0`.
- **`set_workspace_budget_enforcement(p_workspace uuid, p_enforced boolean)`** — upserts the row,
  flips the flag.

The existing RPC is already a single plpgsql transaction, so check + debit + credit are atomic by construction.

## Section 2 — Server API

**Shared error mapping:** `approve_submission` raises `insufficient_budget`. Both approve
callers — `server/routes/brandReview.ts` (Slice 2) and `server/routes/admin.ts` (operator) —
special-case `error.message === 'insufficient_budget'` → **402** `{ code: "insufficient_budget" }`
(instead of the generic `rpc_error` 400). Every other RPC error is unchanged.

**Operator endpoints** — new module `server/routes/adminBudget.ts`, staff-authed via the same
guard `adminMissions.ts` uses, mounted under `/admin`; all writes via the Section-1 RPCs on
`serviceClient`:

| Method · path | Body | Action |
|---|---|---|
| `GET /admin/budget?workspace=<id>` | — | `{ balance, enforced, transactions[] }` for that workspace |
| `POST /admin/budget/topup` | `{ workspace_id, amount }` | `credit_workspace_budget(+amount,'topup')`; `amount ≤ 0` → 400 |
| `POST /admin/budget/adjust` | `{ workspace_id, delta, description }` | `credit_workspace_budget(delta,'adjust')`; result `< 0` → 400 `negative_balance` |
| `POST /admin/budget/enforcement` | `{ workspace_id, enforced }` | `set_workspace_budget_enforcement(...)` |

**Brand endpoint** — `GET /brand/budget` (added to the Slice-2 brand router, under `requireBrand`):
returns `{ balance, enforced, transactions: recent }` scoped to `c.var.brand.workspaceId` via
`makeUserClient` + the brand-SELECT RLS policy. **Read-only** — the brand can never top-up or
toggle enforcement. `workspace_id` always comes from the verified identity, never a request param.

Trust boundary mirrors Slice 2: operator writes are staff-authed + `serviceClient`; the brand
sees only its own workspace's wallet via RLS.

## Section 3 — UI

**Operator (`/admin`) — a new "Budget" tab** in the staff `/admin` shell (alongside Missions):
a **workspace picker** → shows that workspace's **balance**, an **enforcement toggle**, and a
**ledger table** (top-ups / debits / adjusts with timestamps + the submission ref on debits);
two actions, **Top-up** (amount) and **Adjust** (signed delta + reason), calling the Section-2
endpoints and refetching.

**Brand (`/brand`) — read-only (the brand can't fund itself):**
- **Budget card on the dashboard** (`brand.index.tsx`): remaining HK$ + an enforced/not-enforced
  badge; when enforced and low/zero, a "contact your operator to top up" hint.
- **On `/brand/review`**: a compact balance banner above the Submissions tab; an approve that
  returns **402 `insufficient_budget`** surfaces via the existing Slice-2 `onError` alert (no extra wiring).
- **A dedicated `/brand/budget` page** (balance + enforced + ledger history) with a Budget nav
  item — so the brand can see its top-ups and what each approval cost.

**i18n:** new `app.admin.budget.*` and `app.brand.budget.*` keys (en + zh parity), same pattern as Slice 2.

## Section 4 — Testing & rollout

**Integration suite** (`server/test/brandBudget.test.ts`, CI clean schema) — load-bearing proofs:

1. **Backward-compat** — enforcement OFF / no budget row: approve still succeeds, creator credited,
   zero budget interaction (proves no rollout breakage).
2. **Enforced + sufficient** — top up, enforce, approve a cash mission → 200, balance debited by
   `cash_reward`, a `debit` ledger row written (`source_ref` = submission id), creator credited.
3. **Enforced + insufficient → hard cap** — approve → 402 `insufficient_budget`; creator NOT paid
   (point + earnings balances unchanged), workspace balance unchanged, submission still pending.
4. **Operator path also bound** — same enforced+empty workspace, approve via the operator/admin
   route → also 402.
5. **`cash_reward = 0` on an enforced workspace** → 200, no debit, never blocks.
6. **Top-up unblocks** — `credit_workspace_budget` raises balance + ledger row; the previously
   blocked approve now succeeds.
7. **Adjust can't go negative** → 400 `negative_balance`.
8. **Brand isolation** — `GET /brand/budget` returns only the caller's workspace; brand B can't see
   brand A's; no brand top-up endpoint exists.

A `seedWorkspaceBudget` test helper sets balance + enforcement.

**Unit tests:** route-stub tests for the `/brand/budget` page and the operator Budget tab (mirror the
Slice-2 stubs); i18n parity covered by the existing test.

**Rollout:** apply `0024_brand_budget.sql` to prod **before** deploy (+ `notify pgrst, 'reload schema'`),
per the established pattern. The RPC change is backward-compatible (no budget row / enforcement off =
behaves exactly as today), so there is **no flag-day** — existing workspaces and operator flows keep
working untouched; the operator enables enforcement per brand when ready.

## Out of scope (future)

- Self-serve real-money top-up (payment gateway, webhooks, reconciliation) — its own epic.
- Per-mission funded pools / activating `cpm_budget_pool`.
- Points budgeting / a unified points+cash budget with a conversion rate.
- Reservations/holds on pending submissions; auto-refund flows.
- Low-balance notifications/alerts (could reuse the N1 notifications engine later).
