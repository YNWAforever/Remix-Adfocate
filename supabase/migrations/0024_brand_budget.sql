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
