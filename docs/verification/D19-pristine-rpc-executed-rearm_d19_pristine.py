from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,shutil,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';plan=json.loads((S/(P+'-plan.private.json')).read_text());folder=Path(plan['folder']);node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
r=subprocess.run([node,str(S/(P+'-verify.mjs')),str(folder/'integration-env.private.json')],capture_output=True,text=True);assert r.returncode==0,r.stderr
observer=json.loads((S/(P+'-observer.private.json')).read_text())
q="begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users),'submissions',(select count(*)from public.mission_submissions),'snapshots',(select count(*)from public.campaign_rank_snapshots));commit;"
r=subprocess.run(['docker','exec','-i',plan['containerIds']['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',observer['databaseRole'],'-d',observer['databaseName']],input=q,capture_output=True,text=True);assert r.returncode==0,r.stderr
counts=json.loads(r.stdout);assert all(v==0 for v in counts.values()),counts
for name in ['fixture','run']:shutil.copyfile(D/(P+'-'+name+'.json'),D/(P+'-'+name+'-attempt1.json'))
raw=json.loads((S/(P+'-integration-attempt1.private.json')).read_text(encoding='utf-8-sig'))
(D/(P+'-integration-attempt1.json')).write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'passed':raw['numPassedTests'],'failed':raw['numFailedTests'],'skipped':raw['numPendingTests'],'cause':'Shared deny-external-fetch preload permits only previous target ports; it refused the new port before network writes','liveCountsBeforeRetry':counts,'resolution':'Dedicated observer permits only the live-attested new origin; conflicting shared preload removed without changing it or original tests','oldIncident':'OPEN','rawReportSha256':hashlib.sha256((S/(P+'-integration-attempt1.private.json')).read_bytes()).hexdigest()},indent=2)+'\n')
assert plan['stage']=='TESTS_FINISHED';plan['stage']='SCHEMA_READY_PRISTINE';plan['safeRetryAfterZeroRpcFixtureRows']=counts;(S/(P+'-plan.private.json')).write_text(json.dumps(plan,indent=2)+'\n')
fp=json.loads((S/(P+'-source.private.json')).read_text());fp['files']=[{'path':f['path'],'sha256':hashlib.sha256((R/f['path']).read_bytes().replace(b'\r\n',b'\n')).hexdigest()}for f in fp['files']];fp['fingerprint']=hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest();(S/(P+'-source.private.json')).write_text(json.dumps(fp,indent=2)+'\n')
print(json.dumps({'safeRetry':counts,'sourceFingerprint':fp['fingerprint'],'firstWorkspaceRetained':True}))
