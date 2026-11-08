-- OFFLINE GENERATED; parent must verify project mhkoayftiuojxlrkollf and SQL ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d.
-- Initial seed: 2 workspaces, 4 staff, 5 brand memberships, 4 scoped grants plus audit/receipts; run 5f694251-c6eb-4f5f-a281-25e91db81c04. No Auth writes, creator bootstrap, mission join or awards.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO $pilot_43e586fe87750b4851ff$
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
  IF to_regprocedure('public.bootstrap_creator_account(uuid,uuid,text,text,text)') IS NULL
    OR to_regprocedure('private.brand_staff_mission_write_allowed(uuid)') IS NULL
    OR to_regprocedure('private.bootstrap_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text)') IS NULL
  THEN RAISE EXCEPTION 'APPROVED_AUTH_BOUNDARY_SQL_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=ANY(ARRAY[E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'5d92d267-1b2a-4f19-97bd-3c80f1f3b213'::uuid]::uuid[]) OR slug IN (E'kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-a',E'kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-b'))
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR email IN (E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-p@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-b@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-b-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-u-x@example.invalid'))
    OR EXISTS(SELECT 1 FROM public.brand_users WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR email IN (E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-p@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-c-b@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-b-a@example.invalid',E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-u-x@example.invalid'))
    OR EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR granted_by=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.staff_platform_roles WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR granted_by=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.staff_access_audit WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR actor_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) OR request_id=ANY(ARRAY[E'f569c015-cd3e-5b6f-9d74-c5ad3a0ab62d'::uuid,E'645551e2-f9c7-55bc-b888-6c4f478a827d'::uuid,E'a83b8d25-2ea4-5852-8475-c2386f40ad6f'::uuid,E'533b7117-eba0-5982-b770-bc4c828573ba'::uuid,E'9bab8dad-bc41-565a-940d-adffb6f660fd'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=ANY(ARRAY[E'f569c015-cd3e-5b6f-9d74-c5ad3a0ab62d'::uuid,E'645551e2-f9c7-55bc-b888-6c4f478a827d'::uuid,E'a83b8d25-2ea4-5852-8475-c2386f40ad6f'::uuid,E'533b7117-eba0-5982-b770-bc4c828573ba'::uuid,E'9bab8dad-bc41-565a-940d-adffb6f660fd'::uuid]::uuid[]))
  THEN RAISE EXCEPTION 'FIXTURE_COLLISION_STOP_NO_UPSERT'; END IF;
  INSERT INTO public.workspaces(id,slug,name,plan,settings) VALUES
    (E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-a',E'KOCmax approved Auth pilot A','starter',jsonb_build_object('auth_pilot_run_id','5f694251-c6eb-4f5f-a281-25e91db81c04','expires_at',clock_timestamp()+interval '24 hours')),
    (E'5d92d267-1b2a-4f19-97bd-3c80f1f3b213'::uuid,E'kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-b',E'KOCmax approved Auth pilot B','starter',jsonb_build_object('auth_pilot_run_id','5f694251-c6eb-4f5f-a281-25e91db81c04','expires_at',clock_timestamp()+interval '24 hours'));
  INSERT INTO public.staff_users(user_id,email,active) VALUES
    (E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid',true),
    (E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid',true),
    (E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid',true),
    (E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid',true);
  INSERT INTO public.brand_users(user_id,workspace_id,email,role,active) VALUES
    (E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-a@example.invalid','member',true),
    (E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-o@example.invalid','member',true),
    (E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-r@example.invalid','member',true),
    (E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-s-f@example.invalid','member',true),
    (E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'kocmax-5f694251-c6eb-4f5f-a281-25e91db81c04-b-a@example.invalid','member',true);
  outcome := private.bootstrap_staff_access(
    E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,
    E'workspace_admin',true,0,E'f569c015-cd3e-5b6f-9d74-c5ad3a0ab62d'::uuid,E'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: initial S-A scoped role',E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.');
  IF outcome->>'userId' IS DISTINCT FROM E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'
    OR outcome->>'workspaceId' IS DISTINCT FROM E'00391df1-e411-4a82-a317-4a73bb293f89'
    OR outcome->>'role' IS DISTINCT FROM E'workspace_admin'
    OR (outcome->>'active')::boolean IS DISTINCT FROM true
    OR (outcome->>'revision')::integer IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;
  outcome := private.bootstrap_staff_access(
    E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,
    E'operator',true,0,E'645551e2-f9c7-55bc-b888-6c4f478a827d'::uuid,E'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: initial S-O scoped role',E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.');
  IF outcome->>'userId' IS DISTINCT FROM E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'
    OR outcome->>'workspaceId' IS DISTINCT FROM E'00391df1-e411-4a82-a317-4a73bb293f89'
    OR outcome->>'role' IS DISTINCT FROM E'operator'
    OR (outcome->>'active')::boolean IS DISTINCT FROM true
    OR (outcome->>'revision')::integer IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;
  outcome := private.bootstrap_staff_access(
    E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,
    E'reviewer',true,0,E'a83b8d25-2ea4-5852-8475-c2386f40ad6f'::uuid,E'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: initial S-R scoped role',E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.');
  IF outcome->>'userId' IS DISTINCT FROM E'ff86250c-e600-4841-bf36-329f5bf180aa'
    OR outcome->>'workspaceId' IS DISTINCT FROM E'00391df1-e411-4a82-a317-4a73bb293f89'
    OR outcome->>'role' IS DISTINCT FROM E'reviewer'
    OR (outcome->>'active')::boolean IS DISTINCT FROM true
    OR (outcome->>'revision')::integer IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;
  outcome := private.bootstrap_staff_access(
    E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,
    E'finance_viewer',true,0,E'533b7117-eba0-5982-b770-bc4c828573ba'::uuid,E'Approved Auth pilot 5f694251-c6eb-4f5f-a281-25e91db81c04: initial S-F scoped role',E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.');
  IF outcome->>'userId' IS DISTINCT FROM E'e43cdb67-63b7-4946-836d-7333624a1842'
    OR outcome->>'workspaceId' IS DISTINCT FROM E'00391df1-e411-4a82-a317-4a73bb293f89'
    OR outcome->>'role' IS DISTINCT FROM E'finance_viewer'
    OR (outcome->>'active')::boolean IS DISTINCT FROM true
    OR (outcome->>'revision')::integer IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;
  IF (SELECT count(*) FROM public.staff_users WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))<>4
    OR (SELECT count(*) FROM public.brand_users WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))<>5
    OR (SELECT count(*) FROM public.staff_workspace_roles WHERE user_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]) AND workspace_id=E'00391df1-e411-4a82-a317-4a73bb293f89'::uuid AND active AND revision=1)<>4
    OR (SELECT count(*) FROM public.staff_access_audit WHERE request_id=ANY(ARRAY[E'f569c015-cd3e-5b6f-9d74-c5ad3a0ab62d'::uuid,E'645551e2-f9c7-55bc-b888-6c4f478a827d'::uuid,E'a83b8d25-2ea4-5852-8475-c2386f40ad6f'::uuid,E'533b7117-eba0-5982-b770-bc4c828573ba'::uuid]::uuid[]) AND actor_id=E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid AND actor_kind='db_owner_bootstrap' AND approval_ref=E'User explicitly approved the new SQL, restore verification, nine-account testing and cleanup on 2026-11-01.')<>4
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.point_balances WHERE creator_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
    OR EXISTS(SELECT 1 FROM public.earnings_balances WHERE creator_id=ANY(ARRAY[E'6c88b77f-a273-4ed4-b48f-099ad792efc7'::uuid,E'1cf3cd31-79ba-463d-8631-2528a34d68a4'::uuid,E'f06df842-931b-4e45-b74f-0ea9c2944159'::uuid,E'd854b3e8-85dd-4d97-89aa-f59c93e2d1ee'::uuid,E'4c1e5d4b-ac1d-4930-b245-1e4efe28de20'::uuid,E'ff86250c-e600-4841-bf36-329f5bf180aa'::uuid,E'e43cdb67-63b7-4946-836d-7333624a1842'::uuid,E'faf3de5a-e961-4d29-b825-5f5abfe5438e'::uuid,E'6a3bd66a-6fd4-4e24-9e56-d51d4246d833'::uuid]::uuid[]))
  THEN RAISE EXCEPTION 'EXACT_SEED_POSTCONDITION_FAILED'; END IF;
END;
$pilot_43e586fe87750b4851ff$;
COMMIT;
