-- D15: versioned lesson content and self-only progress. No content seed, XP or reward writes.
begin;

create table public.academy_lessons (
  id uuid not null default gen_random_uuid(),
  content_version integer not null default 1 check (content_version > 0),
  track_id uuid not null references public.academy_content(id) on delete restrict,
  title_zh text not null default '' check (length(title_zh) <= 200),
  title_en text not null default '' check (length(title_en) <= 200),
  body_zh text not null default '' check (length(body_zh) <= 50000),
  body_en text not null default '' check (length(body_en) <= 50000),
  position integer not null default 0 check (position between 0 and 10000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  revision integer not null default 1 check (revision > 0),
  approval_ref text check (length(approval_ref) between 1 and 500),
  approved_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, content_version),
  constraint academy_lesson_published_content check (status <> 'published' or
    (nullif(btrim(title_zh),'') is not null and nullif(btrim(body_zh),'') is not null
     and approval_ref is not null and approved_by is not null and published_at is not null))
);
create unique index academy_lesson_one_published on public.academy_lessons(id) where status='published';
create unique index academy_lesson_one_draft on public.academy_lessons(id) where status='draft';
create index academy_lessons_track_order on public.academy_lessons(track_id,status,position,id);

create table public.creator_lesson_progress (
  creator_id uuid not null references public.creators(id) on delete restrict,
  lesson_id uuid not null,
  content_version integer not null,
  status text not null default 'completed' check (status='completed'),
  completed_at timestamptz not null default now(),
  primary key (creator_id,lesson_id,content_version),
  foreign key (lesson_id,content_version) references public.academy_lessons(id,content_version) on delete restrict
);
create index creator_lesson_progress_lesson on public.creator_lesson_progress(lesson_id,content_version);
alter table public.academy_lessons enable row level security;
alter table public.creator_lesson_progress enable row level security;
revoke all on public.academy_lessons,public.creator_lesson_progress from public,anon,authenticated,service_role;
grant select on public.academy_lessons,public.creator_lesson_progress to authenticated,service_role;

-- Reuse the existing raw-level ordinal and verified-owner trust authority.
create function private.can_read_academy_track(p_track uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.academy_content t join public.creators c on c.id=(select auth.uid())
    where t.id=p_track and t.kind='track' and t.status='published'
      and coalesce(t.required_level,'L0') in ('L0','L1','L2','L3','L4','L5','L6')
      and public.level_ordinal(c.level)>=public.level_ordinal(coalesce(t.required_level,'L0'))
      and (public.level_ordinal(coalesce(t.required_level,'L0'))<public.level_ordinal('L2')
        or private.creator_is_trusted(c.id))
  );
$$;
revoke all on function private.can_read_academy_track(uuid) from public,anon,service_role;
grant execute on function private.can_read_academy_track(uuid) to authenticated;
create function public.can_read_academy_track(p_track uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select private.can_read_academy_track(p_track); $$;
revoke all on function public.can_read_academy_track(uuid) from public,anon,service_role;
grant execute on function public.can_read_academy_track(uuid) to authenticated;
create policy academy_lessons_published_eligible on public.academy_lessons for select to authenticated
using (status='published' and private.can_read_academy_track(track_id));
create policy creator_lesson_progress_self on public.creator_lesson_progress for select to authenticated
using (creator_id=(select auth.uid()));

create function private.guard_academy_lesson_history() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status in ('published','archived') and
    (row(new.id,new.content_version,new.track_id,new.title_zh,new.title_en,new.body_zh,new.body_en,new.position,new.approval_ref,new.approved_by,new.published_at)
     is distinct from row(old.id,old.content_version,old.track_id,old.title_zh,old.title_en,old.body_zh,old.body_en,old.position,old.approval_ref,old.approved_by,old.published_at)
     or new.status not in ('published','archived') or (old.status='archived' and new.status<>'archived')) then
    raise exception using errcode='23514',message='published_lesson_immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_academy_lesson_history() from public,anon,authenticated,service_role;
create trigger academy_lesson_history_guard before update on public.academy_lessons
for each row execute function private.guard_academy_lesson_history();

create function public.complete_academy_lesson(p_track uuid,p_lesson uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_row public.creator_lesson_progress%rowtype;
begin
  -- Consistent lock order with author commands; a publish cannot swap versions mid-completion.
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  perform 1 from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version and status='published' for share;
  if not found then raise exception using errcode='40001',message='version_changed'; end if;
  insert into public.creator_lesson_progress(creator_id,lesson_id,content_version)
  values(v_creator,p_lesson,p_version) on conflict (creator_id,lesson_id,content_version) do nothing;
  select * into strict v_row from public.creator_lesson_progress
    where creator_id=v_creator and lesson_id=p_lesson and content_version=p_version;
  return jsonb_build_object('lessonId',v_row.lesson_id,'contentVersion',v_row.content_version,'status',v_row.status,'completedAt',v_row.completed_at);
end;
$$;
revoke all on function public.complete_academy_lesson(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.complete_academy_lesson(uuid,uuid,integer) to authenticated;

create function public.get_academy_learning(p_track uuid,p_lang text default 'zh-HK') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_lessons jsonb; v_history jsonb; v_total integer; v_completed integer;
begin
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'trackId',l.track_id,'contentVersion',l.content_version,'status',l.status,'position',l.position,
    'title',case when p_lang='en' and l.title_en<>'' then l.title_en else l.title_zh end,
    'body',case when p_lang='en' and l.body_en<>'' then l.body_en else l.body_zh end,
    'completed',p.creator_id is not null,'completedAt',p.completed_at) order by l.position,l.id),'[]'::jsonb),
    count(*),count(p.creator_id) into v_lessons,v_total,v_completed
  from public.academy_lessons l left join public.creator_lesson_progress p
    on p.lesson_id=l.id and p.content_version=l.content_version and p.creator_id=v_creator
  where l.track_id=p_track and l.status='published';
  select coalesce(jsonb_agg(jsonb_build_object('lessonId',p.lesson_id,'contentVersion',p.content_version,'completedAt',p.completed_at)
    order by p.completed_at,p.lesson_id,p.content_version),'[]'::jsonb) into v_history
  from public.creator_lesson_progress p join public.academy_lessons l on l.id=p.lesson_id and l.content_version=p.content_version
  where p.creator_id=v_creator and l.track_id=p_track;
  return jsonb_build_object('lessons',v_lessons,'progress',jsonb_build_object('completed',v_completed,'total',v_total),'history',v_history);
end;
$$;
revoke all on function public.get_academy_learning(uuid,text) from public,anon,service_role;
grant execute on function public.get_academy_learning(uuid,text) to authenticated;

-- Service-only command; the API supplies its authenticated human staff identity.
-- Parent row lock serializes edits/publish, revision checks reject stale drafts.
create function public.author_academy_lesson(p_staff uuid,p_track uuid,p_lesson uuid,p_version integer,p_revision integer,p_input jsonb,p_action text,p_approval_ref text)
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
    raise exception using errcode='40001',message='lesson_revision_conflict';
  end if;
  if p_action='save' then
    v_values:=to_jsonb(v)||p_input;
    if v.status='published' then
      if exists(select 1 from public.academy_lessons where id=p_lesson and status='draft') then
        raise exception using errcode='40001',message='lesson_draft_exists';
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
revoke all on function public.author_academy_lesson(uuid,uuid,uuid,integer,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.author_academy_lesson(uuid,uuid,uuid,integer,integer,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
