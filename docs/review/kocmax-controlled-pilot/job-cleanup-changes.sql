-- REVIEW ONLY. Preserve the original checkpoint FK and authoritative retention policy.
begin;
create function private.controlled_pilot_job_parent_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.state in ('container_preparing','provider_processing','publish_requested','outcome_unknown')
   and exists(select 1 from private.controlled_pilot_jobs where intent_id=old.id)
 then raise exception 'PILOT_RETENTION_HELD'; end if;
 -- Only the original terminal/unattempted intent deletion releases its worker row.
 -- Provider revision reservations survive through their existing SET NULL FK.
 delete from private.controlled_pilot_jobs where intent_id=old.id and workspace_id=old.workspace_id and creator_id=old.creator_id;
 return old;
end $$;
revoke all on function private.controlled_pilot_job_parent_delete() from public,anon,authenticated,service_role;
create trigger controlled_pilot_job_parent_delete before delete on private.creator_publish_intents for each row execute function private.controlled_pilot_job_parent_delete();
commit;
