-- Slice 3: restore the role grants that the deprecated auto-expose default used to
-- provide. After the 2026-05-30 flip (auto_expose_new_tables=false), migration-created
-- tables get NO grants — not even for `service_role` — so backend writes (the
-- `/me/bootstrap` service-client upsert and the integration test harness) hit
-- "permission denied for table creators", no creator rows are ever created, and every
-- workspace-scoped read then 403s at workspaceAuth. Cloud predates the flip so prod
-- already works; this makes local + CI match and hardens against drift.

-- service_role: the privileged backend identity (bypasses RLS; used by the service
-- client for bootstrap + onboarding/complete and by the test harness). It needs full
-- table/sequence access, which auto-expose used to grant implicitly.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- authenticated: RLS-scoped reads of the catalogue + the caller's own rows.
grant select on
  public.workspaces,
  public.missions,
  public.redemption_gifts,
  public.creators,
  public.point_balances,
  public.point_transactions
  to authenticated;

-- Profile self-edit columns (UPDATE is gated by the creators_self_update policy
-- from 0003; this grants the column privilege the policy needs to take effect).
grant update (display_name, avatar_url, categories, social_handles, onboarding_step, phone)
  on public.creators to authenticated;
