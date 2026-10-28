from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';plan=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(plan['folder']);envPath=folder/'integration-env.private.json';env=json.loads(envPath.read_text());node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
def call(args,input=None):
 p=subprocess.run(args,input=input,capture_output=True,text=True,encoding='utf-8',timeout=90)
 if p.returncode:raise RuntimeError(p.stderr[:1000])
 return p.stdout.strip()
assert call([node,str(S/(P+'-verify.mjs')),str(envPath)])=='verified-before-setup'
role=re.search(r'"-U", "([^"]+)", "-d", "([^"]+)"',(R/'scripts/audit/local-targets.mjs').read_text());assert role
def sql(q):return call(['docker','exec','-i',plan['containerIds']['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',role[1],'-d',role[2]],q)
def put(n,v):(D/(P+'-'+n+'.json')).write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
prior=json.loads((D/(P+'-schema-replay.json')).read_text());assert not prior['finished'] and prior['migrationCount']==30
(D/(P+'-schema-replay-interrupted.json')).write_bytes((D/(P+'-schema-replay.json')).read_bytes())
history=json.loads(sql("begin read only;select jsonb_agg(version order by version)from supabase_migrations.schema_migrations;commit;"));assert history==[Path(x['path']).name.split('_')[0]for x in prior['migrations']]
assert sql("begin read only;select (to_regclass('public.mission_deliverable_templates')is null)::text;commit;")=='true'
baseline=json.loads(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users));commit;"));assert baseline=={'campaigns':0,'authUsers':0}
defaults="select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'schema',n.nspname,'type',a.defaclobjtype,'acl',a.defaclacl::text)order by r.rolname,n.nspname,a.defaclobjtype),'[]')from pg_default_acl a join pg_roles r on r.oid=a.defaclrole left join pg_namespace n on n.oid=a.defaclnamespace;"
before=json.loads(sql('begin read only;'+defaults+'commit;'))
# Match the explicitly pinned CLI provider profile. No old target is queried or altered.
config="alter default privileges in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;alter default privileges in schema public revoke usage,select on sequences from anon,authenticated,service_role;"
sql('begin;'+config+'commit;')
old=json.loads((D/'D19-support-current-schema-before.json').read_text());expected=old['targets']['empty']['observed']['tables'];current=json.loads(sql("begin read only;select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl)order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind='r';commit;"))
letters={'r':'select','a':'insert','w':'update','d':'delete','D':'truncate','x':'references','t':'trigger','m':'maintain'};statements=[];diff=[]
for table in current:
 original=next(t for t in expected if t['name']==table['name']);assert re.fullmatch(r'[a-z_][a-z0-9_]*',table['name'])
 def grants(acl,who):return next((a.split('=',1)[1].split('/')[0]for a in acl or[]if a.startswith(who+'=')),'')
 for who in ['anon','authenticated','service_role']:
  wanted=grants(original['acl'],who);actual=grants(table['acl'],who)
  if set(wanted)!=set(actual):
   assert all(x in letters for x in wanted);diff.append({'table':table['name'],'role':who,'before':actual,'expected':wanted})
   statements.append(f'revoke all on public."{table["name"]}" from {who};')
   if wanted:statements.append(f'grant {",".join(letters[x]for x in wanted)} on public."{table["name"]}" to {who};')
if statements:sql('begin;'+''.join(statements)+'commit;')
put('provider-profile-alignment',{'at':datetime.now(timezone.utc).isoformat(),'identity':json.loads(env['INTEGRATION_TARGET_IDENTITY_JSON']),'cause':'Direct vendor container bootstrap retained auto-expose defaults; original CLI profile explicitly pins auto_expose_new_tables=false. Failed migration transaction rolled back; no test or assertion weakened.','failedMigration':'20260715163350_active_mission_workspace.sql','originalError':'authenticated_grant_drift:mission_deliverable_templates','priorHistoryPreserved':history,'zeroBusinessAndAuthRowsBeforeResume':baseline,'defaultPrivilegesBefore':before,'defaultPrivilegesAfter':json.loads(sql('begin read only;'+defaults+'commit;')),'providerConfigurationSql':config,'existingLegacyTableAclDiff':diff,'existingLegacyTableAclAlignmentSql':statements,'comparisonSource':'D19-support-current-schema-before.json targets.empty.observed.tables; locally captured candidate catalog, not production reads','oldTargetQueriedOrChanged':False,'migrationSourceChanged':False})
replay=prior['migrations']
for path in sorted((R/'supabase/migrations').glob('*.sql')):
 match=re.fullmatch(r'(\d+)_([a-z0-9_]+)\.sql',path.name);assert match
 if match[1]in history:continue
 source=path.read_text(encoding='utf-8-sig');body=re.sub(r'^begin;\s*$|^commit;\s*$','',source,flags=re.M|re.I)
 sql('begin;\n'+body+f"\ninsert into supabase_migrations.schema_migrations(version,name)values('{match[1]}','{match[2]}');commit;")
 replay.append({'path':path.relative_to(R).as_posix(),'sha256':hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'status':'applied-in-new-target-only'})
 put('schema-replay',{**prior,'migrationCount':len(replay),'migrations':replay,'finished':False})
sql("notify pgrst,'reload schema';")
after=json.loads(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users),'history',(select count(*)from supabase_migrations.schema_migrations));commit;"));assert after['campaigns']==0 and after['authUsers']==0 and after['history']==72
observed=json.loads(sql('begin read only;'+old['query']+'commit;'));put('schema-before-tests',{'identity':json.loads(env['INTEGRATION_TARGET_IDENTITY_JSON']),'query':old['query'],'observed':observed,'counts':after})
put('schema-replay',{**prior,'migrationCount':len(replay),'migrations':replay,'finished':True,'after':after,'providerProfileAlignment':P+'-provider-profile-alignment.json'})
plan['stage']='SCHEMA_READY_PRISTINE';(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n')
print(json.dumps({'stage':plan['stage'],'migrations':len(replay),'manifest':prior['manifestVerifiedCount'],'legacyAclAlignments':len(diff),'campaigns':after['campaigns'],'authUsers':after['authUsers']}))
