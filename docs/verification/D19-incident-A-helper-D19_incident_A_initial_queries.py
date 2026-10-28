import json,sys
from D19_incident_A_read import read,sqlIds
sys.stdout.reconfigure(encoding='utf-8')
catalog=read('q1-catalog',"""select jsonb_build_object(
 'server',jsonb_build_object('database',current_database(),'databaseOid',(select oid from pg_database where datname=current_database()),'serverVersion',current_setting('server_version'),'postmasterStartedAt',pg_postmaster_start_time(),'isInRecovery',pg_is_in_recovery()),
 'settings',(select jsonb_object_agg(name,setting)from pg_settings where name in('wal_level','archive_mode','archive_timeout','wal_keep_size','logging_collector','log_destination','log_statement','log_min_duration_statement','track_commit_timestamp','data_checksums')),
 'archiveCommandConfigured',coalesce(current_setting('archive_command',true)not in('','(disabled)'),false),
 'archiveLibraryConfigured',coalesce(current_setting('archive_library',true)<>'',false),
 'restoreCommandConfigured',coalesce(current_setting('restore_command',true)<>'',false),
 'pgauditLogSetting',current_setting('pgaudit.log',true),
 'archiver',(select to_jsonb(s)from(select archived_count,last_archived_time,failed_count,last_failed_time,stats_reset from pg_stat_archiver)s),
 'relevantExtensions',(select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion)order by extname),'[]')from pg_extension where extname in('pgaudit','pg_cron','pg_walinspect')),
 'auditRelations',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod))order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))order by n.nspname,c.relname),'[]')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relkind in('r','p')and c.relname~'(audit|history|event)'),
 'builtinCapabilities',(select jsonb_object_agg(proname,true)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pg_catalog'and proname in('pg_control_system','pg_ls_waldir','pg_ls_logdir','pg_stat_file','pg_read_file'))
)""")
rows=read('q3-current-rows',f"""select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'workspaceId',c.workspace_id,'status',c.status,'closedAt',c.closed_at,'updatedAt',c.updated_at,'fullCurrentRowMd5',md5(to_jsonb(c)::text))order by c.id),'[]')from public.campaigns c where c.id in({sqlIds})""")
schema=read('q3-campaign-schema',"""select jsonb_build_object(
 'table',(select jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl)from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.campaigns'::regclass),
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull)order by a.attnum)from pg_attribute a where a.attrelid='public.campaigns'::regclass and a.attnum>0 and not a.attisdropped),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))order by t.tgname),'[]')from pg_trigger t where t.tgrelid='public.campaigns'::regclass and not t.tgisinternal),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'definition',pg_get_constraintdef(oid))order by conname)from pg_constraint where conrelid='public.campaigns'::regclass),
 'inboundFks',(select coalesce(jsonb_agg(jsonb_build_object('name',con.conname,'schema',n.nspname,'table',c.relname,'definition',pg_get_constraintdef(con.oid),'childColumns',(select jsonb_agg(a.attname order by k.ord)from unnest(con.conkey)with ordinality k(num,ord)join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.num),'parentColumns',(select jsonb_agg(a.attname order by k.ord)from unnest(con.confkey)with ordinality k(num,ord)join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.num))order by n.nspname,c.relname,con.conname),'[]')from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where con.contype='f'and con.confrelid='public.campaigns'::regclass)
)""")
print(json.dumps({'readOnlyQueries':3,'currentRows':rows,'settings':catalog['settings'],'archiveCommandConfigured':catalog['archiveCommandConfigured'],'relevantExtensions':catalog['relevantExtensions'],'auditRelations':[{'schema':r['schema'],'table':r['table'],'columns':[c['name']for c in r['columns']]}for r in catalog['auditRelations']],'campaignUserTriggers':len(schema['triggers']),'inboundFkCount':len(schema['inboundFks'])}))
