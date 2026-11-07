-- Approved exact-owned pilot cleanup only. No Auth writes or schema changes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $owned_cleanup$
DECLARE
  ids uuid[] := ARRAY['6c88b77f-a273-4ed4-b48f-099ad792efc7','1cf3cd31-79ba-463d-8631-2528a34d68a4','f06df842-931b-4e45-b74f-0ea9c2944159','d854b3e8-85dd-4d97-89aa-f59c93e2d1ee','4c1e5d4b-ac1d-4930-b245-1e4efe28de20','ff86250c-e600-4841-bf36-329f5bf180aa','e43cdb67-63b7-4946-836d-7333624a1842','faf3de5a-e961-4d29-b825-5f5abfe5438e','6a3bd66a-6fd4-4e24-9e56-d51d4246d833']::uuid[];
  actor uuid := 'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee';
  workspace uuid := '00391df1-e411-4a82-a317-4a73bb293f89';
  mission uuid := '446802cb-4f6c-418d-967a-bf5f1cf63ea5';
  approval text := 'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.';
  ref record;
  subject record;
  n bigint;
  changed integer;
  outcome jsonb;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DB_OWNER_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('5f694251-c6eb-4f5f-a281-25e91db81c04:fixtures',0));
  IF (SELECT count(*) FROM auth.users WHERE id=ANY(ids) AND raw_app_meta_data->'auth_pilot'->>'run_id'='5f694251-c6eb-4f5f-a281-25e91db81c04')<>9
    OR (SELECT count(*) FROM public.creators WHERE id=ANY(ids) AND status<>'deleted' AND xp=0)<>9
    OR (SELECT count(*) FROM public.point_balances WHERE creator_id=ANY(ids) AND balance=0)<>9
    OR (SELECT count(*) FROM public.earnings_balances WHERE creator_id=ANY(ids) AND available=0)<>9
    OR NOT EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=actor AND active)
    OR NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id='ff86250c-e600-4841-bf36-329f5bf180aa' AND workspace_id=workspace AND role='reviewer' AND NOT active AND revision=2)
    OR EXISTS(SELECT 1 FROM public.staff_platform_roles WHERE user_id=ANY(ids))
  THEN RAISE EXCEPTION 'EXACT_OWNED_CLEANUP_PRECONDITIONS_REQUIRED'; END IF;

  -- Permanent draft removal is pending the connector confirmation.
  FOR subject IN SELECT * FROM (VALUES
    ('4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,'operator','4b2ec8b8-4c7c-4169-afa2-bb1920770424'::uuid),
    ('e43cdb67-63b7-4946-836d-7333624a1842'::uuid,'finance_viewer','2bac3bca-b1e3-4ef9-9674-71335857da9d'::uuid),
    ('d854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,'workspace_admin','49d68b1d-0e42-4882-83bd-6b3100e71458'::uuid)
  ) x(auth_id,role_name,request_id)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=subject.auth_id AND workspace_id=workspace AND role=subject.role_name AND active AND revision=1)
      OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=subject.request_id)
    THEN RAISE EXCEPTION 'EXACT_ROLE_REVISION_ONE_REQUIRED'; END IF;
    outcome:=private.bootstrap_staff_access(actor,workspace,subject.auth_id,subject.role_name,false,1,subject.request_id,
      'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: final cleanup role revocation',approval);
    IF outcome->>'userId' IS DISTINCT FROM subject.auth_id::text
      OR outcome->>'workspaceId' IS DISTINCT FROM workspace::text
      OR outcome->>'role' IS DISTINCT FROM subject.role_name
      OR (outcome->>'active')::boolean IS DISTINCT FROM false
      OR (outcome->>'revision')::integer IS DISTINCT FROM 2
    THEN RAISE EXCEPTION 'AUDITED_REVOKE_POSTCONDITION_FAILED'; END IF;
  END LOOP;
  -- The actor remains active until all three audited calls have completed.
  UPDATE public.staff_users SET active=false WHERE user_id=ANY(ids) AND active;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>4 THEN RAISE EXCEPTION 'EXACT_FOUR_STAFF_DEACTIVATIONS_REQUIRED'; END IF;
  UPDATE public.brand_users SET active=false WHERE user_id=ANY(ids) AND workspace_id=workspace AND active AND role='member';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>5 THEN RAISE EXCEPTION 'EXACT_FIVE_MEMBERSHIP_DEACTIVATIONS_REQUIRED'; END IF;
  IF (SELECT count(*) FROM public.staff_workspace_roles WHERE user_id=ANY(ids) AND workspace_id=workspace AND NOT active AND revision=2)<>4
    OR EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=ANY(ids) AND active)
    OR EXISTS(SELECT 1 FROM public.brand_users WHERE user_id=ANY(ids) AND active)
    OR (SELECT count(*) FROM public.staff_access_audit WHERE request_id IN ('4b2ec8b8-4c7c-4169-afa2-bb1920770424','2bac3bca-b1e3-4ef9-9674-71335857da9d','49d68b1d-0e42-4882-83bd-6b3100e71458') AND actor_id=actor AND approval_ref=approval AND actor_kind='db_owner_bootstrap')<>3
  THEN RAISE EXCEPTION 'ACCESS_CLEANUP_POSTCONDITION_FAILED'; END IF;
END;
$owned_cleanup$;
COMMIT;
