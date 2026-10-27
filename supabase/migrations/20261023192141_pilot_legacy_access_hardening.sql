-- Reassert the intended legacy browser ACLs on catalogs with broad inherited grants.
-- Existing table grants override column grants; RLS alone cannot restrict scan fields.
-- No data, roles, memberships, policies, legacy migration bytes or history are rewritten.
begin;
revoke all on public.creator_social_accounts, public.creator_social_scan_snapshots,
  public.creator_public_passports, public.creator_review_statuses, public.creator_review_notes,
  public.mission_shortlists, public.operator_audit_events from public, anon, authenticated;
grant select, delete on public.creator_social_accounts, public.creator_public_passports to authenticated;
grant select on public.creator_social_scan_snapshots to authenticated;
grant insert (creator_id, workspace_id, platform, handle, profile_url)
  on public.creator_social_accounts to authenticated;
grant update (handle, profile_url) on public.creator_social_accounts to authenticated;
commit;
