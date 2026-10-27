begin;
create function public.list_creator_review_queue_page(
  p_workspace uuid, p_operator uuid, p_mission uuid default null, p_query text default '',
  p_status text default null, p_risk text default null, p_sort text default 'last_activity', p_page integer default 1
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.staff_users where user_id = p_operator and active)
    or not exists (select 1 from public.brand_users where user_id = p_operator and workspace_id = p_workspace and active) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_mission is not null and not exists (select 1 from public.missions where id = p_mission and workspace_id = p_workspace) then
    raise exception using errcode = 'P0002', message = 'mission_not_found';
  end if;
  if p_page is null or p_page < 1 or p_page > 1000000 or char_length(p_query) > 200
    or p_sort not in ('last_activity', 'trust_score', 'level', 'social_freshness')
    or (p_status is not null and p_status not in ('needs_review', 'approved', 'flagged'))
    or (p_risk is not null and p_risk not in ('low', 'medium', 'high', 'unknown')) then
    raise exception using errcode = '22023', message = 'invalid_command';
  end if;
  with filtered as (
    select c.id, coalesce(r.status, 'needs_review') as review_status,
      greatest(c.created_at, r.updated_at, social.synced_at, shortlist.updated_at) as activity_at,
      social.synced_at, coalesce(trust.score, -1) as trust_score,
      case when c.level ~* '^L?[0-9]+$' then regexp_replace(c.level, '^[Ll]', '')::integer else -1 end as level_rank
    from public.creators c
    left join public.creator_review_statuses r on r.creator_id = c.id and r.workspace_id = p_workspace
    left join lateral (select max(s.api_synced_at) synced_at from public.creator_social_accounts s
      where s.creator_id = c.id and s.sync_status = 'synced') social on true
    left join lateral (select max(s.updated_at) updated_at from public.mission_shortlists s
      where s.creator_id = c.id and s.workspace_id = p_workspace and (p_mission is null or s.mission_id = p_mission)) shortlist on true
    left join lateral (select avg((value::text)::numeric) score from jsonb_each(coalesce(c.scores, '{}'::jsonb)) where jsonb_typeof(value) = 'number') trust on true
    where c.workspace_id = p_workspace
      and (coalesce(p_query, '') = '' or strpos(lower(coalesce(c.display_name, '')), lower(p_query)) > 0)
      and (p_status is null or coalesce(r.status, 'needs_review') = p_status)
      and (p_risk is null or coalesce(r.risk_level, 'unknown') = p_risk)
      and not (p_mission is not null and p_status is null and coalesce(r.status, 'needs_review') = 'flagged')
  ), ordered as (
    select id, row_number() over(order by
      case when p_mission is not null and review_status = 'approved' then 0 else 1 end,
      case when p_sort = 'last_activity' then activity_at end desc nulls last,
      case when p_sort = 'social_freshness' then synced_at end desc nulls last,
      case when p_sort = 'trust_score' then trust_score end desc nulls last,
      case when p_sort = 'level' then level_rank end desc nulls last, id) as rank
    from filtered
  ), page as (select id, rank from ordered order by rank limit 25 offset (p_page::bigint - 1) * 25)
  select jsonb_build_object('creatorIds', coalesce((select jsonb_agg(id order by rank) from page), '[]'::jsonb),
    'total', (select count(*) from filtered), 'page', p_page, 'pageSize', 25) into v_result;
  return v_result;
end;
$$;
revoke all on function public.list_creator_review_queue_page(uuid,uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.list_creator_review_queue_page(uuid,uuid,uuid,text,text,text,text,integer) to service_role;
create index creators_workspace_id_page_idx on public.creators(workspace_id, id);
commit;
