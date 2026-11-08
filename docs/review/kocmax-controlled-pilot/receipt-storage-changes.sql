-- REVIEW ONLY. Private immutable receipt snapshot; no browser grants or alternate rewards.
begin;
create table private.controlled_pilot_receipts (
 reservation_id uuid primary key,intent_id uuid,workspace_id uuid not null,creator_id uuid not null,
 snapshot jsonb, snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 retained_until timestamptz not null,
 foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete set null (intent_id),
 check(intent_id is null or intent_id=reservation_id),
 check(snapshot is null or octet_length(snapshot::text)<=65536)
);
alter table private.controlled_pilot_receipts enable row level security;
revoke all on private.controlled_pilot_receipts from public,anon,authenticated;
grant select,insert,update on private.controlled_pilot_receipts to service_role;
create function private.controlled_pilot_receipt_parent_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.controlled_pilot_receipts set snapshot=null where reservation_id=old.id and workspace_id=old.workspace_id and creator_id=old.creator_id;
 return old;
end $$;
revoke all on function private.controlled_pilot_receipt_parent_delete() from public,anon,authenticated,service_role;
create trigger controlled_pilot_receipt_parent_delete before delete on private.creator_publish_intents for each row execute function private.controlled_pilot_receipt_parent_delete();
-- PK is sufficient for owner-qualified intent lookup; no duplicate index.
commit;
