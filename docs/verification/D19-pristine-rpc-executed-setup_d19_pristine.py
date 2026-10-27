from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';plan=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(plan['folder']);ids=plan['containerIds'];project=plan['projectId'];run=plan['runId']
def call(args,input=None):
 p=subprocess.run(args,input=input,capture_output=True,text=True,encoding='utf-8',timeout=90)
 if p.returncode:raise RuntimeError(p.stderr[:1200])
 return p.stdout.strip()
def inspect(kind,name):return json.loads(call(['docker',*kind,'inspect',name]))[0]
def put(n,v):(D/(P+'-'+n+'.json')).write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
assert plan['stage']=='STARTED_NO_APPLICATION_SETUP'
containers={s:inspect([],cid)for s,cid in ids.items()};net=inspect(['network'],plan['networkId']);volume=inspect(['volume'],plan['volume'])
assert not net['Internal'] and net['Options']['com.docker.network.bridge.enable_ip_masquerade']=='false' and net['Labels']['adfocate.run']==run and set(net['Containers'])==set(ids.values())
for s,x in containers.items():
 assert x['State']['Running'] and x['Config']['Labels']['com.supabase.cli.project']==project and x['Config']['Labels']['adfocate.run']==run
 assert len(x['NetworkSettings']['Networks'])==1 and next(iter(x['NetworkSettings']['Networks'].values()))['NetworkID']==plan['networkId']
 for bindings in (x['HostConfig']['PortBindings']or{}).values():assert all(b['HostIp']=='127.0.0.1'for b in bindings)
identity={'runId':run,'ownerAuthorization':plan['authorization'],'disposable':True,'projectId':project,'proxy':'none','apiPort':plan['apiPort'],'apiContainerId':ids['kong'],'databaseContainerId':ids['db'],'apiImageId':containers['kong']['Image'],'databaseImageId':containers['db']['Image'],'networkId':plan['networkId']}
env=json.loads((folder/'keys.private.json').read_text());env['INTEGRATION_TARGET_IDENTITY_JSON']=json.dumps(identity)
envPath=folder/'integration-env.private.json';envPath.write_text(json.dumps(env)+'\n')
node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
verifier=S/(P+'-verify.mjs');verifier.write_text("import{readFileSync}from'node:fs';import{verifyIntegrationIdentity}from'../scripts/run-integration-tests.mjs';const env=JSON.parse(readFileSync(process.argv[2],'utf8'));verifyIntegrationIdentity(env);process.stdout.write('verified-before-setup');\n")
assert call([node,str(verifier),str(envPath)])=='verified-before-setup'
put('runtime-identity-before-setup',{'at':datetime.now(timezone.utc).isoformat(),'identity':identity,'containerIds':ids,'images':{s:x['Image']for s,x in containers.items()},'networkId':plan['networkId'],'internal':False,'masquerading':False,'exclusiveMembers':True,'volumeName':plan['volume'],'volumeCreatedAt':volume['CreatedAt'],'freshVolumeOnly':True,'apiBindings':containers['kong']['NetworkSettings']['Ports'],'dbBindings':containers['db']['NetworkSettings']['Ports'],'normalIdentityVerifierPassed':True,'clientsCreated':False,'applicationSetupStarted':False})
role=re.search(r'"-U", "([^"]+)", "-d", "([^"]+)"',(R/'scripts/audit/local-targets.mjs').read_text());assert role
def sql(query):return call(['docker','exec','-i',ids['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',role[1],'-d',role[2]],query)
baseline=json.loads(sql("begin read only;select jsonb_build_object('publicTables',(select count(*)from pg_tables where schemaname='public'),'authUsers',(select count(*)from auth.users),'storageObjects',(select count(*)from storage.objects),'storageBuckets',(select count(*)from storage.buckets));commit;"))
assert all(v==0 for v in baseline.values()),baseline
receipt={'identity':identity,'createdThisRun':True,'isolationMode':plan['isolationMode'],'volumeWasAbsent':True,'networkWasAbsent':True,'databaseCreatedAt':containers['db']['Created'],'volumeName':plan['volume'],'volumeCreatedAt':volume['CreatedAt'],'containerIds':list(ids.values()),'pristineBaseline':{'campaigns':0,**baseline},'ownerAuthorization':plan['authorization'],'observedAt':datetime.now(timezone.utc).isoformat(),'baselineSource':'Actual SQL observation after Docker identity gate and vendor bootstrap; public schema has zero tables, zero Auth users and zero storage objects/buckets; no copied business rows'}
env['INTEGRATION_PRISTINE_TARGET_JSON']=json.dumps(receipt);envPath.write_text(json.dumps(env)+'\n');assert call([node,str(verifier),str(envPath)])=='verified-before-setup'
put('pristine-baseline',receipt)
manifest=json.loads((R/'supabase/release-manifest.json').read_text());manifestResults=[]
for m in manifest['migrations']:
 assert hashlib.sha256((R/m['path']).read_bytes().replace(b'\r\n',b'\n')).hexdigest()==m['sha256'];manifestResults.append(m['path'])
sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);')
replay=[]
for path in sorted((R/'supabase/migrations').glob('*.sql')):
 match=re.fullmatch(r'(\d+)_([a-z0-9_]+)\.sql',path.name);assert match
 source=path.read_text(encoding='utf-8-sig');body=re.sub(r'^begin;\s*$|^commit;\s*$','',source,flags=re.M|re.I)
 sql('begin;\n'+body+f"\ninsert into supabase_migrations.schema_migrations(version,name)values('{match[1]}','{match[2]}');commit;")
 replay.append({'path':path.relative_to(R).as_posix(),'sha256':hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'status':'applied-in-new-target-only'})
 put('schema-replay',{'identity':identity,'migrationCount':len(replay),'manifestVerifiedCount':len(manifestResults),'migrations':replay,'reset':False,'oldMigrationChecksumChanged':False,'oldTargetSql':False,'seedCommandsRun':False,'finished':False})
sql("notify pgrst,'reload schema';")
after=json.loads(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users),'history',(select count(*)from supabase_migrations.schema_migrations));commit;"));assert after['campaigns']==0 and after['authUsers']==0 and after['history']==len(replay)
query=json.loads((D/'D19-support-current-schema-before.json').read_text())['schemaQuery'] if 'schemaQuery'in json.loads((D/'D19-support-current-schema-before.json').read_text()) else json.loads((D/'D19-support-current-schema-before.json').read_text())['query']
observed=json.loads(sql('begin read only;'+query+'commit;'));put('schema-before-tests',{'identity':identity,'query':query,'observed':observed,'counts':after})
put('schema-replay',{'identity':identity,'migrationCount':len(replay),'manifestVerifiedCount':len(manifestResults),'migrations':replay,'reset':False,'oldMigrationChecksumChanged':False,'oldTargetSql':False,'seedCommandsRun':False,'finished':True,'after':after})
plan['stage']='SCHEMA_READY_PRISTINE';(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n')
print(json.dumps({'stage':plan['stage'],'migrations':len(replay),'manifest':len(manifestResults),'campaignsBeforeFixtures':after['campaigns'],'authUsersBeforeFixtures':after['authUsers']}))
