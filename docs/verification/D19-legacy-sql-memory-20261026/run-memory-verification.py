from pathlib import Path
import ctypes,datetime,hashlib,json,os,re,shutil,subprocess,sys
R=Path.cwd();P=R/'docs/verification/D19-legacy-sql-memory-20261026'
mode=sys.argv[1];label=sys.argv[2]if len(sys.argv)>2 else mode
assert re.fullmatch('[a-z0-9-]+',label)
assert not(P/f'{label}-command.json').exists(),'Never overwrite a completed command receipt'
node=Path('C:/Users/laich/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe')
class Memory(ctypes.Structure):
 _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(k,ctypes.c_ulonglong)for k in ['totalPhys','availPhys','totalCommit','availCommit','totalVirtual','availVirtual','extended']]
m=Memory();m.length=ctypes.sizeof(m);assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
resource={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freePhysicalGiB':m.availPhys/2**30,'freeCommitGiB':m.availCommit/2**30,'minimumGiB':3}
def put(name,d):(P/name).write_text(json.dumps(d,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
put(f'{label}-resource.json',resource)
assert min(resource['freePhysicalGiB'],resource['freeCommitGiB'])>=3,'RESOURCE_GATE_BLOCKED_NO_CHILD'
source=json.loads((R/'docs/verification/code-fingerprint.json').read_text(encoding='utf-8'))
def check_source():
 assert source['fingerprint']=='e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
 for row in source['files']:assert hashlib.sha256((R/row['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==row['sha256'],row['path']
 assert hashlib.sha256((R/'docs/verification/D19-C2-application-runtime-manifest.json').read_bytes()).hexdigest()=='eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
check_source()
artifacts=[P/'legacy-reward-core.node.mjs',P/'sql-profile.mjs']
fingerprints=[{'path':x.relative_to(R).as_posix(),'sha256':hashlib.sha256(x.read_bytes()).hexdigest()}for x in artifacts]
commands={
 'test':[str(node),'--test','--test-concurrency=1','--test-reporter=tap',str(artifacts[0])],
 'lint':[str(node),'node_modules/eslint/bin/eslint.js',*[str(x)for x in artifacts]],
 'profile':[str(node),'--input-type=module','-e',"import {createLegacyMemoryProfile} from './docs/verification/D19-legacy-sql-memory-20261026/sql-profile.mjs';import{writeFileSync}from'node:fs';const{beforeFixtureSql,afterFixtureSql,...p}=createLegacyMemoryProfile();writeFileSync('docs/verification/D19-legacy-sql-memory-20261026/sql-profile.json',JSON.stringify(p,null,2)+'\\n');process.stdout.write(JSON.stringify({status:'PASS_PURE_ORIGINAL_SQL_PROFILE',sources:p.sources.length,statements:p.statements.length,profileDigest:p.profileDigest,externalTargetCalls:0})+'\\n');"]}
command=commands[mode]
env={k:v for k,v in os.environ.items()if not k.upper().startswith('PG')and not any(s in k.upper()for s in ['SUPABASE','DATABASE','INTEGRATION','ADFOCATE_B2','OPENAI','ANTHROPIC','PROVIDER','API_KEY','TOKEN','SECRET',('PASS'+'WORD')])}
env.pop('NODE_OPTIONS',None);env['TZ']='Asia/Hong_Kong';env['PATH']=str(node.parent)+os.pathsep+env.get('PATH','')
receipt={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command,'sourceFingerprint':source['fingerprint'],'sourceFilesUnchanged':len(source['files']),'verificationArtifactSources':fingerprints,'verificationArtifactFingerprint':hashlib.sha256(json.dumps(fingerprints,separators=(',',':')).encode()).hexdigest(),'nodeVersion':subprocess.check_output([str(node),'--version'],text=True).strip(),'resource':resource,'scope':'Standalone in-process memory SQL, no full-suite/runtime claim','physicalTargetsOrClients':0,'realAuthSubjectsOrFixtures':0,'packageInstallOrNetworkProvider':False,'nodePreloadsAndCredentialsStripped':True}
with(P/f'{label}.log').open('w',encoding='utf-8')as log:
 child=subprocess.Popen(command,cwd=R,env=env,stdout=log,stderr=subprocess.STDOUT);receipt['pid']=child.pid;put(f'{label}-started.json',receipt)
 print(json.dumps({'label':label,'pid':child.pid,'status':'RUNNING','scope':'IN_PROCESS_MEMORY_ONLY'}),flush=True);code=child.wait()
check_source()
assert fingerprints==[{'path':x.relative_to(R).as_posix(),'sha256':hashlib.sha256(x.read_bytes()).hexdigest()}for x in artifacts]
receipt.update(endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),exit=code)
if mode=='test':
 text=(P/f'{label}.log').read_text(encoding='utf-8')
 receipt['nativeCounts']={k:int(re.search(r'^# '+k+r' (\d+)$',text,re.M).group(1))for k in ['tests','pass','fail','skipped']if re.search(r'^# '+k+r' (\d+)$',text,re.M)}
 if(P/'engine-result.json').exists():shutil.copyfile(P/'engine-result.json',P/f'{label}-engine-result.json')
put(f'{label}-command.json',receipt)
print(json.dumps({'label':label,'exit':code,**receipt.get('nativeCounts',{})}),flush=True);sys.exit(code)
