-- REVIEW ONLY: empty-only rollback. Unknowns and retained reservations block removal.
begin;
-- Source: provider-retention-rollback.sql

lock table private.controlled_pilot_provider_sources in access exclusive mode;
do $$ begin if exists(select 1 from private.controlled_pilot_provider_sources) then raise exception 'pilot_sources_not_empty';end if;end $$;
drop trigger controlled_pilot_connection_delete on public.integration_connections;
drop function private.controlled_pilot_connection_delete();
drop trigger controlled_pilot_source_connection on private.controlled_pilot_provider_sources;
drop function private.controlled_pilot_source_connection();
alter table private.controlled_pilot_provider_sources drop constraint pilot_source_connection_owner_fk;
alter table private.controlled_pilot_provider_sources drop constraint pilot_source_connection_binding;
alter table private.controlled_pilot_provider_sources drop column connection_id;
alter table private.controlled_pilot_provider_sources add column connection_id uuid generated always as ((binding->>'connectionId')::uuid) stored;
alter table private.controlled_pilot_provider_sources add foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id);

-- Source: job-cleanup-rollback.sql
-- REVIEW ONLY. Restore original restrictive checkpoint retention.

drop trigger controlled_pilot_job_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_job_parent_delete();

-- Source: receipt-storage-rollback.sql

lock table private.controlled_pilot_receipts in access exclusive mode;
do $$ begin
 if exists(select 1 from private.controlled_pilot_receipts) then raise exception 'pilot_receipts_not_empty'; end if;
end $$;
drop trigger controlled_pilot_receipt_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_receipt_parent_delete();
drop table private.controlled_pilot_receipts;

-- Source: media-storage-rollback.sql
-- REVIEW ONLY. Never erase lifetime reservations or unknown evidence to make rollback pass.

lock table private.controlled_pilot_media in access exclusive mode;
do $$ begin
 if exists(select 1 from private.controlled_pilot_media) then raise exception 'pilot_media_not_empty'; end if;
end $$;
drop trigger controlled_pilot_media_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_media_parent_delete();
drop table private.controlled_pilot_media;

-- Source: provider-rollback.sql
-- REVIEW ONLY. Empty-extension rollback, never a cleanup command.
-- Stop admission/workers and preserve evidence before separately approved execution.

lock table private.controlled_pilot_provider_sources,private.controlled_pilot_provider_approvals,
 private.controlled_pilot_provider_revisions,private.creator_publish_intents in access exclusive mode;
do $$ begin
 if exists(select 1 from private.controlled_pilot_provider_sources)
 or exists(select 1 from private.controlled_pilot_provider_approvals)
 or exists(select 1 from private.controlled_pilot_provider_revisions)
 or exists(select 1 from private.creator_publish_intents where binding ? 'missionBasis')
 then raise exception 'PILOT_ROLLBACK_NOT_EMPTY';end if;
end $$;
drop function public.creator_pilot_provider_command(uuid,uuid,text,jsonb,timestamptz);
drop function private.creator_publish_authority(uuid,uuid,jsonb,timestamptz);
drop table private.controlled_pilot_provider_approvals;
drop table private.controlled_pilot_provider_revisions;
drop table private.controlled_pilot_provider_sources;
alter table private.creator_publish_intents drop constraint creator_publish_intents_binding_check;
drop function private.creator_publish_binding(jsonb);
alter function private.creator_publish_provider_legacy_binding(jsonb) rename to creator_publish_binding;
alter function private.creator_publish_provider_legacy_authority(uuid,uuid,jsonb,timestamptz) rename to creator_publish_authority;
alter table private.creator_publish_intents add constraint creator_publish_intents_binding_check check(private.creator_publish_binding(binding));

-- Source: rollback.sql
-- REVIEW DRAFT ONLY. Not authorized for remote execution.
-- Stop and drain workers first. Export and reconcile every job before any
-- separately approved cleanup. This rollback intentionally deletes no rows.

lock table private.controlled_pilot_jobs in access exclusive mode;
do $$
begin
  if exists(select 1 from private.controlled_pilot_jobs) then
    raise exception 'PILOT_ROLLBACK_REQUIRES_EMPTY_JOBS';
  end if;
end;
$$;
-- RESTRICT is intentional: unexpected dependencies must stop rollback.
drop table private.controlled_pilot_jobs restrict;

-- Source: asset-attachment-rollback.sql
-- REVIEW ONLY: restore the original guard after stopping pilot writes.

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
