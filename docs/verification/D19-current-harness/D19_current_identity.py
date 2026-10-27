from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys,hashlib
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();D=R/'docs/verification'
def run(args):
 r=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',timeout=20)
 if r.returncode:raise RuntimeError('Read-only Docker metadata unavailable: '+r.stderr[:500])
 return json.loads(r.stdout)
out={'at':datetime.now(timezone.utc).isoformat(),'scope':'Existing authorized disposable targets; metadata before keys, clients, SQL or setup','authorization':'Current user explicitly renews D19 on the already authorized isolated targets','productionQueried':False,'clientsCreated':False,'sqlExecuted':False,'targets':{}}
for kind,apiPort,dbPort in [('empty',56421,56422),('shaped',56521,56522)]:
 old=json.loads((D/('target-'+kind+'.json')).read_text(encoding='utf-8-sig'))['identity']
 assert old['disposable']and old['projectId']=='adfocate-r1-'+kind+'-20261023'and old['proxy']=='none'and old['apiPort']==apiPort
 fmt='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}'
 api=run(['docker','inspect','--format',fmt,old['apiContainerId']]);db=run(['docker','inspect','--format',fmt,old['databaseContainerId']])
 for observed,key,image in [(api,'apiContainerId','apiImageId'),(db,'databaseContainerId','databaseImageId')]:
  assert observed['id']==old[key]and observed['image']==old[image]and observed['running']and observed['project']==old['projectId'],'Exact container/image/project drift'
  assert any(n['NetworkID']==old['networkId']for n in observed['networks'].values()),'Network drift'
 assert any(p['HostIp']=='127.0.0.1'and int(p['HostPort'])==apiPort for p in api['ports']['8000/tcp']),'API mapping mismatch'
 assert any(p['HostIp']=='127.0.0.1'and int(p['HostPort'])==dbPort for p in db['ports']['5432/tcp']),'DB mapping mismatch'
 network=run(['docker','network','inspect','--format','{"id":{{json .Id}},"labels":{{json .Labels}},"options":{{json .Options}}}',old['networkId']])
 assert network['id']==old['networkId']and network['labels']['adfocate.run']==old['runId']and network['options']['com.docker.network.bridge.host_binding_ipv4']=='127.0.0.1','Owner/loopback network mismatch'
 out['targets'][kind]={'identity':old,'api':api,'database':db,'network':network,'apiBinding':{'host':'127.0.0.1','port':apiPort,'containerPort':8000},'databaseBinding':{'host':'127.0.0.1','port':dbPort,'containerPort':5432},'exactPriorIdentityMatched':True}
out['passed']=True;dest=D/'D19-current-identity.json';assert not dest.exists(),'Retain initial identity evidence';dest.write_bytes((json.dumps(out,indent=2)+'\n').encode())
print(json.dumps({'identityGate':'PASS','targets':{k:{'project':v['identity']['projectId'],'apiPort':v['apiBinding']['port'],'databasePort':v['databaseBinding']['port'],'sameContainersImagesNetwork':True}for k,v in out['targets'].items()},'clientOrSqlBeforeIdentity':False}))
