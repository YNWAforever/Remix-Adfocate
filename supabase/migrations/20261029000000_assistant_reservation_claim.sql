-- An unclaimed reservation may outlive its lease while history loading fails.
-- The atomic state transition, rather than the lease age, prevents duplicate
-- generation. A newer request expires abandoned reservations to 'unknown'.
begin;

create or replace function public.claim_assistant_request(p_workspace uuid,p_creator uuid,p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.creators where id = p_creator and workspace_id = p_workspace) then return false; end if;
  update public.assistant_requests set state='generating', provider_started_at=clock_timestamp(), lease_until=clock_timestamp()+interval '30 seconds'
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='reserved';
  return found;
end;
$$;

revoke all on function public.claim_assistant_request(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_assistant_request(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
