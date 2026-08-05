-- 20260805120000_review_hardening.sql
-- Close six direct-PostgREST write/read paths that bypass the Hono handlers:
--   A. brand table-wide UPDATE on missions          -> column grant + live-reward freeze
--   B. brand table-wide UPDATE on campaigns         -> column grant + settle budget guard
--   C. legacy join/submit RPCs on active missions   -> creator_workflow_mode gate
--   D. creator-forced workflow refresh              -> operator-owned state short-circuit
--   E. verified-identity spoofing on social handles -> verification cleared on identity change
--   F. draft missions readable by creators          -> status predicate in the RLS policy

-- A. missions: brands may only write the authoring surface --------------------------------------
-- 0023 granted `update` table-wide and 0004 granted `select`; the table-wide UPDATE is the one
-- that let a brand PATCH filled/creator_workflow_mode/reward columns straight through PostgREST.
-- The column list is exactly what routes/brand.ts writes (EDITABLE_COLS + the brief fields +
-- the publish/close lifecycle stamps).
revoke update on public.missions from authenticated;
grant update (
  slug, title, description, category, mission_type, access_type, required_level,
  points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota,
  deliverables, requirements, platforms, effort,
  target_audience, dos, donts, key_messages, reference_links,
  status, published_at, closed_at, updated_at
) on public.missions to authenticated;

-- approve_submission reads the reward live at approval time, so a reward edit after publish
-- silently repays every creator who already delivered. A policy cannot see the OLD row, so the
-- pre-image is read through a SECURITY DEFINER helper: it is `stable`, therefore it runs on the
-- statement snapshot and sees the row as it was before this UPDATE. SECURITY DEFINER also means
-- the read is not re-filtered by the very policy that calls it (no policy recursion).
-- The status arm is what makes the reward arm hold: without it a brand demotes a live mission to
-- 'draft' and then edits the rewards freely on the next request.
create or replace function private.mission_brand_update_allowed(
  p_mission uuid,
  p_status text,
  p_points_reward integer,
  p_cash_reward numeric,
  p_cpm_rate numeric,
  p_cpm_budget_pool numeric
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (mission.status = 'draft' or p_status <> 'draft')
     and (mission.status = 'draft'
       or (mission.points_reward   is not distinct from p_points_reward
       and mission.cash_reward     is not distinct from p_cash_reward
       and mission.cpm_rate        is not distinct from p_cpm_rate
       and mission.cpm_budget_pool is not distinct from p_cpm_budget_pool))
  from public.missions mission
  where mission.id = p_mission
$$;

revoke all on function private.mission_brand_update_allowed(uuid, text, integer, numeric, numeric, numeric)
  from public, anon;
grant execute on function private.mission_brand_update_allowed(uuid, text, integer, numeric, numeric, numeric)
  to authenticated;

drop policy if exists missions_brand_update on public.missions;
create policy missions_brand_update on public.missions
  for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (
    workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active)
    and private.mission_brand_update_allowed(id, status, points_reward, cash_reward, cpm_rate, cpm_budget_pool)
  );

-- B. campaigns: status/settled_at/prize_tiers belong to close_campaign / settle_campaign --------
-- 0025 granted `update` table-wide, so PATCH {"status":"settled"} terminated a campaign without
-- settle_campaign ever running. The column list mirrors CAMPAIGN_EDITABLE_COLS.
revoke update on public.campaigns from authenticated;
grant update (
  slug, title, description, starts_at, ends_at,
  goal_target, completion_bonus_points, completion_bonus_xp, updated_at
) on public.campaigns to authenticated;

