-- Harden the tenant-lookup helper: move it out of the PostgREST-exposed
-- `public` schema into `private` so it has no `/rest/v1/rpc` endpoint, while
-- RLS policies (run by the `authenticated` role) can still call it.

create schema if not exists private;

create or replace function private.current_workspace_id() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.creators where id = auth.uid() limit 1
$$;

revoke all on function private.current_workspace_id() from public;
revoke all on function private.current_workspace_id() from anon;
grant usage on schema private to authenticated;
grant execute on function private.current_workspace_id() to authenticated;

-- Repoint the workspace-scoped policies to the private helper.
drop policy missions_workspace on public.missions;
create policy missions_workspace on public.missions
  for select using (workspace_id = private.current_workspace_id());

drop policy gifts_workspace on public.redemption_gifts;
create policy gifts_workspace on public.redemption_gifts
  for select using (workspace_id = private.current_workspace_id());

drop policy workspace_self on public.workspaces;
create policy workspace_self on public.workspaces
  for select using (id = private.current_workspace_id());

-- Remove the public (RPC-exposed) version.
drop function public.current_workspace_id();
