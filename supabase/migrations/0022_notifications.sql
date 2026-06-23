-- N1: per-creator notifications. Rows are created ONLY by the SECURITY DEFINER
-- triggers below (creators never insert); creators may read their own rows and flip
-- read_at. Display text is rendered at read-time in TS — the DB stores only type + data.

-- 1. Table ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.creators(id) on delete cascade,  -- = auth.uid()
  workspace_id uuid not null references public.workspaces(id),
  type         text not null check (type in (
                 'submission_approved','submission_rejected','redemption_ready',
                 'level_up','application_accepted','application_declined')),
  entity_type  text,
  entity_id    uuid,
  data         jsonb not null default '{}',
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx  on public.notifications (user_id) where read_at is null;

-- 2. RLS + grants: read own; flip only read_at; NO insert grant (triggers insert) -
alter table public.notifications enable row level security;
create policy notifications_self_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_self_mark_read on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- 3. Trigger: submission + application status transitions ----------------------
create or replace function public.notify_on_submission_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_mission record;
  v_data jsonb;
begin
  if    old.status = 'applied' and new.status = 'joined'   then v_type := 'application_accepted';
  elsif old.status = 'applied' and new.status = 'declined' then v_type := 'application_declined';
  elsif old.status in ('submitted','under_review') and new.status = 'approved' then v_type := 'submission_approved';
  elsif old.status in ('submitted','under_review') and new.status = 'rejected' then v_type := 'submission_rejected';
  else return new;  -- not a notable transition
  end if;

  begin
    select title, slug into v_mission from public.missions where id = new.mission_id;
    v_data := jsonb_build_object('mission_title', coalesce(v_mission.title, ''),
                                 'mission_slug',  coalesce(v_mission.slug, ''));
    if v_type = 'submission_approved' then
      v_data := v_data || jsonb_build_object('points', new.points_awarded - old.points_awarded,
                                             'xp',     new.xp_awarded - old.xp_awarded);
    elsif v_type = 'submission_rejected' then
      v_data := v_data || jsonb_build_object('reason', coalesce(new.reviewer_notes, ''));
    elsif v_type = 'application_declined' then
      v_data := v_data || jsonb_build_object('notes', coalesce(new.reviewer_notes, ''));
    end if;

    insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
      values (new.creator_id, new.workspace_id, v_type, 'mission_submission', new.id, v_data);
  exception when others then
    null;  -- notifications are best-effort; NEVER roll back the earn loop
  end;
  return new;
end;
$$;

create trigger notifications_on_submission_change
  after update of status on public.mission_submissions
  for each row execute function public.notify_on_submission_change();

-- 4. Trigger: level-up (fires on xp change; emits only when level actually rises) -
create or replace function public.notify_on_level_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level is distinct from old.level and new.xp > old.xp then
    begin
      insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
        values (new.id, new.workspace_id, 'level_up', 'creator', new.id,
                jsonb_build_object('level', new.level));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create trigger notifications_on_level_up
  after update of xp on public.creators
  for each row execute function public.notify_on_level_up();

-- 5. Trigger: redemption fulfilled --------------------------------------------
create or replace function public.notify_on_redemption() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'fulfilled' then
    begin
      select name into v_name from public.redemption_gifts where id = new.gift_id;
      insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
        values (new.creator_id, new.workspace_id, 'redemption_ready', 'redemption', new.id,
                jsonb_build_object('gift_name', coalesce(v_name, '')));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create trigger notifications_on_redemption
  after insert on public.redemptions
  for each row execute function public.notify_on_redemption();
