from pathlib import Path
from datetime import datetime, timezone
import base64, hashlib, hmac, json, os, re, secrets, socket, subprocess, sys, time
sys.stdout.reconfigure(encoding='utf-8')
R=Path.cwd(); S=R/'.codex-tmp'; D=R/'docs/verification'; P='D19-pristine-rpc'
plan=json.loads((S/(P+'-plan.private.json')).read_text(encoding='utf-8'))
project=plan['projectId']; run=plan['runId']; folder=S/project
def docker(args,check=True,input=None):
 p=subprocess.run(['docker',*args],input=input,capture_output=True,text=True,encoding='utf-8',timeout=60)
 if check and p.returncode: raise RuntimeError('Docker command failed: '+args[0]+'; '+p.stderr[:500])
 return p
def inspect(kind,name):return json.loads(docker([*kind,'inspect',name]).stdout)[0]
def put(name,obj):(D/(P+'-'+name+'.json')).write_text(json.dumps(obj,indent=2)+'\n',encoding='utf-8')
assert docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']).stdout.strip()=='npipe:////./pipe/dockerDesktopLinuxEngine'
assert project.startswith('adfocate-d19-pristine-') and run in plan['runId']
for port in [plan['apiPort'],plan['databasePort']]:
 with socket.socket() as sock:sock.bind(('127.0.0.1',port))
for args,name in [(['network'],plan['network']),(['volume'],plan['volume'])]+[([],n)for n in plan['containers'].values()]:
 result=docker([*args,'inspect',name],False)
 assert result.returncode!=0 and result.stdout.strip()=='[]' and ('no such' in result.stderr.lower() or 'not found' in result.stderr.lower()),(args,name,'not proven absent')
assert plan['stage']=='PLANNED';folder.mkdir(exist_ok=True)
source_project='adfocate-r1-empty-20261023'
sources={s:inspect([],f'supabase_{s}_{source_project}')for s in ['db','rest','auth','kong']}
expected={'db':'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453','kong':'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d'}
for s,x in sources.items():
 assert x['Config']['Labels']['com.supabase.cli.project']==source_project and not x['HostConfig']['Privileged']
 if s in expected:assert x['Image']==expected[s]
envs={s:dict(e.split('=',1)for e in x['Config']['Env'])for s,x in sources.items()}
oldjwt=envs['db']['JWT_SECRET'];oldpw=envs['db']['POSTGRES_PASSWORD'];jwt=secrets.token_urlsafe(48);pw=secrets.token_urlsafe(32)
def b64(b):return base64.urlsafe_b64encode(b).decode().rstrip('=')
def token(role):
 now=int(time.time());unsigned=b64(b'{"alg":"HS256","typ":"JWT"}')+'.'+b64(json.dumps({'role':role,'iss':'supabase','iat':now,'exp':now+86400},separators=(',',':')).encode())
 return unsigned+'.'+b64(hmac.new(jwt.encode(),unsigned.encode(),hashlib.sha256).digest())
anon=token('anon');service=token('service_role')
lines=(S/'empty-start.private.log').read_text(encoding='utf-8').splitlines();oldkeys=json.loads([l for l in lines if l.startswith('{"DB_URL"')][-1])
replace={source_project:project,oldjwt:jwt,oldkeys['ANON_KEY']:anon,oldkeys['SERVICE_ROLE_KEY']:service,'127.0.0.1:56421':f"127.0.0.1:{plan['apiPort']}"}
def rewrite(value):
 for a,b in sorted(replace.items(),key=lambda x:len(x[0]),reverse=True):value=value.replace(a,b)
 return value.replace(':'+oldpw+'@',':'+pw+'@')
for s,env in envs.items():
 envs[s]={k:rewrite(v)for k,v in env.items()}
 for key in ['POSTGRES_PASSWORD','PGPASSWORD']:
  if key in envs[s]:envs[s][key]=pw
 if s=='auth':
  envs[s].update({'GOTRUE_JWT_KEYS':'','GOTRUE_JWT_VALIDMETHODS':'HS256','GOTRUE_JWT_VALID_METHODS':'HS256','GOTRUE_SMTP_HOST':'127.0.0.1','GOTRUE_SMTP_PORT':'1','GOTRUE_RATE_LIMIT_TOKEN_REFRESH':'1000','GOTRUE_RATE_LIMIT_EMAIL_SENT':'0'})
 if s=='kong':
  envs[s].pop('KONG_SSL_CERT',None);envs[s].pop('KONG_SSL_CERT_KEY',None);envs[s]['KONG_PROXY_LISTEN']='0.0.0.0:8000';envs[s]['KONG_NGINX_WORKER_PROCESSES']='1'
 (folder/(s+'.env')).write_text('\n'.join(k+'='+v for k,v in envs[s].items())+'\n',encoding='utf-8')