-- settle_campaign, verbatim from 0025 except the points branch now consults the campaign
-- workspace wallet before minting. Points carry no HK$ denomination, so the assertion is the
-- one the wallet can express without an invented rate: an ENFORCED wallet that is exhausted
-- cannot fund a prize round. Enforcement is off by default, so unfunded workspaces are unaffected.
create or replace function public.settle_campaign(p_campaign uuid)
returns public.campaigns
language plpgsql security definer set search_path = public
as $$
declare
  v_c        public.campaigns;
  v_tier     jsonb;
  v_prev_to  int := 0;
  v_row      record;
  v_home     uuid;
  v_pbal     int;
  v_ebal     numeric;
  v_bgt_bal  numeric;
  v_bgt_enf  boolean;
  v_cash     numeric;
  v_points   int;
  v_xp       int;
  v_ref      text;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null then raise exception 'not_found'; end if;
  if v_c.settled_at is not null then return v_c; end if;        -- idempotent: already settled
  if v_c.status <> 'closed' then raise exception 'wrong_state'; end if;

  -- Re-validate prize_tiers in-RPC: ascending, non-overlapping, non-negative.
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    if (v_tier->>'rank_from')::int < 1
       or (v_tier->>'rank_to')::int < (v_tier->>'rank_from')::int
       or (v_tier->>'rank_from')::int <= v_prev_to
       or coalesce((v_tier->>'cash')::numeric, 0)  < 0
       or coalesce((v_tier->>'points')::int, 0)    < 0
       or coalesce((v_tier->>'xp')::int, 0)        < 0
    then raise exception 'invalid_prize_tiers'; end if;
    v_prev_to := (v_tier->>'rank_to')::int;
  end loop;

  -- Rank via the shared ranker; stamp prize_rank (defensively upserting any missing row).
  for v_row in select * from public.rank_campaign(p_campaign) loop
    insert into public.campaign_participants (campaign_id, creator_id, workspace_id, approved_count)
      values (p_campaign, v_row.creator_id, v_c.workspace_id, v_row.approved)
      on conflict (campaign_id, creator_id) do nothing;
    update public.campaign_participants set prize_rank = v_row.rank
      where campaign_id = p_campaign and creator_id = v_row.creator_id;
  end loop;

  -- Pay each tier. A creator wins at most one rank → one campaign_prize: ref per (campaign,creator).
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    v_cash   := coalesce((v_tier->>'cash')::numeric, 0);
    v_points := coalesce((v_tier->>'points')::int, 0);
    v_xp     := coalesce((v_tier->>'xp')::int, 0);
    for v_row in
      select cp.id as part_id, cp.creator_id, cp.prize_rank
        from public.campaign_participants cp
       where cp.campaign_id = p_campaign
         and cp.prize_rank between (v_tier->>'rank_from')::int and (v_tier->>'rank_to')::int
         and cp.prize_granted_at is null
    loop
      v_ref := 'campaign_prize:' || p_campaign || ':' || v_row.creator_id;
      begin   -- per-winner savepoint
        select workspace_id into v_home from public.creators where id = v_row.creator_id;

        -- CASH: debit the CAMPAIGN workspace budget (hard cap); credit the HOME workspace earnings.
        if v_cash > 0 then
          select balance, enforced into v_bgt_bal, v_bgt_enf
            from public.workspace_budgets where workspace_id = v_c.workspace_id for update;
          if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) < v_cash then
            raise exception 'insufficient_budget';   -- NOT caught here → rolls back the whole settle
          end if;
          if v_bgt_bal is not null then
            update public.workspace_budgets set balance = balance - v_cash, updated_at = now()
              where workspace_id = v_c.workspace_id returning balance into v_bgt_bal;
            insert into public.workspace_budget_transactions
              (workspace_id, type, delta, balance_after, source_ref, description)
              values (v_c.workspace_id, 'debit', -v_cash, v_bgt_bal, v_ref, v_c.title);
          end if;
          insert into public.earnings_balances (creator_id, workspace_id, available)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select available into v_ebal from public.earnings_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.earnings_transactions
            (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'earn', v_cash, v_ebal + v_cash, v_ref, v_c.title);
          update public.earnings_balances set available = available + v_cash, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- POINTS: HOME workspace, gated by the CAMPAIGN workspace wallet.
        if v_points > 0 then
          select balance, enforced into v_bgt_bal, v_bgt_enf
            from public.workspace_budgets where workspace_id = v_c.workspace_id for update;
          if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) <= 0 then
            raise exception 'insufficient_budget';   -- NOT caught here → rolls back the whole settle
          end if;
          insert into public.point_balances (creator_id, workspace_id, balance)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select balance into v_pbal from public.point_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.point_transactions
            (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'bonus', v_points, v_pbal + v_points, v_ref, v_c.title);
          update public.point_balances set balance = balance + v_points, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- XP.
        if v_xp > 0 then
          update public.creators set xp = xp + v_xp where id = v_row.creator_id;
        end if;

        update public.campaign_participants set prize_granted_at = now() where id = v_row.part_id;

        begin   -- best-effort notification
          insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
            values (v_row.creator_id, v_c.workspace_id, 'campaign_prize_awarded', 'campaign', p_campaign,
                    jsonb_build_object('campaign_title', coalesce(v_c.title, ''),
                                       'campaign_slug',  coalesce(v_c.slug, ''),
                                       'rank',   v_row.prize_rank,
                                       'cash',   v_cash,
                                       'points', v_points,
                                       'xp',     v_xp));
        exception when others then
          raise warning 'campaign_prize_awarded notification failed for campaign % creator %', p_campaign, v_row.creator_id;
        end;

      exception
        when unique_violation then null;   -- already paid → skip this winner (DB backstop)
      end;
    end loop;
  end loop;

  update public.campaigns set status = 'settled', settled_at = now(), updated_at = now()
    where id = p_campaign returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.settle_campaign(uuid) from public, anon, authenticated;
