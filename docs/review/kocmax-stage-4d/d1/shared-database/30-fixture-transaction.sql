-- REVIEW ONLY. Never executed against the shared database in this preparation task.
-- One dedicated connection, one complete transaction. This file ALWAYS ROLLS BACK.
-- Auth UUIDs are explicit future inputs, not invented accounts or authorization.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $fixtures$
DECLARE
  a uuid := nullif(current_setting('kocmax.fixture_creator_a',true),'')::uuid;
  peer uuid := nullif(current_setting('kocmax.fixture_creator_peer',true),'')::uuid;
  b uuid := nullif(current_setting('kocmax.fixture_creator_b',true),'')::uuid;
  op uuid := nullif(current_setting('kocmax.fixture_operator_a',true),'')::uuid;
  approval text := nullif(current_setting('kocmax.fixture_approval',true),'');
  wa constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7301';
  wb constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7302';
  mission constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7311';
  template constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7312';
  requirement constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7313';
  role_request constant uuid := 'b2205cc1-972c-44aa-93d4-6b5d620a7321';
  thread jsonb; source jsonb; brief jsonb; role_result jsonb;
BEGIN
  IF approval IS NULL OR a IS NULL OR peer IS NULL OR b IS NULL OR op IS NULL
    OR (SELECT count(DISTINCT x) FROM unnest(ARRAY[a,peer,b,op]) x)<>4
  THEN RAISE EXCEPTION 'EXPLICIT_FIXTURE_APPROVAL_AND_FOUR_AUTH_BINDINGS_REQUIRED'; END IF;
  IF (SELECT count(*) FROM auth.users WHERE id=ANY(ARRAY[a,peer,b,op]))<>4
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(ARRAY[a,peer,b,op]))
    OR EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=ANY(ARRAY[a,peer,b,op]))
    OR EXISTS(SELECT 1 FROM public.brand_users WHERE user_id=ANY(ARRAY[a,peer,b,op]))
  THEN RAISE EXCEPTION 'AUTH_BINDING_NOT_DEDICATED_EMPTY_TEST_IDENTITY'; END IF;
  IF EXISTS(SELECT 1 FROM public.workspaces WHERE id IN (wa,wb) OR slug IN ('kocmax-d1-review-c817e8f0-a','kocmax-d1-review-c817e8f0-b'))
    OR EXISTS(SELECT 1 FROM public.missions WHERE id=mission)
    OR EXISTS(SELECT 1 FROM public.mission_deliverable_templates WHERE id=template)
    OR EXISTS(SELECT 1 FROM public.mission_deliverable_requirements WHERE id=requirement)
    OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=role_request)
  THEN RAISE EXCEPTION 'FIXTURE_ID_COLLISION_STOP_NO_UPSERT'; END IF;

  INSERT INTO public.workspaces(id,slug,name,plan,settings) VALUES
    (wa,'kocmax-d1-review-c817e8f0-a','KOCmax D1 測試 A','starter','{"kocmax_review":true,"run_id":"c817e8f0-3cf0-461c-9c57-5e0715d5bfc8"}'),
    (wb,'kocmax-d1-review-c817e8f0-b','KOCmax D1 權限反例 B','starter','{"kocmax_review":true,"run_id":"c817e8f0-3cf0-461c-9c57-5e0715d5bfc8"}');
  INSERT INTO public.creators(id,workspace_id,display_name,status,xp,onboarding_completed) VALUES
    (a,wa,'示例創作者 A','active',0,true),(peer,wa,'同工作區權限反例','active',0,true),(b,wb,'其他工作區權限反例','active',0,true);
  INSERT INTO public.staff_users(user_id,email,active) VALUES(op,'kocmax-d1-operator@example.invalid',true);
  INSERT INTO public.brand_users(user_id,email,workspace_id,role,active) VALUES(op,'kocmax-d1-operator@example.invalid',wa,'member',true);
  role_result := private.bootstrap_staff_access(op,wa,op,'workspace_admin',true,0,role_request,
    'D1 transaction-only test role; never a production membership grant',approval);
  INSERT INTO public.missions(id,workspace_id,slug,title,description,mission_type,access_type,required_level,points_reward,cash_reward,
    status,quota,filled,platforms,creator_workflow_mode,public_preview_enabled,fulfillment_required)
  VALUES(mission,wa,'kocmax-d1-review-tea-brief','示例任務：香港茶飲短片 Brief','合成示例；不發佈、不兌換、不向品牌交付。',
    'ugc','open','L0',10,0,'draft',3,0,ARRAY['instagram'],'active_workspace',false,false);
  INSERT INTO public.mission_deliverable_templates(id,workspace_id,mission_id,title,platform,position,required)
    VALUES(template,wa,mission,'15 秒短片腳本','instagram',0,true);
  INSERT INTO public.mission_deliverable_requirements(id,workspace_id,mission_deliverable_template_id,category,requirement_text,required,position)
    VALUES(requirement,wa,template,'compliance','不得聲稱未經驗證的健康或成效結果',true,0);

  thread := public.studio_command(wa,a,'b2205cc1-972c-44aa-93d4-6b5d620a7331','create_thread',
    jsonb_build_object('title','茶飲短片示例','topic','creation','missionId',mission));
  source := public.studio_command(wa,a,'b2205cc1-972c-44aa-93d4-6b5d620a7332','add_source',
    jsonb_build_object('threadId',thread->>'id','revision',0,'title','示例訪談問題','content','香港上班族如何選擇下午茶？此內容未經市場驗證。',
      'kind','manual','shareable',false,'question','香港上班族如何選擇下午茶？','platform','manual','region','HK','language','zh-Hant','observed_at',clock_timestamp()));
  brief := public.studio_command(wa,a,'b2205cc1-972c-44aa-93d4-6b5d620a7333','save_brief',
    jsonb_build_object('threadId',thread->>'id','revision',1,'sections',jsonb_build_array(jsonb_build_object('id','opening',
      'text','以 15 秒短片示範一杯茶飲的準備過程；避免未驗證的健康或成效聲稱。','sourceIds',jsonb_build_array(source->>'id')))));
  IF (source->>'status') IS DISTINCT FROM 'unverified' THEN RAISE EXCEPTION 'FIXTURE_EVIDENCE_MUST_STAY_UNVERIFIED'; END IF;
  IF EXISTS(SELECT 1 FROM public.point_transactions WHERE creator_id=ANY(ARRAY[a,peer,b]))
    OR EXISTS(SELECT 1 FROM public.earnings_transactions WHERE creator_id=ANY(ARRAY[a,peer,b]))
    OR EXISTS(SELECT 1 FROM public.studio_badges WHERE creator_id=ANY(ARRAY[a,peer,b]))
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(ARRAY[a,peer,b]) AND xp<>0)
  THEN RAISE EXCEPTION 'BRIEF_OR_CONNECTION_MUST_NOT_AWARD_POINTS_CASH_XP_BADGES'; END IF;
  RAISE NOTICE 'FIXTURE_CREATED_WITH_PRIVATE_UNVERIFIED_BRIEF_WILL_ROLL_BACK';
