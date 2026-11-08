-- REVIEW ONLY: restore the original guard after stopping pilot writes.
begin;
create or replace function private.guard_finalized_mission_asset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.mission_draft_version_id is not null or old.upload_state = 'ready' then
    if tg_op = 'DELETE' then raise exception 'immutable_record'; end if;
    if (to_jsonb(new) - array['retained_at', 'deleted_at'])
       is distinct from
       (to_jsonb(old) - array['retained_at', 'deleted_at']) then
      raise exception 'immutable_record';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


commit;

