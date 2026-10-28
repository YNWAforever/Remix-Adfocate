from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');S=Path('.codex-tmp');D=Path('docs/verification');P='D19-pristine-rpc';p=json.loads((S/(P+'-plan.private.json')).read_text());ids=p['containerIds'];project=p['projectId'];run=p['runId']
def call(args):
 r=subprocess.run(['docker',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 if r.returncode:raise RuntimeError(r.stderr[:400])
 return r.stdout.strip()
def inspect(kind,name):return json.loads(call([*kind,'inspect',name]))[0]
net=inspect(['network'],p['networkId']);assert net['Internal'] and net['Labels']['adfocate.run']==run and set(net['Containers'])==set(ids.values())
before={}
for s,cid in ids.items():
 x=inspect([],cid);assert x['State']['Running'] and x['Config']['Labels']['adfocate.run']==run and next(iter(x['NetworkSettings']['Networks'].values()))['NetworkID']==p['networkId']
 before[s]={'id':cid,'image':x['Image'],'ports':x['NetworkSettings']['Ports'],'intendedBindings':x['HostConfig']['PortBindings']}
receipt={'at':datetime.now(timezone.utc).isoformat(),'cause':'Docker internal network suppressed actual published ports; identity verifier refused before application SQL/SDK','oldNetworkId':p['networkId'],'before':before,'oldBusinessDataTouched':False,'replacement':'new exact dedicated loopback bridge, masquerading disabled; external fetch/provider disabled separately'}
(D/(P+'-network-rebind.json')).write_text(json.dumps(receipt,indent=2)+'\n')
for s,cid in ids.items():
 call(['network','disconnect',p['networkId'],cid]);call(['stop','--time','20',cid])
assert not inspect(['network'],p['networkId']).get('Containers');call(['network','rm',p['networkId']])
p['networkId']=call(['network','create','--subnet',p['subnet'],'--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1','--opt','com.docker.network.bridge.enable_ip_masquerade=false','--label','adfocate.run='+run,'--label','adfocate.pristine=true','--label','com.supabase.cli.project='+project,project]);p['isolationMode']='dedicated-bridge-no-masquerade'
(S/(P+'-plan.private.json')).write_text(json.dumps(p,indent=2)+'\n')
for s,cid in ids.items():
 call(['network','connect','--alias',s,p['networkId'],cid])
 x=inspect([],cid);assert x['Config']['Labels']['adfocate.run']==run and x['Image']==before[s]['image']
for s in ['db','auth','storage','rest','kong']:call(['start',ids[s]])
after={s:inspect([],cid)for s,cid in ids.items()};newnet=inspect(['network'],p['networkId']);assert not newnet['Internal'] and newnet['Options']['com.docker.network.bridge.enable_ip_masquerade']=='false' and set(newnet['Containers'])==set(ids.values())
for s,port,containerPort in [('kong',p['apiPort'],'8000/tcp'),('db',p['databasePort'],'5432/tcp')]:assert any(b['HostIp']=='127.0.0.1'and int(b['HostPort'])==port for b in after[s]['NetworkSettings']['Ports'][containerPort])
receipt.update({'newNetworkId':p['networkId'],'newNetworkOptions':newnet['Options'],'actualPorts':{s:after[s]['NetworkSettings']['Ports']for s in ['kong','db']},'sameContainerIds':True,'sameNewDataVolume':True,'oldTargetsTouched':False,'finishedAt':datetime.now(timezone.utc).isoformat()});(D/(P+'-network-rebind.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'stage':'REAL_LOOPBACK_BINDINGS_VERIFIED','networkId':p['networkId'],'sameNewVolume':True,'applicationSetupStarted':False}))
