-- REVIEW ONLY. Apply after the original publication schema, never from application startup.
begin;
create table private.controlled_pilot_media (
 reservation_id uuid primary key,
 intent_id uuid,
 workspace_id uuid not null,
 creator_id uuid not null,
 path text unique,
 expires_at timestamptz,
 closed boolean not null default false,
 jpeg bytea,
 foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete set null (intent_id),
 check(intent_id is null or intent_id=reservation_id),
 check (closed or (path is not null and expires_at is not null)),
 check (not closed or jpeg is null),
 check (jpeg is null or octet_length(jpeg) between 4 and 20971520)
);
alter table private.controlled_pilot_media enable row level security;
revoke all on private.controlled_pilot_media from public,anon,authenticated;
grant select,insert,update on private.controlled_pilot_media to service_role;
create function private.controlled_pilot_media_parent_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.controlled_pilot_media set closed=true,jpeg=null where reservation_id=old.id and workspace_id=old.workspace_id and creator_id=old.creator_id;
 return old;
end $$;
revoke all on function private.controlled_pilot_media_parent_delete() from public,anon,authenticated,service_role;
create trigger controlled_pilot_media_parent_delete before delete on private.creator_publish_intents for each row execute function private.controlled_pilot_media_parent_delete();
-- No redundant index: PK supports intent fencing; unique path supports media fetch.
commit;