pgkey=folder/'pgsodium-root.key';pgkey.write_text(secrets.token_hex(32),encoding='utf-8')
kongsource=next(m['Source']for m in sources['kong']['Mounts']if m['Destination']=='/home/kong/kong.yml')
kongfile=folder/'kong.yml';kongfile.write_text(rewrite(Path(kongsource).read_text(encoding='utf-8')),encoding='utf-8')
labels=['--label','adfocate.run='+run,'--label','adfocate.pristine=true','--label','com.supabase.cli.project='+project]
networkId=docker(['network','create','--internal','--subnet',plan['subnet'],'--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',*labels,project]).stdout.strip()
docker(['volume','create',*labels,plan['volume']])
ids={}
put('creation-start',{'at':datetime.now(timezone.utc).isoformat(),'authorization':plan['authorization'],'runId':run,'projectId':project,'networkId':networkId,'volumeName':plan['volume'],'volumeWasAbsent':True,'networkWasAbsent':True,'newCredentialsGenerated':True,'oldVolumesMounted':False,'proxy':'none','containers':ids,'stage':'NEW_RESOURCES_CREATED_BEFORE_CLIENTS_OR_APPLICATION_SETUP'})
for s in ['db','auth','rest','kong']:
 x=sources[s];args=['create','--pull=never','--name',plan['containers'][s],*labels,'--network',project,'--network-alias',s,'--env-file',str(folder/(s+'.env')),'--memory',('768m'if s=='db'else'192m'),'--restart=no']
 if s=='db':args+=['--publish',f"127.0.0.1:{plan['databasePort']}:5432",'--mount',f"type=volume,src={plan['volume']},dst=/var/lib/postgresql/data",'--mount',f'type=bind,src={pgkey},dst=/etc/postgresql-custom/pgsodium_root.key,readonly']
 if s=='kong':args+=['--publish',f"127.0.0.1:{plan['apiPort']}:8000",'--mount',f'type=bind,src={kongfile},dst=/home/kong/kong.yml,readonly']
 entry=x['Config'].get('Entrypoint');cmd=x['Config'].get('Cmd')or[]
 if entry:assert len(entry)==1;args+=['--entrypoint',entry[0]]
 if x['Config'].get('User'):args+=['--user',x['Config']['User']]
 if s=='db':cmd=[v.replace(' -D /etc/postgresql',' -D /etc/postgresql -c cron.launch_active_jobs=off')for v in cmd]
 args+=[x['Image'],*cmd]
 ids[s]=docker(args).stdout.strip()
 # Record each new ID immediately; failure never triggers broad cleanup or recreation.
 plan.update({'containerIds':ids,'networkId':networkId,'folder':str(folder),'stage':'CREATING'})
 (S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
network=inspect(['network'],networkId);volume=inspect(['volume'],plan['volume'])
assert network['Internal'] and network['Labels']['adfocate.run']==run and volume['Labels']['adfocate.run']==run
for s,cid in ids.items():
 x=inspect([],cid)
 assert x['Id']==cid and x['Image']==sources[s]['Image'] and x['Config']['Labels']['adfocate.run']==run
 assert len(x['NetworkSettings']['Networks'])==1 and next(iter(x['NetworkSettings']['Networks'].values()))['NetworkID']==networkId
 if s=='db':
  writable=[m for m in x['Mounts']if m['RW']]
  assert len(writable)==1 and writable[0]['Name']==plan['volume']
put('prestart-identity',{'at':datetime.now(timezone.utc).isoformat(),'projectId':project,'runId':run,'containerIds':ids,'networkId':networkId,'volumeName':plan['volume'],'volumeCreatedAt':volume['CreatedAt'],'exclusiveNewInternalNetwork':True,'freshVolumeOnly':True,'metadataVerifiedBeforeStartHealthOrApplicationSetup':True,'clientsCreated':False,'applicationSqlExecuted':False})
for s in ['db','auth','rest','kong']:
 docker(['start',ids[s]])
 if s=='db':
  assert inspect([],ids[s])['State']['Running']
  for _ in range(45):
   ready=docker(['exec',ids[s],'pg_isready','-h','127.0.0.1','-p','5432'],False)
   if ready.returncode==0:break
   time.sleep(1)
  else:raise RuntimeError('New attested DB did not become ready; retain exact resources')
plan.update({'containerIds':ids,'networkId':networkId,'folder':str(folder),'createdAt':datetime.now(timezone.utc).isoformat(),'stage':'CREATED_NO_APPLICATION_SETUP'})
(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
(folder/'keys.private.json').write_text(json.dumps({'SUPABASE_URL':f"http://127.0.0.1:{plan['apiPort']}",'SUPABASE_ANON_KEY':anon,'SUPABASE_SERVICE_KEY':service})+'\n',encoding='utf-8')
put('creation',{'at':plan['createdAt'],'authorization':plan['authorization'],'runId':run,'projectId':project,'networkId':networkId,'volumeName':plan['volume'],'volumeWasAbsent':True,'networkWasAbsent':True,'newCredentialsGenerated':True,'oldVolumesMounted':False,'proxy':'none','containerIds':ids,'images':{s:x['Image']for s,x in sources.items()},'apiBinding':{'host':'127.0.0.1','port':plan['apiPort'],'containerPort':8000},'databaseBinding':{'host':'127.0.0.1','port':plan['databasePort'],'containerPort':5432},'providerEnabled':False,'applicationSetupStarted':False})
print(json.dumps({'stage':plan['stage'],'projectId':project,'newContainers':len(ids),'networkId':networkId,'allNewVolume':True,'applicationSetupStarted':False}))
