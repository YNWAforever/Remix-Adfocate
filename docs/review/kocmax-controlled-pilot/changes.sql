-- REVIEW DRAFT ONLY: tested in PGlite; not registered/applied remotely.
-- Additive worker checkpoint extension of the existing publish intent, NOT a new publish state machine.
begin;
create table private.controlled_pilot_jobs (
 intent_id uuid primary key,
 workspace_id uuid not null,
 creator_id uuid not null,
 stage text not null default 'queued' check(stage in ('queued','before_create','container_known','before_publish','media_known','receipt_known')),
 read_attempts integer not null default 0 check(read_attempts between 0 and 5),
 next_read_at timestamptz,
 fence integer not null default 0 check(fence>=0),
 worker_id text check(length(worker_id) between 1 and 128),
 lease_until timestamptz,
 container_id text check(container_id ~ '^[1-9][0-9]{0,63}$'),
 media_id text check(media_id ~ '^[1-9][0-9]{0,63}$'),
 foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete restrict,
 check((worker_id is null)=(lease_until is null)),
 check(stage not in ('container_known','before_publish','media_known','receipt_known') or container_id is not null),
 check(stage not in ('media_known','receipt_known') or media_id is not null)
);
alter table private.controlled_pilot_jobs enable row level security;
revoke all on private.controlled_pilot_jobs from public,anon,authenticated,service_role;
grant select,insert,update on private.controlled_pilot_jobs to service_role;
-- Primary key covers intent lookup/FK prefix; do not add a redundant intent_id index.
create index controlled_pilot_jobs_pending on private.controlled_pilot_jobs(lease_until,intent_id) where stage<>'receipt_known';
commit;