grant execute on function public.settle_campaign(uuid) to service_role;

-- C. legacy join/submit may not touch an active-workspace mission -------------------------------
-- Both RPCs are granted to `authenticated`, so a creator could call them directly and inject a
-- row into the legacy payout queue without deliverables, publication proof or proof review.
-- creator_workflow_mode defaults to 'legacy' and is CHECKed to ('legacy','active_workspace'), so
-- the gate keys on the active value and leaves every legacy (and pre-column NULL) row untouched.
-- public.join_active_mission calls the join body, so that body moves to `private` and the public
-- entry point carries the gate.
create or replace function private.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_rows int;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level, quota, filled
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'open' then raise exception 'not_open'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- Effective-level gate. L2+ missions need both XP and a verified handle;
  -- the codes are decomposed so the message is honest (earn XP vs verify).
  -- level_ordinal is 1-indexed (L0=1, L1=2, L2=3...) — compare against
  -- level_ordinal('L2'), NOT a bare 2, so the verification gate applies to L2+
  -- only and L0/L1 missions stay XP-only.
  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'joined', 10)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_joined';
  end;
  update public.creators set xp = xp + 10 where id = v_creator;
  return v_sub;
end;
$$;

create or replace function public.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
begin
  -- A missing mission falls through so the shared body keeps raising 'not_found'.
  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;
  return private.join_mission(p_mission);
end;
$$;

create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_mode text;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',   -- fixed SLA; per-mission column lands with the S9 cron
    xp_awarded = xp_awarded + 25
    where id = v_sub.id
    returning * into v_sub;
  update public.creators set xp = xp + 25 where id = v_creator;
  return v_sub;
end;
$$;

create or replace function public.join_active_mission(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
begin
  v_submission := private.join_mission(p_mission);
  v_workflow := private.create_mission_workflow(v_submission.id);

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at
  )
  select
    v_workflow.workspace_id,
    v_workflow.id,
    v_submission.id,
    mission.id,
    mission.points_reward,
    coalesce(mission.cash_reward, 0),
    'HKD',
    0,
    'join',
    mission.updated_at
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = v_submission.workspace_id
  returning * into v_contract;

  if not found then
    raise exception 'reward_contract_source_missing';
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_submission),
    'workflow', to_jsonb(v_workflow),
    'rewardContract', to_jsonb(v_contract)
  );
end;
$$;

