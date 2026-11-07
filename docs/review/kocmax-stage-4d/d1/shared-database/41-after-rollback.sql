-- Read only. These checks verify only the exact planned root/actor IDs.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'workspaces' AS object_name,count(*) AS remaining
FROM public.workspaces WHERE id IN ('b2205cc1-972c-44aa-93d4-6b5d620a7301','b2205cc1-972c-44aa-93d4-6b5d620a7302')
UNION ALL
SELECT 'missions',count(*) FROM public.missions WHERE id='b2205cc1-972c-44aa-93d4-6b5d620a7311'
UNION ALL
SELECT 'creators',count(*) FROM public.creators WHERE id=ANY(ARRAY[
 nullif(current_setting('kocmax.fixture_creator_a',true),'')::uuid,
 nullif(current_setting('kocmax.fixture_creator_peer',true),'')::uuid,
 nullif(current_setting('kocmax.fixture_creator_b',true),'')::uuid])
UNION ALL
SELECT 'staff_users',count(*) FROM public.staff_users WHERE user_id=nullif(current_setting('kocmax.fixture_operator_a',true),'')::uuid
UNION ALL
SELECT 'brand_users',count(*) FROM public.brand_users WHERE user_id=nullif(current_setting('kocmax.fixture_operator_a',true),'')::uuid;
-- Missing identity bindings invalidate an actor check; NULL is not evidence of cleanup.
SELECT nullif(current_setting('kocmax.fixture_creator_a',true),'') IS NOT NULL
 AND nullif(current_setting('kocmax.fixture_creator_peer',true),'') IS NOT NULL
 AND nullif(current_setting('kocmax.fixture_creator_b',true),'') IS NOT NULL
 AND nullif(current_setting('kocmax.fixture_operator_a',true),'') IS NOT NULL AS actor_bindings_present;
ROLLBACK;
