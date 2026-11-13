-- Metadata only: no application/Auth rows, function bodies or archived SQL are returned.
-- Run on the verified fixed project connection; the client separately supplies
-- projectRef and verified connection facts. SQL cannot attest a pooler project ref.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
select jsonb_build_object(
  'observedAt',clock_timestamp(),
  'transactionReadOnly',current_setting('transaction_read_only')='on',
  'database',current_database(),'currentRole',current_user,'sessionRole',session_user,
  'serverVersionNum',current_setting('server_version_num'),
  'functions',(select jsonb_agg(jsonb_build_object(
    'signature',case when p.oid='private.join_mission(uuid)'::regprocedure then 'private.join_mission(uuid)' else 'public.accept_application(uuid)' end,
    'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'owner',case when pg_get_userbyid(p.proowner)='postgres' then 'postgres' else null end,
    'securityDefiner',p.prosecdef,
    'attributes',jsonb_build_object('language',(select lanname from pg_catalog.pg_language where oid=p.prolang),'kind',p.prokind,'returnsSet',p.proretset,'resultTypeMatches',p.prorettype='public.mission_submissions'::regtype,'volatility',p.provolatile,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel),
    'config',case when p.proconfig is not distinct from array['search_path=public']::text[] then to_jsonb(p.proconfig) else null end,
    'execute',jsonb_build_object(
      'public',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
  ) order by p.oid::regprocedure::text) from pg_catalog.pg_proc p where p.oid in ('private.join_mission(uuid)'::regprocedure,'public.accept_application(uuid)'::regprocedure)),
  'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname),'[]'::jsonb) from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace),
  'foreignKeys',(select coalesce(jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,'type',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'definition',pg_get_constraintdef(c.oid,true)) order by c.conrelid::regclass::text,c.conname),'[]'::jsonb) from pg_catalog.pg_constraint c where c.conrelid in ('public.mission_submissions'::regclass,'public.mission_workflows'::regclass) and c.contype='f'),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('relation',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'constraintName',(select conname from pg_catalog.pg_constraint where oid=t.tgconstraint),'function',n.nspname||'.'||p.proname,'definitionSha256',encode(sha256(convert_to(pg_get_triggerdef(t.oid,true),'UTF8')),'hex')) order by t.tgrelid::regclass::text,t.tgname),'[]'::jsonb) from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid=t.tgfoid join pg_catalog.pg_namespace n on n.oid=p.pronamespace where t.tgrelid in ('public.mission_submissions'::regclass,'public.mission_workflows'::regclass,'public.creators'::regclass,'public.missions'::regclass)),
  'history',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',case when name ~ '^[a-z0-9][a-z0-9_]{0,159}$' then name else null end,'statementCount',coalesce(cardinality(statements),0),'statementsSha256',case when statements is null then null else encode(sha256(convert_to(array_to_string(statements,E'\n'),'UTF8')),'hex') end) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations)
) as result;
ROLLBACK;