END
$fixtures$;
-- These SQL claim substitutions test row policies, not real Auth/JWT verification.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('kocmax.fixture_creator_a'),true);
DO $owner_read$ BEGIN
  IF (SELECT count(*) FROM public.studio_threads WHERE workspace_id='b2205cc1-972c-44aa-93d4-6b5d620a7301')<>1
    OR has_table_privilege(current_user,'public.studio_sources','INSERT')
  THEN RAISE EXCEPTION 'OWNER_READ_OR_DIRECT_WRITE_POLICY_FAILED'; END IF;
END $owner_read$;
SELECT set_config('request.jwt.claim.sub',current_setting('kocmax.fixture_creator_peer'),true);
DO $peer_read$ BEGIN
  IF EXISTS(SELECT 1 FROM public.studio_threads WHERE workspace_id='b2205cc1-972c-44aa-93d4-6b5d620a7301')
  THEN RAISE EXCEPTION 'SAME_WORKSPACE_PRIVATE_BRIEF_LEAK'; END IF;
END $peer_read$;
SELECT set_config('request.jwt.claim.sub',current_setting('kocmax.fixture_creator_b'),true);
DO $outsider_read$ BEGIN
  IF EXISTS(SELECT 1 FROM public.studio_sources WHERE workspace_id='b2205cc1-972c-44aa-93d4-6b5d620a7301')
  THEN RAISE EXCEPTION 'CROSS_WORKSPACE_PRIVATE_SOURCE_LEAK'; END IF;
END $outsider_read$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anonymous_read$ BEGIN
  IF has_table_privilege(current_user,'public.studio_sources','SELECT')
  THEN RAISE EXCEPTION 'ANONYMOUS_PRIVATE_SOURCE_ACCESS'; END IF;
END $anonymous_read$;
RESET ROLE;
-- Add no COMMIT. Persistent fixtures/browser use need a separate, exact write approval.
ROLLBACK;
