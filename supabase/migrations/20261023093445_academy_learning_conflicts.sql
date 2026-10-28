-- D15 forward correction: domain conflicts are terminal HTTP 409, not retryable serialization failures.
-- The self-only Boolean wrapper crosses private-schema permissions without exposing schema usage.
begin;
alter function public.can_read_academy_track(uuid) security definer;
create or replace function public.complete_academy_lesson(p_track uuid,p_lesson uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_row public.creator_lesson_progress%rowtype;
begin
  -- Consistent lock order with author commands; a publish cannot swap versions mid-completion.
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  perform 1 from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version and status='published' for share;
  if not found then raise exception using errcode='PT409',message='version_changed'; end if;
  insert into public.creator_lesson_progress(creator_id,lesson_id,content_version)
  values(v_creator,p_lesson,p_version) on conflict (creator_id,lesson_id,content_version) do nothing;
  select * into strict v_row from public.creator_lesson_progress
    where creator_id=v_creator and lesson_id=p_lesson and content_version=p_version;
  return jsonb_build_object('lessonId',v_row.lesson_id,'contentVersion',v_row.content_version,'status',v_row.status,'completedAt',v_row.completed_at);
end;
$$;

create or replace function public.author_academy_lesson(p_staff uuid,p_track uuid,p_lesson uuid,p_version integer,p_revision integer,p_input jsonb,p_action text,p_approval_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.academy_lessons%rowtype; v_values jsonb; v_next integer;
begin
  if p_staff is null or not exists(select 1 from public.staff_users where user_id=p_staff and active) then
    raise exception using errcode='42501',message='staff_required';
  end if;
  perform 1 from public.academy_content where id=p_track and kind='track' for update;
  if not found then raise exception using errcode='P0002',message='track_not_found'; end if;
  if p_action is null or p_action not in ('save','publish','archive') or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception using errcode='22023',message='invalid_lesson_command';
  end if;
  if p_lesson is null then
    if p_action<>'save' then raise exception using errcode='22023',message='invalid_lesson_command'; end if;
    insert into public.academy_lessons(track_id,title_zh,title_en,body_zh,body_en,position)
      values(p_track,coalesce(p_input->>'title_zh',''),coalesce(p_input->>'title_en',''),coalesce(p_input->>'body_zh',''),coalesce(p_input->>'body_en',''),coalesce((p_input->>'position')::integer,0)) returning * into v;
    return to_jsonb(v);
  end if;
  select * into v from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version for update;
  if not found then raise exception using errcode='P0002',message='lesson_not_found'; end if;
  -- Exact publish replay is a no-op; it never reapproves or rewrites the snapshot.
  if p_action='publish' and v.status='published' and v.approval_ref=p_approval_ref and p_revision=v.revision-1 then return to_jsonb(v); end if;
  if p_revision is null or v.revision<>p_revision or v.status='archived' then
    raise exception using errcode='PT409',message='lesson_revision_conflict';
  end if;
  if p_action='save' then
    v_values:=to_jsonb(v)||p_input;
    if v.status='published' then
      if exists(select 1 from public.academy_lessons where id=p_lesson and status='draft') then
        raise exception using errcode='PT409',message='lesson_draft_exists';
      end if;
      select max(content_version)+1 into v_next from public.academy_lessons where id=p_lesson;
      insert into public.academy_lessons(id,content_version,track_id,title_zh,title_en,body_zh,body_en,position)
        values(p_lesson,v_next,p_track,v_values->>'title_zh',v_values->>'title_en',v_values->>'body_zh',v_values->>'body_en',(v_values->>'position')::integer) returning * into v;
    else
      update public.academy_lessons set title_zh=v_values->>'title_zh',title_en=v_values->>'title_en',body_zh=v_values->>'body_zh',body_en=v_values->>'body_en',position=(v_values->>'position')::integer,revision=revision+1,updated_at=clock_timestamp()
        where id=p_lesson and content_version=p_version returning * into v;
    end if;
  elsif p_action='publish' then
    if v.status<>'draft' or nullif(btrim(v.title_zh),'') is null or nullif(btrim(v.body_zh),'') is null or nullif(btrim(p_approval_ref),'') is null or length(p_approval_ref)>500 then
      raise exception using errcode='22023',message='approved_content_required';
    end if;
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp() where id=p_lesson and status='published';
    update public.academy_lessons set status='published',approval_ref=p_approval_ref,approved_by=p_staff,published_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  else
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;
notify pgrst,'reload schema';
commit;
