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

  -- Deduct points atomically. The `balance >= points_cost` guard makes this race-safe:
  -- two concurrent redeems of DIFFERENT gifts by the same creator can both pass the
  -- read-check above, but only one can satisfy this predicate at UPDATE time. A null
  -- return means the balance was drained in between → insufficient_points (the whole
  -- tx, including the code claim above, rolls back).
  update public.point_balances set balance = balance - g.points_cost, updated_at = now()
    where creator_id = v_creator and workspace_id = v_ws and balance >= g.points_cost
    returning balance into v_bal;
  if v_bal is null then raise exception 'insufficient_points'; end if;
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
