-- Atomically author a mission, its active-workflow policy, deliverable templates,
-- and nested checklist requirements. The server is the only caller.

alter table public.mission_deliverable_templates
  alter column platform drop not null;
alter table public.mission_work_items
  alter column platform drop not null;


create or replace function private.author_mission_workflow(
  p_mission_id uuid,
  p_mission jsonb,
  p_policy jsonb,
  p_templates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_write public.missions;
  v_template_json jsonb;
  v_requirement_json jsonb;
  v_template_id uuid;
  v_requirement_id uuid;
  v_keep_templates uuid[] := '{}'::uuid[];
  v_keep_requirements uuid[];
  v_removed_templates uuid[];
  v_result jsonb;
begin
  if jsonb_typeof(p_mission) <> 'object'
    or jsonb_typeof(p_policy) <> 'object'
    or jsonb_typeof(p_templates) <> 'array'
  then
    raise exception 'invalid_mission_authoring_payload';
  end if;

  if coalesce(p_policy->>'creator_workflow_mode', '') not in ('legacy', 'active_workspace')
    or jsonb_typeof(p_policy->'fulfillment_required') <> 'boolean'
    or (p_policy->>'revision_limit')::integer < 0
    or (p_policy->>'review_sla_hours')::integer <= 0
    or (p_policy->>'revision_response_hours')::integer <= 0
  then
    raise exception 'invalid_mission_workflow_policy';
  end if;

  if p_policy->>'creator_workflow_mode' = 'active_workspace'
    and not exists (
      select 1 from jsonb_array_elements(p_templates) template
      where template->>'required' = 'true'
    )
  then
    raise exception 'active_mission_requires_deliverable';
  end if;

  if p_mission_id is null then
    v_write := jsonb_populate_record(null::public.missions, p_mission || p_policy);
    insert into public.missions (
      workspace_id, slug, title, mission_type, description, category, access_type,
      required_level, points_reward, cash_reward, cpm_rate, cpm_budget_pool,
      deadline, quota, deliverables, requirements, platforms, effort, status,
      target_audience, dos, donts, key_messages, reference_links,
      creator_workflow_mode, fulfillment_required, revision_limit,
      review_sla_hours, revision_response_hours
    ) values (
      v_write.workspace_id, v_write.slug, v_write.title, v_write.mission_type,
      v_write.description, v_write.category, coalesce(v_write.access_type, 'open'),
      coalesce(v_write.required_level, 'L0'), coalesce(v_write.points_reward, 0),
      v_write.cash_reward, v_write.cpm_rate, v_write.cpm_budget_pool,
      v_write.deadline, coalesce(v_write.quota, 10), coalesce(v_write.deliverables, '{}'::text[]),
      coalesce(v_write.requirements, '{}'::text[]), coalesce(v_write.platforms, '{}'::text[]),
      v_write.effort, 'draft', v_write.target_audience, coalesce(v_write.dos, '{}'::text[]),
      coalesce(v_write.donts, '{}'::text[]), coalesce(v_write.key_messages, '{}'::text[]),
      coalesce(v_write.reference_links, '{}'::text[]),
      v_write.creator_workflow_mode, v_write.fulfillment_required, v_write.revision_limit,
      v_write.review_sla_hours, v_write.revision_response_hours
    ) returning * into v_mission;
  else
    select * into v_mission
    from public.missions
    where id = p_mission_id
    for update;
    if not found then raise exception 'mission_not_found'; end if;

    v_write := jsonb_populate_record(v_mission, p_mission || p_policy);
    update public.missions set
      slug = v_write.slug,
      title = v_write.title,
      mission_type = v_write.mission_type,
      description = v_write.description,
      category = v_write.category,
      access_type = v_write.access_type,
      required_level = v_write.required_level,
      points_reward = v_write.points_reward,
      cash_reward = v_write.cash_reward,
      cpm_rate = v_write.cpm_rate,
      cpm_budget_pool = v_write.cpm_budget_pool,
      deadline = v_write.deadline,
      quota = v_write.quota,
      deliverables = v_write.deliverables,
      requirements = v_write.requirements,
      platforms = v_write.platforms,
      effort = v_write.effort,
      target_audience = v_write.target_audience,
      dos = v_write.dos,
      donts = v_write.donts,
      key_messages = v_write.key_messages,
      reference_links = v_write.reference_links,
      creator_workflow_mode = v_write.creator_workflow_mode,
      fulfillment_required = v_write.fulfillment_required,
      revision_limit = v_write.revision_limit,
      review_sla_hours = v_write.review_sla_hours,
      revision_response_hours = v_write.revision_response_hours,
      updated_at = now()
    where id = v_mission.id
    returning * into v_mission;
  end if;

  perform 1
  from public.mission_deliverable_templates
  where mission_id = v_mission.id
  for update;

  select coalesce(array_agg((template->>'id')::uuid), '{}'::uuid[])
  into v_keep_templates
  from jsonb_array_elements(p_templates) template
  where template ? 'id';

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_removed_templates
  from public.mission_deliverable_templates
  where mission_id = v_mission.id
    and not (id = any(v_keep_templates));

  if cardinality(v_removed_templates) > 0 then
    perform 1
    from public.mission_work_items
    where source_template_id = any(v_removed_templates)
    for update;
    if found then raise exception 'mission_template_snapshotted'; end if;
  end if;

  -- Move current positions out of the incoming range before supporting reorder.
  update public.mission_deliverable_templates
  set position = position + 1000000
  where mission_id = v_mission.id;

  for v_template_json in select value from jsonb_array_elements(p_templates)
  loop
    if v_template_json ? 'id' then
      v_template_id := (v_template_json->>'id')::uuid;
      if not exists (
        select 1 from public.mission_deliverable_templates
        where id = v_template_id and mission_id = v_mission.id and workspace_id = v_mission.workspace_id
      ) then raise exception 'mission_template_not_found'; end if;

      update public.mission_deliverable_templates set
        title = btrim(v_template_json->>'title'),
        platform = nullif(btrim(v_template_json->>'platform'), ''),
        position = (v_template_json->>'position')::integer,
        required = (v_template_json->>'required')::boolean,
        draft_due_offset_hours = (v_template_json->>'draft_due_offset_hours')::integer,
        updated_at = now()
      where id = v_template_id;
    else
      insert into public.mission_deliverable_templates (
        workspace_id, mission_id, title, platform, position, required, draft_due_offset_hours
      ) values (
        v_mission.workspace_id, v_mission.id, btrim(v_template_json->>'title'),
        nullif(btrim(v_template_json->>'platform'), ''),
        (v_template_json->>'position')::integer,
        (v_template_json->>'required')::boolean,
        (v_template_json->>'draft_due_offset_hours')::integer
      ) returning id into v_template_id;
    end if;

    v_keep_templates := array_append(v_keep_templates, v_template_id);

    update public.mission_deliverable_requirements
    set position = position + 1000000
    where mission_deliverable_template_id = v_template_id;

    select coalesce(array_agg((requirement->>'id')::uuid), '{}'::uuid[])
    into v_keep_requirements
    from jsonb_array_elements(v_template_json->'requirements') requirement
    where requirement ? 'id';

    for v_requirement_json in select value from jsonb_array_elements(v_template_json->'requirements')
    loop
      if v_requirement_json ? 'id' then
        v_requirement_id := (v_requirement_json->>'id')::uuid;
        if not exists (
          select 1 from public.mission_deliverable_requirements
          where id = v_requirement_id
            and mission_deliverable_template_id = v_template_id
            and workspace_id = v_mission.workspace_id
        ) then raise exception 'mission_requirement_not_found'; end if;

        update public.mission_deliverable_requirements set
          category = v_requirement_json->>'category',
          requirement_text = btrim(v_requirement_json->>'text'),
          required = (v_requirement_json->>'required')::boolean,
          position = (v_requirement_json->>'position')::integer
        where id = v_requirement_id;
      else
        insert into public.mission_deliverable_requirements (
          workspace_id, mission_deliverable_template_id, category,
          requirement_text, required, position
        ) values (
          v_mission.workspace_id, v_template_id, v_requirement_json->>'category',
          btrim(v_requirement_json->>'text'),
          (v_requirement_json->>'required')::boolean,
          (v_requirement_json->>'position')::integer
        ) returning id into v_requirement_id;
      end if;

      v_keep_requirements := array_append(v_keep_requirements, v_requirement_id);
    end loop;

    delete from public.mission_deliverable_requirements
    where mission_deliverable_template_id = v_template_id
      and not (id = any(v_keep_requirements));
  end loop;

  delete from public.mission_deliverable_templates
  where mission_id = v_mission.id
    and not (id = any(v_keep_templates));

  select to_jsonb(mission_row) || jsonb_build_object(
    'deliverable_templates', coalesce((
      select jsonb_agg(
        to_jsonb(template_row) - 'workspace_id' - 'mission_id' - 'created_at' - 'updated_at'
        || jsonb_build_object('requirements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', requirement_row.id,
            'category', requirement_row.category,
            'text', requirement_row.requirement_text,
            'required', requirement_row.required,
            'position', requirement_row.position
          ) order by requirement_row.position)
          from public.mission_deliverable_requirements requirement_row
          where requirement_row.mission_deliverable_template_id = template_row.id
        ), '[]'::jsonb))
        order by template_row.position
      )
      from public.mission_deliverable_templates template_row
      where template_row.mission_id = mission_row.id
    ), '[]'::jsonb)
  ) into v_result
  from public.missions mission_row
  where mission_row.id = v_mission.id;

  return v_result;
end;
$$;

create or replace function public.author_mission_workflow(
  p_mission_id uuid,
  p_mission jsonb,
  p_policy jsonb,
  p_templates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.author_mission_workflow(p_mission_id, p_mission, p_policy, p_templates);
end;
$$;

revoke all on function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  to service_role;
