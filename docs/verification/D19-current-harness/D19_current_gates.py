from pathlib import Path
from datetime import datetime,timezone
import subprocess,os,json,sys,re,hashlib
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();D=R/'docs/verification';S=R/'.codex-tmp';kind=sys.argv[1];assert kind in ['full','manifest']
fp=json.loads((D/'code-fingerprint.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest();assert len(fp['files'])==348 and all(sha((R/f['path']).read_bytes().replace(b'\r\n',b'\n'))==f['sha256']for f in fp['files'])
env=dict(os.environ)
for k in list(env):
 if any(s in k.upper()for s in ['SUPABASE','OPENAI','OPENROUTER','ANTHROPIC','RAPIDAPI'])or k in ['DATABASE_URL','NODE_OPTIONS']:env[k]=''
env['RUN_INTEGRATION']='0';env['RUN_AUDIT_INTEGRATION']='0';env['NODE_ENV']='test'if kind=='full'else'production'
args=['node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--minWorkers=1','--no-file-parallelism','--reporter=dot','--reporter=json','--outputFile=.codex-tmp/D19-current-full-results.private.json']if kind=='full'else['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','run','release:manifest:check']
command=['npm.cmd','exec','--offline','--yes','--package=node@22','--','node',*args];started=datetime.now(timezone.utc).isoformat();log=S/('D19-current-'+kind+'.private.log')
with log.open('wb')as stream:exitCode=subprocess.run(command,env=env,cwd=R,stdout=stream,stderr=subprocess.STDOUT).returncode
text=log.read_text(encoding='utf-8',errors='replace');text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',text);text=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[jwt-redacted]',text);text=re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b','[email-redacted]',text);text=re.sub(r'https?://[^\s"\x27<>]+','[url-redacted]',text)
(D/'logs'/('D19-current-'+kind+'.log')).write_bytes(text.encode('utf-8'))
result={'sourceFingerprint':fp['fingerprint'],'gate':kind,'command':command,'startedAt':started,'finishedAt':datetime.now(timezone.utc).isoformat(),'exit':exitCode,'environment':'Node22 cached offline; RUN_INTEGRATION=0/RUN_AUDIT_INTEGRATION=0, DB/provider env blank; no external provider accepted','log':'logs/D19-current-'+kind+'.log'}
if kind=='full':
 raw=json.loads((S/'D19-current-full-results.private.json').read_text(encoding='utf-8-sig'));files=[]
 for f in raw['testResults']:
  statuses=[a['status']for a in f['assertionResults']];files.append({'path':Path(f['name']).relative_to(R).as_posix(),'passed':statuses.count('passed'),'skipped':sum(statuses.count(s)for s in ['pending','skipped','todo']),'failed':statuses.count('failed'),'assertions':[{'title':a['fullName'],'status':a['status']}for a in f['assertionResults']]})
 redacted=0
 for f in files:
  for a in f['assertions']:
   if re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',a['title']):
    a['originalTitleSha256']=sha(a['title'].encode());a['title']=re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b','[fixture-email-redacted]',a['title']);redacted+=1
 result.update(passed=sum(f['passed']for f in files),failed=sum(f['failed']for f in files),skipped=sum(f['skipped']for f in files),testFiles=len(files),files=files,reportRedactions={'syntheticEmailTitles':redacted,'scope':'Public display titles only; test source/assertions/statuses unchanged, original raw report retained private with SHA256','rawPrivateReportSha256':sha((S/'D19-current-full-results.private.json').read_bytes())})
(D/('D19-current-'+kind+'-results.json')).write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
print(json.dumps({k:v for k,v in result.items()if k in ['sourceFingerprint','gate','exit','passed','failed','skipped','testFiles']}));sys.exit(exitCode)
