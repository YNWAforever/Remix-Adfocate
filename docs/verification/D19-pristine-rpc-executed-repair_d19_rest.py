from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,shutil,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';p=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(p['folder']);ids=p['containerIds'];observer=json.loads((S/(P+'-observer.private.json')).read_text());node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
def call(args,input=None):
 r=subprocess.run(args,input=input,capture_output=True,text=True,encoding='utf-8',timeout=60)
 if r.returncode:raise RuntimeError(r.stderr[:500])
 return r.stdout.strip()
def inspect(cid):return json.loads(call(['docker','inspect',cid]))[0]
def verify():assert call([node,str(S/(P+'-verify.mjs')),str(folder/'integration-env.private.json')])=='verified-before-setup'
verify()
def sql(q):return call(['docker','exec','-i',ids['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',observer['databaseRole'],'-d',observer['databaseName']],q)
before=json.loads(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',coalesce((select jsonb_agg(id order by id)from auth.users),'[]'),'creators',(select count(*)from public.creators),'submissions',(select count(*)from public.mission_submissions),'snapshots',(select count(*)from public.campaign_rank_snapshots));commit;"))
owned=[json.loads(l)for l in (S/(P+'-owned.private.jsonl')).read_text().splitlines()if l];users=sorted({v for r in owned if r['table']=='auth_users'for v in r['ids']});assert len(users)==1 and users==before['authUsers'] and all(before[k]==0 for k in ['campaigns','creators','submissions','snapshots'])
assert not (S/(P+'-calls.private.jsonl')).read_text().strip()
for suffix in ['integration.private.log','integration.private.json']:shutil.copyfile(S/(P+'-'+suffix),S/(P+'-'+suffix.replace('integration.','integration-attempt2.')))
for name in ['fixture','run']:shutil.copyfile(D/(P+'-'+name+'.json'),D/(P+'-'+name+'-attempt2.json'))
old=inspect(ids['rest']);assert old['State']['Running'] and old['Config']['Labels']['adfocate.run']==p['runId'] and not old['Mounts']
envPath=folder/'rest.env';env=dict(l.split('=',1)for l in envPath.read_text().splitlines()if '='in l);assert env['PGRST_JWT_SECRET'].startswith('{');dbEnv=dict(l.split('=',1)for l in (folder/'db.env').read_text().splitlines()if '='in l);env['PGRST_JWT_SECRET']=dbEnv['JWT_SECRET'];envPath.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
call(['docker','stop','--time','20',old['Id']]);call(['docker','rm',old['Id']])
args=['docker','create','--pull=never','--name',p['containers']['rest'],'--label','adfocate.run='+p['runId'],'--label','adfocate.pristine=true','--label','com.supabase.cli.project='+p['projectId'],'--network',p['projectId'],'--network-alias','rest','--env-file',str(envPath),'--memory','192m','--restart=no']
if old['Config'].get('User'):args+=['--user',old['Config']['User']]
args+=[old['Image'],*(old['Config'].get('Cmd')or[])];ids['rest']=call(args)
x=inspect(ids['rest']);assert x['Config']['Labels']['adfocate.run']==p['runId'] and x['Image']==old['Image'] and x['HostConfig']['NetworkMode']==p['projectId'];call(['docker','start',ids['rest']])
runtime=json.loads((folder/'integration-env.private.json').read_text());receipt=json.loads(runtime['INTEGRATION_PRISTINE_TARGET_JSON']);receipt['containerIds']=list(ids.values());receipt['restReplacement']={'old':old['Id'],'new':ids['rest'],'reason':'new local HS256 credentials require matching PGRST_JWT_SECRET; copied source JWK set was unrelated'};runtime['INTEGRATION_PRISTINE_TARGET_JSON']=json.dumps(receipt);(folder/'integration-env.private.json').write_text(json.dumps(runtime)+'\n')
(D/(P+'-current-attestation.json')).write_text(json.dumps(receipt,indent=2)+'\n');(S/(P+'-plan.private.json')).write_text(json.dumps(p,indent=2)+'\n');verify()
# Only the exact new Auth ID captured on successful creation; no discovery by email.
sql("begin;delete from auth.users where id='"+users[0]+"';commit;")
after=json.loads(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users),'submissions',(select count(*)from public.mission_submissions),'snapshots',(select count(*)from public.campaign_rank_snapshots));commit;"));assert all(v==0 for v in after.values())
record={'at':datetime.now(timezone.utc).isoformat(),'status':'TARGET_CONFIGURATION_REPAIRED_BEFORE_ANY_GLOBAL_RPC','failedTests':2,'skippedTests':3,'globalRpcCalls':0,'cause':'Copied PostgREST JWK set did not match freshly generated HS256 credentials','resolution':'Same pinned PostgREST image, correct fresh local JWT secret, metadata reverified before any next test','oldRestExactId':old['Id'],'newRestExactId':ids['rest'],'removedAuthFixtureExactIds':users,'cleanupAuthority':'Successful Auth create captured in this attempt owned-ID journal; all Auth IDs equal this exact set; no creators/workflows/submissions/rank snapshots exist','before':before,'after':after,'originalIncident':'OPEN; no old target reads/writes/restoration'}
(D/(P+'-rest-recovery.json')).write_text(json.dumps(record,indent=2)+'\n');p['stage']='SCHEMA_READY_PRISTINE';p['retryAfterExactIdCleanup']=after;(S/(P+'-plan.private.json')).write_text(json.dumps(p,indent=2)+'\n');print(json.dumps({'newRestId':ids['rest'],'exactAuthFixtureRemoved':len(users),'freshBeforeNextAttempt':after,'oldTargetsTouched':False}))
