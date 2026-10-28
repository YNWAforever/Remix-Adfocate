from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,hashlib,sys,os,re
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();D=R/'docs/verification';S=R/'.codex-tmp';B=S/'D19-current-20261024-before';P='D19-current'
phase=sys.argv[1];assert phase in ['role','core','browser','capabilities'];old=json.loads((B/'index.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
code=json.loads((D/'code-fingerprint.json').read_text());assert all(sha((R/x['path']).read_bytes().replace(b'\r\n',b'\n'))==x['sha256']for x in code['files'])
out=D/(P+'-runtime')/phase;assert not out.exists(),'Retain phase evidence; use a separately reviewed retry namespace';out.mkdir(parents=True)
prior={x['path']:(R/x['path']).read_bytes()for x in old['files']if x['path'].startswith('docs/verification/')}
for p,data in prior.items():assert sha(data)==next(x['sha256']for x in old['files']if x['path']==p),p
assert json.loads((D/(P+'-identity.json')).read_text())['passed']
node=['npm.cmd','exec','--offline','--yes','--package=node@22','--','node']
args=['.codex-tmp/D19-current-api.mjs',phase]if phase in ['role','core']else ['scripts/audit/run-pilot-browser.mjs']if phase=='browser'else ['node_modules/vite-node/vite-node.mjs','scripts/audit/verify-capabilities.mjs']
env=dict(os.environ)
for k in ['OPENAI_API_KEY','OPENROUTER_API_KEY','ANTHROPIC_API_KEY','RAPIDAPI_KEY','ADFOCATE_AI_PROVIDER_ENABLED']:env[k]=''
env['RUN_INTEGRATION']='0';env['RUN_AUDIT_INTEGRATION']='0'
started=datetime.now(timezone.utc).isoformat();log=S/(P+'-'+phase+'.private.log');codeExit=None;captured=[]
try:
 with log.open('wb')as output:codeExit=subprocess.run(node+args,cwd=R,env=env,stdout=output,stderr=subprocess.STDOUT).returncode
finally:
 for path,data in prior.items():
  current=(R/path).read_bytes()
  if current==data:continue
  assert path.startswith('docs/verification/D19-')or path in ['docs/verification/workflow-runtime.jsonl','docs/verification/disposable-capabilities.json'],'Unexpected evidence mutation: '+path
  value=current
  if path.endswith('.jsonl'):
   assert current.startswith(data),'Append-only receipt prefix changed';value=current[len(data):]
  dest=out/Path(path).name;dest.write_bytes(value);captured.append({'historicalPath':path,'captured':dest.relative_to(R).as_posix(),'bytes':len(value),'sha256':sha(value),'oldBytesRestored':True,'appendOnlyDelta':path.endswith('.jsonl')});(R/path).write_bytes(data)
 for path,data in prior.items():assert(R/path).read_bytes()==data,path
text=log.read_text(encoding='utf-8',errors='replace');text=re.sub(r'\x1b\[[0-9;]*[a-zA-Z]','',text)
text=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[jwt-redacted]',text)
text=re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b','[email-redacted]',text)
text=re.sub(r'https?://[^\s"\x27<>]+','[url-redacted]',text)
(D/'logs'/(P+'-'+phase+'.log')).write_bytes(text.encode('utf-8'))
summary={'phase':phase,'startedAt':started,'finishedAt':datetime.now(timezone.utc).isoformat(),'sourceFingerprint':code['fingerprint'],'command':' '.join(node+args),'exit':codeExit,'log':'logs/'+P+'-'+phase+'.log','priorEvidenceRestored':len(prior),'captured':captured,'scope':'Existing tests/runner, fresh exact-owned fixtures; no production target, external providers or cleanup; original evidence bytes restored after phase'}
if phase in ['role','core']:
 raw=json.loads((S/(P+'-'+phase+'-results.private.json')).read_text(encoding='utf-8-sig'));tests=[{'file':x['name'].replace(str(R).replace('\\','/')+'/',''),'assertions':[{'title':a['fullName'],'status':a['status'],'duration':a.get('duration')}for a in x['assertionResults']]}for x in raw['testResults']]
 summary.update(passed=raw['numPassedTests'],failed=raw['numFailedTests'],skipped=raw['numPendingTests'],tests=tests)
 if codeExit==0:
  fixture=(S/'D19-fixture.private.json').read_bytes();(S/(P+'-'+phase+'-fixture.private.json')).write_bytes(fixture);(S/('D19-'+phase+'-fixture.private.json')).write_bytes(fixture)
elif phase=='browser':
 (S/(P+'-browser-fixture.private.json')).write_bytes((S/'D19-browser-fixture.private.json').read_bytes())
(D/(P+'-'+phase+'-results.json')).write_bytes((json.dumps(summary,ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps({k:summary[k]for k in ['phase','exit','sourceFingerprint','priorEvidenceRestored']}|{'capturedFiles':len(captured),'passed':summary.get('passed'),'failed':summary.get('failed'),'skipped':summary.get('skipped')}));sys.exit(codeExit or 0)
