-- REVIEW ONLY. Restore original restrictive checkpoint retention.
begin;
drop trigger controlled_pilot_job_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_job_parent_delete();
commit;
