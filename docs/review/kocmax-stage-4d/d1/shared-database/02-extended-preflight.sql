-- Read-only extended drift check: column grants, owners, API memberships,
-- relevant Storage metadata, Auth hooks, extensions and DDL event triggers.
-- Captured on 2026-10-31. No customer content or credentials are selected.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $extended_guard$
DECLARE actual text;
BEGIN
SELECT md5(jsonb_build_object(
 'executor',current_user,
 'column_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl::text) ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
 'table_owners',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'is_executor',c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')),
 'function_owners',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'is_executor',p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'api_memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option) ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))),
 'buckets',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets')),
 'storage_policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname='storage' AND tablename IN ('objects','buckets')),
 'auth_user_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'function',tgfoid::regprocedure::text,'definition_md5',md5(pg_get_triggerdef(oid,true))) ORDER BY tgname),'[]'::jsonb) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'event_triggers',(SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'tags',e.evttags,'enabled',e.evtenabled,'function',e.evtfoid::regprocedure::text,'function_md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname) FROM pg_event_trigger e)
)::text) INTO actual;
IF actual IS DISTINCT FROM 'ced6f4c3e4ff69e10b8870f6a51b4717' THEN
  RAISE EXCEPTION 'EXTENDED_METADATA_DRIFT_STOP: %',actual;
END IF;
IF current_setting('session_replication_role') <> 'origin' OR current_setting('row_security') <> 'on' THEN
  RAISE EXCEPTION 'NORMAL_TRIGGER_AND_RLS_SESSION_REQUIRED';
END IF;
END
$extended_guard$;
ROLLBACK;

