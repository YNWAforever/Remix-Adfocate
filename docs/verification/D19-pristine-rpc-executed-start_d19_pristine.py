from pathlib import Path
from datetime import datetime,timezone
import base64,hashlib,hmac,json,re,subprocess,sys,time
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc'
plan=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(plan['folder']);project=plan['projectId'];run=plan['runId'];ids=plan['containerIds']
def docker(args,check=True,input=None):
 p=subprocess.run(['docker',*args],input=input,capture_output=True,text=True,encoding='utf-8',timeout=60)
 if check and p.returncode:raise RuntimeError('Docker '+args[0]+' failed: '+p.stderr[:400])
 return p
def inspect(kind,name):return json.loads(docker([*kind,'inspect',name]).stdout)[0]
def put(n,v):(D/(P+'-'+n+'.json')).write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
assert plan['stage']=='CREATING' and len(ids)==4
assert docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']).stdout.strip()=='npipe:////./pipe/dockerDesktopLinuxEngine'
# Recover only the exact already-created, never-started resources. No recreation/reset.
for s,cid in ids.items():
 x=inspect([],cid);assert x['State']['Status']=='created' and x['HostConfig']['NetworkMode']==project and x['Config']['Labels']['adfocate.run']==run
 db=x if s=='db'else locals().get('db')
def readenv(p):return dict(line.split('=',1)for line in p.read_text().splitlines()if '='in line)
dbEnv=readenv(folder/'db.env');jwt=dbEnv['JWT_SECRET'];pw=dbEnv['POSTGRES_PASSWORD']
tokens={}
for token in set(re.findall(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',(folder/'kong.yml').read_text())):
 a,b,c=token.split('.');payload=json.loads(base64.urlsafe_b64decode(b+'='*((-len(b))%4)))
 assert hmac.compare_digest(base64.urlsafe_b64decode(c+'='*((-len(c))%4)),hmac.new(jwt.encode(),(a+'.'+b).encode(),hashlib.sha256).digest())
 if payload.get('role')in ['anon','service_role']:tokens[payload['role']]=token
assert set(tokens)=={'anon','service_role'}
(folder/'keys.private.json').write_text(json.dumps({'SUPABASE_URL':f"http://127.0.0.1:{plan['apiPort']}",'SUPABASE_ANON_KEY':tokens['anon'],'SUPABASE_SERVICE_KEY':tokens['service_role']})+'\n')
# Vendor Storage migrations are needed by the unchanged application migration set.
# It receives an empty container filesystem; never mount an old storage/data volume.
sourceProject='adfocate-r1-empty-20261023';source=inspect([],'supabase_storage_'+sourceProject);sourceDb=inspect([],'supabase_db_'+sourceProject)
oldEnv=dict(e.split('=',1)for e in sourceDb['Config']['Env']);oldjwt=oldEnv['JWT_SECRET'];oldpw=oldEnv['POSTGRES_PASSWORD']
oldkeys=json.loads([l for l in (S/'empty-start.private.log').read_text().splitlines()if l.startswith('{"DB_URL"')][-1])
env={}
for item in source['Config']['Env']:
 key,value=item.split('=',1)
 for a,b in [(sourceProject,project),(oldjwt,jwt),(oldkeys['ANON_KEY'],tokens['anon']),(oldkeys['SERVICE_ROLE_KEY'],tokens['service_role']),(':'+oldpw+'@',':'+pw+'@'),('127.0.0.1:56421',f"127.0.0.1:{plan['apiPort']}")]:value=value.replace(a,b)
 env[key]=value
env['STORAGE_BACKEND']='file';(folder/'storage.env').write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
storageName='supabase_storage_'+project
absent=docker(['inspect',storageName],False);assert absent.returncode and absent.stdout.strip()=='[]' and 'no such' in absent.stderr.lower()
args=['create','--pull=never','--name',storageName,'--label','adfocate.run='+run,'--label','adfocate.pristine=true','--label','com.supabase.cli.project='+project,'--network',project,'--network-alias','storage','--env-file',str(folder/'storage.env'),'--memory','192m','--restart=no']
entry=source['Config'].get('Entrypoint')
if entry:assert len(entry)==1;args+=['--entrypoint',entry[0]]
if source['Config'].get('User'):args+=['--user',source['Config']['User']]
args+=[source['Image'],*(source['Config'].get('Cmd')or[])]
ids['storage']=docker(args).stdout.strip();plan['containers']['storage']=storageName
(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n')
network=inspect(['network'],plan['networkId']);volume=inspect(['volume'],plan['volume']);assert network['Internal'] and not network.get('Containers') and network['Labels']['adfocate.run']==run and volume['Labels']['adfocate.run']==run
images={}
for s,cid in ids.items():
 x=inspect([],cid);images[s]=x['Image'];assert x['Id']==cid and x['State']['Status']=='created' and x['Config']['Labels']['adfocate.run']==run
 assert x['HostConfig']['NetworkMode']==project and list(x['NetworkSettings']['Networks'])==[project]
 if s=='db':
  writable=[m for m in x['Mounts']if m['RW']];assert len(writable)==1 and writable[0]['Name']==plan['volume']
  for bindings in x['HostConfig']['PortBindings'].values():assert all(b['HostIp']=='127.0.0.1'for b in bindings)
put('prestart-identity',{'at':datetime.now(timezone.utc).isoformat(),'authorization':plan['authorization'],'projectId':project,'runId':run,'containerIds':ids,'images':images,'networkId':plan['networkId'],'volumeName':plan['volume'],'volumeCreatedAt':volume['CreatedAt'],'exclusiveNewInternalNetwork':True,'freshVolumeOnly':True,'metadataVerifiedBeforeStartHealthOrApplicationSetup':True,'clientsCreated':False,'applicationSqlExecuted':False,'provisioningInterruption':'Docker leaves NetworkID blank until start; verified exact HostConfig.NetworkMode and intended network before starting these same IDs'})
for s in ['db','auth','storage','rest','kong']:
 docker(['start',ids[s]])
 assert inspect([],ids[s])['State']['Running']
 if s=='db':
  for _ in range(40):
   if docker(['exec',ids[s],'pg_isready','-h','127.0.0.1','-p','5432'],False).returncode==0:break
   time.sleep(1)
  else:raise RuntimeError('Attested new DB not ready')
plan.update({'stage':'STARTED_NO_APPLICATION_SETUP','createdAt':datetime.now(timezone.utc).isoformat()});(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n')
put('creation',{'at':plan['createdAt'],'authorization':plan['authorization'],'runId':run,'projectId':project,'networkId':plan['networkId'],'volumeName':plan['volume'],'volumeWasAbsent':True,'networkWasAbsent':True,'newCredentialsGenerated':True,'oldVolumesMounted':False,'proxy':'none','containerIds':ids,'images':images,'apiBinding':{'host':'127.0.0.1','port':plan['apiPort'],'containerPort':8000},'databaseBinding':{'host':'127.0.0.1','port':plan['databasePort'],'containerPort':5432},'providerEnabled':False,'applicationSetupStarted':False,'storage':'fresh vendor bootstrap only; no old storage volume'})
print(json.dumps({'stage':plan['stage'],'projectId':project,'newContainers':len(ids),'applicationSetupStarted':False}))
