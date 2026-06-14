-- Slice 3: onboarding state, phone identity, referral, and the welcome-bonus award.

-- 1. Onboarding + phone + referral columns on creators ----------------------
alter table public.creators
  add column onboarding_step      integer not null default 1,
  add column onboarding_completed boolean not null default false,
  add column phone                text,                 -- E.164 ('+852…'); null for email/Google-only users
  add column referred_by          uuid references public.creators(id);

create index creators_phone_idx on public.creators (phone);

-- referral_code: backfill existing rows, then default + unique for new rows.
alter table public.creators add column referral_code text;
update public.creators
  set referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where referral_code is null;
alter table public.creators
  alter column referral_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
alter table public.creators
  add constraint creators_referral_code_key unique (referral_code);

-- 2. Constrain status (default stays 'active'; existing rows are 'active') ---
alter table public.creators
  add constraint creators_status_chk check (status in ('active','suspended','pending_review'));

-- 3. Self-scoped profile writes (points stay service-role) -------------------
create policy creators_self_update on public.creators
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 4. Welcome-bonus award: atomic + idempotent, service-role only ------------
-- Lives in public so PostgREST exposes it for the service client's .rpc(),
-- but execute is revoked from anon/authenticated so end-users can never mint points.
create or replace function public.award_welcome_bonus(p_creator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws   uuid;
  v_done boolean;
  v_bal  integer;
begin
  select workspace_id, onboarding_completed
    into v_ws, v_done
    from public.creators
    where id = p_creator
    for update;

  if v_ws is null then
    raise exception 'creator % not found', p_creator;
  end if;
  if v_done then
    return;  -- already onboarded → no double award
  end if;

  update public.point_balances
    set balance = balance + 100, updated_at = now()
    where creator_id = p_creator and workspace_id = v_ws
    returning balance into v_bal;

  if v_bal is null then
    -- bootstrap always seeds a balance row; a missing one is an invariant breach.
    -- Fail loudly (leaving onboarding_completed=false for retry) rather than
    -- recording a NULL balance_after and locking the creator out of the award.
    raise exception 'point_balances row missing for creator %', p_creator;
  end if;

  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (p_creator, v_ws, 'bonus', 100, v_bal, 'welcome', '迎新獎賞 100 積分');

  update public.creators
    set onboarding_completed = true, onboarding_step = 5
    where id = p_creator;
end;
$$;

revoke all on function public.award_welcome_bonus(uuid) from public;
revoke all on function public.award_welcome_bonus(uuid) from anon;
revoke all on function public.award_welcome_bonus(uuid) from authenticated;
grant execute on function public.award_welcome_bonus(uuid) to service_role;
