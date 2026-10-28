import json,re,sys
from D19_incident_A_read import read as fresh_read,sqlIds,D,P,ids
def read(label,query):
 path=D/(P+'-'+label+'.json')
 if path.exists():
  record=json.loads(path.read_text(encoding='utf-8'));assert record['query']==query and record['transactionReadOnly']=='on';return record['payload']
 return fresh_read(label,query)
sys.stdout.reconfigure(encoding='utf-8')
cap=read('q1-recovery-catalog',"""select jsonb_build_object(
 'dataDirectory',current_setting('data_directory'),
 'queryRoleIsSuperuser',(select rolsuper from pg_roles where rolname=current_user),
 'replicationSlots',(select coalesce(jsonb_agg(jsonb_build_object('name',slot_name,'plugin',plugin,'type',slot_type,'database',database,'active',active,'restartLsn',restart_lsn,'confirmedFlushLsn',confirmed_flush_lsn,'walStatus',wal_status)order by slot_name),'[]')from pg_replication_slots where database is null or database=current_database()),
 'campaignReplicaIdentity',(select relreplident from pg_class where oid='public.campaigns'::regclass),
 'serverFileMetadata','UNKNOWN_PERMISSION_DENIED_pg_stat_file; no alternate filesystem path or role used')""")
schema=json.loads((D/(P+'-q3-campaign-schema.json')).read_text(encoding='utf-8'))['payload'];deps=[]
for n,fk in enumerate(schema['inboundFks'],1):
 assert fk['schema']=='public'and all(re.fullmatch(r'[a-z_][a-z0-9_]*',v)for v in [fk['table'],*fk['childColumns'],*fk['parentColumns']])
 join=' and '.join('c."'+a+'"=p."'+b+'"'for a,b in zip(fk['childColumns'],fk['parentColumns']))
 q="select coalesce(jsonb_agg(jsonb_build_object('campaignId',id,'count',n)order by id),'[]')from(select p.id,count(*)n from public.\""+fk['table']+'\" c join public.campaigns p on '+join+' where p.id in('+sqlIds+')group by p.id)s'
 payload=read('q3-dependency-'+str(n),q);deps.append({'fk':fk['name'],'table':fk['table'],'counts':{id:next((x['count']for x in payload if x['campaignId']==id),0)for id in ids}})
notifications=read('q3-notification-references',f"select coalesce(jsonb_agg(jsonb_build_object('campaignId',entity_id,'count',n)order by entity_id),'[]')from(select entity_id,count(*)n from public.notifications where entity_type='campaign'and entity_id in({sqlIds})group by entity_id)s")
# Audit scans expose only exact-ID counts, opaque audit IDs/times and JSON key names.
# No actor IDs, notes, reasons, message bodies or raw state payloads are exported.
pattern='|'.join(ids)
channels=[
 ('operator','public.operator_audit_events',f"target_id::text~'{pattern}'or metadata::text~'{pattern}'",'metadata','target_id'),
 ('workflow','public.mission_workflow_events',f"entity_id::text~'{pattern}'or metadata::text~'{pattern}'",'metadata','entity_id'),
 ('staff','public.staff_access_audit',f"before_state::text~'{pattern}'or after_state::text~'{pattern}'",'before_state','null::uuid')]
audit=[]
for label,table,condition,payloadColumn,entity in channels:
 q=f"""select jsonb_build_object(
  'matchedReferenceCount', (select count(*) from {table} where ({condition})),
  'references', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'auditId', id, 'at', created_at, 'matchedEntityId', matched_entity,
      'payloadKeys', payload_keys
    ) order by created_at, id), '[]'::jsonb)
    from (
      select id, created_at, {entity} as matched_entity,
        (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
         from jsonb_object_keys(case when jsonb_typeof({payloadColumn}) = 'object'
           then {payloadColumn} else '{{}}'::jsonb end) as key) as payload_keys
      from {table}
      where ({condition})
      order by created_at, id
      limit 100
    ) as limited
  )
 )"""
 result=read('q2-audit-'+label,q);audit.append({'channel':table,**result})
summary={'foreignKeyDependencies':deps,'notificationReferences':{id:next((x['count']for x in notifications if x['campaignId']==id),0)for id in ids},'audits':[{k:v for k,v in a.items()if k!='references'}for a in audit],'backupMarkers':'UNKNOWN_PERMISSION_DENIED','topLevelBackupNamedEntries':'UNKNOWN_PERMISSION_DENIED','replicationSlots':cap['replicationSlots'],'walFiles':'UNKNOWN_NOT_READ_AFTER_SERVER_FILE_PERMISSION_DENIAL','replicaIdentity':cap['campaignReplicaIdentity'],'note':'Current settings/WAL/files are not a trusted old tuple; no slot peek/advance, WAL decode, restore or clone created'}
(D/(P+'-dependency-recovery-summary.json')).write_bytes((json.dumps(summary,indent=2)+'\n').encode('utf-8'));print(json.dumps(summary))
