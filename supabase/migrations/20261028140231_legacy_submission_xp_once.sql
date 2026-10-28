-- Evidence correction reopens an already submitted legacy row. Preserve its
-- original submission XP when the Creator supplies corrected evidence.
-- No historical migration, row, correction receipt or reward is rewritten.
begin;

create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator uuid := auth.uid();
  v_mode text;
  v_sub public.mission_submissions;
  v_submission_xp integer;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  v_submission_xp := case when exists (
    select 1 from public.legacy_evidence_corrections
    where submission_id = v_sub.id and workspace_id = v_sub.workspace_id
  ) then 0 else 25 end;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',
    xp_awarded = xp_awarded + v_submission_xp
    where id = v_sub.id
    returning * into v_sub;
  if v_submission_xp > 0 then
    update public.creators set xp = xp + v_submission_xp where id = v_creator;
  end if;
  return v_sub;
end;
$$;

revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;

commit;
