-- Project the SQL guard's result alongside the exact saved evidence being reviewed.
-- A computed field avoids additional reads and keeps historical URLs untouched.
begin;

create function public.legacy_evidence_sql_valid(public.mission_submissions)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.valid_legacy_evidence(($1).content_urls);
$$;
revoke all on function public.legacy_evidence_sql_valid(public.mission_submissions) from public, anon, authenticated, service_role;
grant execute on function public.legacy_evidence_sql_valid(public.mission_submissions) to service_role;

notify pgrst, 'reload schema';
commit;
