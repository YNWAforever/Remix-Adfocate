-- REVIEW ONLY: allow original connection deletion without deleting version reservations.
begin;
alter table private.controlled_pilot_provider_sources drop constraint controlled_pilot_provider_sou_connection_id_workspace_id_c_fkey;
alter table private.controlled_pilot_provider_sources alter column connection_id drop expression;
alter table private.controlled_pilot_provider_sources add constraint pilot_source_connection_owner_fk foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete set null(connection_id);
alter table private.controlled_pilot_provider_sources add constraint pilot_source_connection_binding check(connection_id is null or connection_id=(binding->>'connectionId')::uuid);
create function private.controlled_pilot_source_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin new.connection_id:=(new.binding->>'connectionId')::uuid;return new;end $$;
revoke all on function private.controlled_pilot_source_connection() from public,anon,authenticated,service_role;
create trigger controlled_pilot_source_connection before insert or update of binding on private.controlled_pilot_provider_sources for each row execute function private.controlled_pilot_source_connection();
create function private.controlled_pilot_connection_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.controlled_pilot_provider_sources set available=false where connection_id=old.id and workspace_id=old.workspace_id and creator_id=old.creator_id;
 return old;
end $$;
revoke all on function private.controlled_pilot_connection_delete() from public,anon,authenticated,service_role;
create trigger controlled_pilot_connection_delete before delete on public.integration_connections for each row execute function private.controlled_pilot_connection_delete();
commit;
