-- Apply the mission_shortlists workspace guard as a follow-up migration so
-- databases that already ran 0013 receive the trigger too.

create or replace function private.validate_mission_shortlist_workspace()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  mission_workspace uuid;
  creator_workspace uuid;
begin
  select workspace_id into mission_workspace
  from public.missions
  where id = new.mission_id;

  select workspace_id into creator_workspace
  from public.creators
  where id = new.creator_id;

  if mission_workspace is null or creator_workspace is null then
    return new;
  end if;

  if mission_workspace <> creator_workspace or new.workspace_id <> mission_workspace then
    raise exception 'mission_shortlists workspace mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists mission_shortlists_validate_workspace on public.mission_shortlists;

create trigger mission_shortlists_validate_workspace
  before insert or update on public.mission_shortlists
  for each row execute function private.validate_mission_shortlist_workspace();
