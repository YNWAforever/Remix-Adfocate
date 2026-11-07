-- Exact-owned recovery for the approved nine-account cleanup.
-- Normal product anonymization/ban completed; its subsequent logout failed.
-- Retain Auth users, identities, creator/audit/workspace parents, FK and triggers.
-- 30 exact session IDs were observed at 2026-11-01T18:12:07.993174Z.
-- Existing FKs cascade only their 33 refresh-token rows and 30 AMR claims.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $pilot_recovery$
DECLARE
  pilot_user_ids uuid[]:=ARRAY['6c88b77f-a273-4ed4-b48f-099ad792efc7','1cf3cd31-79ba-463d-8631-2528a34d68a4','f06df842-931b-4e45-b74f-0ea9c2944159','d854b3e8-85dd-4d97-89aa-f59c93e2d1ee','4c1e5d4b-ac1d-4930-b245-1e4efe28de20','ff86250c-e600-4841-bf36-329f5bf180aa','e43cdb67-63b7-4946-836d-7333624a1842','faf3de5a-e961-4d29-b825-5f5abfe5438e','6a3bd66a-6fd4-4e24-9e56-d51d4246d833']::uuid[];
  pilot_session_ids uuid[]:=ARRAY[
    '046a4532-ebbb-42c3-a5fb-b7c749e7e97a','092d7442-c188-45a5-bb87-df2ee4356ca2','1397a3e8-5fd5-441f-b818-3170073ccc14',
    '17216baf-6936-4e8b-b476-c951e58d55b2','2cd05ce0-1013-49c7-8bd0-c0b3949e5207','36ffdef0-fdab-4837-a0fc-7337ca390915',
    '3b80d4b1-c8c0-4342-bede-e0f3cccb3c57','3de2712a-63cf-4ef5-91f6-91c8ae532a68','46f7c8ca-7aae-4829-a2ad-db590c9f8faf',
    '51780d4e-5a78-43c8-b266-755e33a81be0','53520a31-5dc0-44ab-ba46-a26e6f759f16','55021e37-bb1f-4316-b849-aea8f6d3bf54',
    '56ca8349-5f7c-4fcc-b49d-b54717b52fa6','57d1e226-b6c9-4c98-b762-fc283a6c260b','69e298b5-770a-44fe-9398-df884e2eb480',
    '746d6462-a18a-420a-aaf9-474952c44dad','76fe51d4-89b6-428a-a338-b66bb7419a09','7721225b-9fc6-42d2-8fe3-78dceb117660',
    '784d0bcc-f702-4424-840d-b62317dc3a43','81042a15-d276-43ad-8578-9f3b14be492f','a5ad39e2-8ec9-4069-a3e0-c99d4297a4e1',
    'b49c5398-cae8-4c99-b852-d143207ec3dd','bb60514e-d4d5-4964-a211-a465490d2838','c309773f-91aa-443c-9d4a-77490e166afa',
    'c515635e-5d89-467d-9a8a-fdacec8a54fc','d27ba022-34a8-4a07-9084-5456c99a626d','d48e8f0e-f595-4ad0-9749-ec44454ade46',
    'e78385d3-bea6-49ca-ad08-caef6c3cb8c1','f6a38396-8087-41bd-b9f1-45fe1d9d0395','fa2faf16-4d6f-4f03-a541-118fdc724a5b'
  ]::uuid[];
  mission uuid:='446802cb-4f6c-418d-967a-bf5f1cf63ea5';
  ref record;
  n bigint;
  changed integer;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'DB_OWNER_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('5f694251-c6eb-4f5f-a281-25e91db81c04:fixtures',0));
  PERFORM 1 FROM auth.users WHERE id=ANY(pilot_user_ids) FOR UPDATE;
  IF (SELECT count(*) FROM auth.users WHERE id=ANY(pilot_user_ids)
      AND raw_app_meta_data->'auth_pilot'->>'run_id'='5f694251-c6eb-4f5f-a281-25e91db81c04'
      AND banned_until>now() AND email='deleted-'||id::text||'@deleted.invalid')<>9
    OR (SELECT count(*) FROM public.creators WHERE id=ANY(pilot_user_ids) AND status='deleted')<>9
    OR EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=ANY(pilot_user_ids) AND active)
    OR EXISTS(SELECT 1 FROM public.brand_users WHERE user_id=ANY(pilot_user_ids) AND active)
    OR EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=ANY(pilot_user_ids) AND active)
    OR EXISTS(SELECT 1 FROM public.staff_platform_roles WHERE user_id=ANY(pilot_user_ids))
  THEN RAISE EXCEPTION 'EXACT_DISABLED_NINE_TEST_USERS_REQUIRED'; END IF;
  PERFORM 1 FROM auth.sessions WHERE id=ANY(pilot_session_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM auth.sessions WHERE id=ANY(pilot_session_ids) AND user_id=ANY(pilot_user_ids))<>30
    OR (SELECT count(*) FROM auth.sessions WHERE user_id=ANY(pilot_user_ids))<>30
    OR (SELECT count(*) FROM auth.refresh_tokens WHERE session_id=ANY(pilot_session_ids))<>33
    OR (SELECT count(*) FROM auth.mfa_amr_claims WHERE session_id=ANY(pilot_session_ids))<>30
    OR EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE session_id=ANY(pilot_session_ids) AND NOT(user_id::text=ANY(pilot_user_ids::text[])))
    OR EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id::text=ANY(pilot_user_ids::text[]) AND session_id IS NULL)
  THEN RAISE EXCEPTION 'EXACT_SESSION_INVENTORY_CHANGED_REVIEW_REQUIRED'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE contype='f' AND confrelid='auth.sessions'::regclass)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='refresh_tokens_session_id_fkey' AND conrelid='auth.refresh_tokens'::regclass AND confrelid='auth.sessions'::regclass AND confdeltype='c')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='mfa_amr_claims_session_id_fkey' AND conrelid='auth.mfa_amr_claims'::regclass AND confrelid='auth.sessions'::regclass AND confdeltype='c')
  THEN RAISE EXCEPTION 'EXPECTED_SESSION_FK_BEHAVIOR_REQUIRED'; END IF;
  DELETE FROM auth.sessions WHERE id=ANY(pilot_session_ids) AND user_id=ANY(pilot_user_ids);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>30 OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=ANY(pilot_user_ids))
    OR EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id::text=ANY(pilot_user_ids::text[]))
    OR EXISTS(SELECT 1 FROM auth.mfa_amr_claims WHERE session_id=ANY(pilot_session_ids))
  THEN RAISE EXCEPTION 'SESSION_REMOVAL_POSTCONDITION_FAILED'; END IF;

  PERFORM 1 FROM public.missions WHERE id=mission AND workspace_id='00391df1-e411-4a82-a317-4a73bb293f89'
    AND slug='kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-api-draft'
    AND status='draft' AND public_preview_enabled=false
    AND points_reward=0 AND cash_reward=0 AND cpm_rate=0 AND cpm_budget_pool=0 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXACT_PRIVATE_ZERO_REWARD_DRAFT_REQUIRED'; END IF;
  FOR ref IN
    SELECT ns.nspname s,cl.relname t,att.attname col FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class cl ON cl.oid=con.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN LATERAL generate_subscripts(con.confkey,1) pos(idx) ON true
    JOIN pg_catalog.pg_attribute target ON target.attrelid=con.confrelid AND target.attnum=con.confkey[pos.idx]
    JOIN pg_catalog.pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[pos.idx]
    WHERE con.contype='f' AND con.confrelid='public.missions'::regclass AND target.attname='id'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',ref.s,ref.t,ref.col) INTO n USING mission;
    IF n<>0 THEN RAISE EXCEPTION 'DRAFT_HAS_DEPENDENTS_PRESERVE_PARENT'; END IF;
  END LOOP;
  DELETE FROM public.missions WHERE id=mission AND workspace_id='00391df1-e411-4a82-a317-4a73bb293f89';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'EXACT_ONE_OWNED_DRAFT_REQUIRED'; END IF;
  IF (SELECT count(*) FROM auth.users WHERE id=ANY(pilot_user_ids) AND banned_until>now())<>9
    OR (SELECT count(*) FROM public.creators WHERE id=ANY(pilot_user_ids) AND status='deleted')<>9
  THEN RAISE EXCEPTION 'AUTH_AND_CREATOR_PARENTS_MUST_BE_RETAINED'; END IF;
END;
$pilot_recovery$;
COMMIT;
