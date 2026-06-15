-- Slice 6C: passport scores completion. Add a per-submission quality rating (the
-- Content score source) and a 5-star XP bonus; the Brand Safety proxy is computed in
-- TypeScript from existing statuses (no schema needed).

-- 1. Quality rating (1-5), set by the operator at approval time. Nullable: an approval
--    without a rating simply doesn't contribute to the Content score.
alter table public.mission_submissions
  add column quality_rating smallint
  check (quality_rating is null or quality_rating between 1 and 5);

-- 2. Rebuild approve_submission to record the rating and award +50 XP on a 5-star.
--    A defaulted 3rd param would make the existing 2-arg call ambiguous, so drop the
--    old signature first, then recreate (preserving the Slice 4 points + Slice 5 cash body).
drop function if exists public.approve_submission(uuid, text);

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
begin
  if p_quality_rating is not null and (p_quality_rating < 1 or p_quality_rating > 5)
    then raise exception 'bad_rating'; end if;

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

-- 3. Re-apply the service-role-only execute grants for the NEW signature.
revoke all on function public.approve_submission(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text, smallint) to service_role;
