-- REVIEW ONLY. Empty-extension rollback, never a cleanup command.
-- Stop admission/workers and preserve evidence before separately approved execution.
begin;
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
commit;
