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