revoke all on function private.join_mission(uuid) from public, anon, authenticated, service_role;
revoke all on function public.join_mission(uuid)                  from public, anon;
revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
revoke all on function public.join_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_mission(uuid)                  to authenticated, service_role;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;
grant execute on function public.join_active_mission(uuid) to authenticated;

-- D. reward_pending is operator-owned; refresh must not recompute it ----------------------------
-- approve_mission_completion writes 'reward_pending' and cancel_mission_reward_handoff matches on
-- it (`state = v_expected_state`) before reverting to 'proof_verified'. The work-item derivation
-- below cannot produce 'reward_pending', so any refresh silently undid the approval and stranded
-- the pending reward. 'cancelled'/'expired' were already excluded for the same reason: they are
-- written by the lifecycle, never derived. Verbatim from 20260723090000 except that guard.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_required_count integer;
begin
  select workflow.* into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.id = p_workflow
    and (v_service or exists (
      select 1 from public.creators creator
      where creator.id = v_actor
        and creator.id = submission.creator_id
        and creator.workspace_id = workflow.workspace_id
    ))
  for update of workflow;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('reward_pending', 'cancelled', 'expired') then return v_workflow; end if;

  select count(*) into v_required_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = v_workflow.workspace_id
    and item.required;

  if exists (
    select 1 from public.mission_fulfillments fulfillment
    where fulfillment.mission_workflow_id = v_workflow.id
      and fulfillment.workspace_id = v_workflow.workspace_id
      and fulfillment.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif v_required_count > 0 and not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'proof_verified'
  ) then
    v_state := 'proof_verified';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state in (
        'proof_submitted', 'proof_under_review',
        'proof_correction_requested', 'proof_verified'
      )
  ) then
    v_state := 'publication_in_progress';
  elsif not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id and workspace_id = v_workflow.workspace_id
  returning * into v_workflow;
  return v_workflow;
end;
$$;

revoke all on function private.refresh_mission_workflow_state(uuid)
  from public, anon, authenticated, service_role;
-- The public wrapper stays creator-callable: it carries its own ownership check (a workflow the
-- caller does not own raises 'not_found'), and every state it can still derive comes from work
-- items the creator already drives through their own RPCs. The short-circuit above is what closes
-- the escalation, so revoking the wrapper would remove a granted capability without adding safety.
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;

-- E. a verified badge may not follow a handle to another account --------------------------------
-- 0012 grants column UPDATE on (handle, profile_url) and the self-update policy never looks at
-- owner_verified, so a creator could verify a throwaway account, repoint it at someone else's
-- handle, and keep the badge — permanently squatting that handle under the verified-handle unique
-- index. Clearing (rather than blocking) matches the flow: /verification then
-- /verification/confirm re-runs markVerified on the new handle, so re-verification still works.
-- handle_normalized is a stored generated column and is not populated in a BEFORE trigger, so the
-- comparison recomputes it with the generation expression from 0012.
create or replace function private.clear_social_account_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(regexp_replace(new.handle, '^@+', '')) is distinct from old.handle_normalized
     or new.profile_url is distinct from old.profile_url
  then
    new.owner_verified := false;
    new.verified_at := null;
    new.verification_code := null;
    new.verification_code_expires_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_social_account_verification()
  from public, anon, authenticated, service_role;

drop trigger if exists creator_social_accounts_clear_verification on public.creator_social_accounts;
create trigger creator_social_accounts_clear_verification
  before update of handle, profile_url on public.creator_social_accounts
  for each row when (old.owner_verified)
  execute function private.clear_social_account_verification();

-- F. creators never see an unpublished brief ----------------------------------------------------
-- routes/missions.ts filters status='active', but the policy did not, so the anon key plus a
-- session token read draft briefs, cash_reward, cpm_budget_pool and target-audience notes.
-- 'closed' stays readable: a creator must still open a mission they already engaged with.
-- The brand (missions_brand_select) and staff (service_role) read paths are untouched.
drop policy if exists missions_workspace on public.missions;
create policy missions_workspace on public.missions
  for select using (
    workspace_id = private.current_workspace_id()
    and status in ('active', 'closed')
  );
