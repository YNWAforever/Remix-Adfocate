BEGIN READ ONLY;
WITH t AS (
 SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,c.relacl::text AS acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')
)
SELECT jsonb_build_object(
 'observed_at',clock_timestamp(),'server_version',current_setting('server_version'),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','private')),
 'tables',(SELECT jsonb_agg(to_jsonb(t)-'oid' ORDER BY schema,name) FROM t),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY t.schema,t.name,a.attnum) FROM t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true),'validated',c.convalidated) ORDER BY t.schema,t.name,c.conname) FROM t JOIN pg_constraint c ON c.conrelid=t.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) ORDER BY schemaname,tablename,indexname) FROM pg_indexes WHERE schemaname IN ('public','private')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','private')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity_args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',g.tgname,'enabled',g.tgenabled,'function',g.tgfoid::regprocedure::text,'definition_md5',md5(pg_get_triggerdef(g.oid,true))) ORDER BY t.schema,t.name,g.tgname) FROM t JOIN pg_trigger g ON g.tgrelid=t.oid WHERE NOT g.tgisinternal),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',y.typname,'label',e.enumlabel,'order',e.enumsortorder) ORDER BY n.nspname,y.typname,e.enumsortorder) FROM pg_type y JOIN pg_namespace n ON n.oid=y.typnamespace JOIN pg_enum e ON e.enumtypid=y.oid WHERE n.nspname IN ('public','private')),
 'default_acl',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'kind',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','private')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'bypass_rls',rolbypassrls,'can_login',rolcanlogin) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin'))
) AS catalog;
ROLLBACK;
