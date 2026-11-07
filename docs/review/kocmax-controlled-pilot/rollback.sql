-- REVIEW DRAFT ONLY. Not authorized for remote execution.
-- Stop and drain workers first. Export and reconcile every job before any
-- separately approved cleanup. This rollback intentionally deletes no rows.
begin;
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
commit;
