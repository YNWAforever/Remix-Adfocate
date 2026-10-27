from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');S=Path('.codex-tmp');D=Path('docs/verification');P='D19-pristine-rpc';p=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(p['folder']);ids=p['containerIds']
def call(args):
 r=subprocess.run(['docker',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 if r.returncode:raise RuntimeError(r.stderr[:400])
 return r.stdout.strip()
def inspect(id):return json.loads(call(['inspect',id]))[0]
old=inspect(ids['auth']);assert old['State']['Status']=='exited' and old['State']['ExitCode']==1 and not old['Mounts'] and old['Config']['Labels']['adfocate.run']==p['runId']
env=folder/'auth.env';lines=env.read_text().splitlines();assert 'GOTRUE_JWT_KEYS='in lines;env.write_text('\n'.join(l for l in lines if not l.startswith('GOTRUE_JWT_KEYS='))+'\n')
call(['rm',old['Id']]) # Exact new failed container only; no volume, no application data.
args=['create','--pull=never','--name',p['containers']['auth'],'--label','adfocate.run='+p['runId'],'--label','adfocate.pristine=true','--label','com.supabase.cli.project='+p['projectId'],'--network',p['projectId'],'--network-alias','auth','--env-file',str(env),'--memory','192m','--restart=no']
if old['Config'].get('User'):args+=['--user',old['Config']['User']]
args+=[old['Image'],*(old['Config'].get('Cmd')or[])];ids['auth']=call(args);new=inspect(ids['auth'])
assert new['Config']['Labels']['adfocate.run']==p['runId'] and new['Image']==old['Image'] and new['HostConfig']['NetworkMode']==p['projectId']
receipt={'at':datetime.now(timezone.utc).isoformat(),'oldExactFailedNewContainer':old['Id'],'newExactAuthContainer':ids['auth'],'samePinnedImage':old['Image'],'cause':'GOTRUE_JWT_KEYS empty string is invalid JSON in v2.193.0','fix':'omit optional GOTRUE_JWT_KEYS; fresh local HS256 JWT secret retained','source':'https://raw.githubusercontent.com/supabase/auth/v2.193.0/internal/conf/jwk.go','oldApplicationData':False,'oldVolumesRemoved':False,'metadataReverifiedBeforeStartingReplacement':True,'oldIncident':'OPEN; unrelated targets untouched'}
(D/(P+'-auth-recovery.json')).write_text(json.dumps(receipt,indent=2)+'\n');(S/(P+'-plan.private.json')).write_text(json.dumps(p,indent=2)+'\n')
for service in ['auth','storage','rest','kong']:
 x=inspect(ids[service]);assert x['State']['Status']=='created' and x['Config']['Labels']['adfocate.run']==p['runId'] and x['HostConfig']['NetworkMode']==p['projectId'];call(['start',ids[service]])
p['stage']='STARTED_NO_APPLICATION_SETUP';p['createdAt']=datetime.now(timezone.utc).isoformat();(S/(P+'-plan.private.json')).write_text(json.dumps(p,indent=2)+'\n')
print(json.dumps({'stage':p['stage'],'containerCount':len(ids),'authReplacedAfterConfigFailure':True,'applicationSetupStarted':False}))
