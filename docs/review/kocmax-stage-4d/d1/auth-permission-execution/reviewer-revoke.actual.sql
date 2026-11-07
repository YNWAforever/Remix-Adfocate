-- OFFLINE GENERATED; parent must verify project mhkoayftiuojxlrkollf and SQL ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d.
-- Revoke only S-R revision 1 -> 2; preserve membership to test no fallback; run 5f694251-c6eb-4f5f-a281-25e91db81c04. No Auth writes, creator bootstrap, mission join or awards.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO $pilot_a5f0e73d9d36e29dbe3c$
DECLARE outcome jsonb;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'EXACT_DB_OWNER_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('5f694251-c6eb-4f5f-a281-25e91db81c04:fixtures',0));
  PERFORM 1 FROM auth.users WHERE id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) FOR KEY SHARE;
  IF (SELECT count(*) FROM (VALUES (E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-a@example.invalid'),
      (E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-p@example.invalid'),
      (E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-b@example.invalid'),
      (E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid'),
      (E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid'),
      (E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid'),
      (E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid'),
      (E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-b-a@example.invalid'),
      (E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-u-x@example.invalid')) e(id,email)
      JOIN auth.users u ON u.id=e.id AND u.email=e.email AND u.email_confirmed_at IS NOT NULL) <> 9
    OR (SELECT count(*) FROM auth.users WHERE lower(email) IN (E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-p@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-b@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-b-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-u-x@example.invalid')) <> 9
  THEN RAISE EXCEPTION 'EXACT_CONFIRMED_AUTH_IDENTITIES_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid AND slug=E'kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-a' AND settings->>'auth_pilot_run_id'='5f694251-c6eb-4f5f-a281-25e91db81c04')
    OR NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid AND workspace_id=E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid AND role='workspace_admin' AND active AND revision=1)
    OR NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid AND workspace_id=E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid AND role='reviewer' AND active AND revision=1)
    OR NOT EXISTS(SELECT 1 FROM public.staff_access_audit WHERE request_id=E'a83b8d25-2ea4-5852-8475-c2386f40ad6f'::uuid AND user_id=E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid AND actor_id=E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid AND approval_ref=E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.')
    OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=E'9bab8dad-bc41-565a-940d-adffb6f660fd'::uuid)
  THEN RAISE EXCEPTION 'EXACT_REVIEWER_REVISION_ONE_REQUIRED'; END IF;
  outcome := private.bootstrap_staff_access(
    E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,
    E'reviewer',false,1,E'9bab8dad-bc41-565a-940d-adffb6f660fd'::uuid,E'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: revoke reviewer for stale-session checks',E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.');
  IF outcome->>'userId' IS DISTINCT FROM E'ff86250c-e600-4841-bf36-329f5bf180aa'
    OR outcome->>'workspaceId' IS DISTINCT FROM E'00391df1-e411-4a82-a317-4a73bb293f89'
    OR outcome->>'role' IS DISTINCT FROM E'reviewer'
    OR (outcome->>'active')::boolean IS DISTINCT FROM false
    OR (outcome->>'revision')::integer IS DISTINCT FROM 2
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;
END;
$pilot_a5f0e73d9d36e29dbe3c$;
COMMIT;
