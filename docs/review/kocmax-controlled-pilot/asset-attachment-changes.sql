-- REVIEW ONLY. Preserve finalized bytes while allowing original submit RPC to
-- attach a ready, unversioned asset exactly once to its owner's new version.
begin;
create or replace function private.guard_finalized_mission_asset()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.upload_state='ready' and old.mission_draft_version_id is null
 and old.deleted_at is null and new.mission_draft_version_id is not null
 and (to_jsonb(new)-array['mission_draft_version_id','retained_at'])=(to_jsonb(old)-array['mission_draft_version_id','retained_at'])
 and exists(
  select 1 from public.mission_draft_versions v
  join public.mission_work_items i on i.id=v.mission_work_item_id and i.workspace_id=v.workspace_id
  join public.mission_workflows f on f.id=i.mission_workflow_id and f.workspace_id=i.workspace_id
  join public.mission_submissions s on s.id=f.mission_submission_id and s.workspace_id=f.workspace_id
  where v.id=new.mission_draft_version_id and v.workspace_id=old.workspace_id
  and v.mission_work_item_id=old.mission_work_item_id and v.submitted_by=old.creator_id
  and s.creator_id=old.creator_id and f.id=old.mission_workflow_id
  and i.state in ('drafting','revision_requested') and v.submission_idempotency_key is not null
 ) then return new;end if;
 if old.mission_draft_version_id is not null or old.upload_state='ready' then
  if tg_op='DELETE' then raise exception 'immutable_record';end if;
  if (to_jsonb(new)-array['retained_at','deleted_at']) is distinct from (to_jsonb(old)-array['retained_at','deleted_at']) then raise exception 'immutable_record';end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
commit;
