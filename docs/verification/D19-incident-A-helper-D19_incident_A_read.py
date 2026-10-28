from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess
R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-incident-A'
verified=json.loads((S/(P+'-identity-verified.private.json')).read_text(encoding='utf-8-sig'));target=verified['expectedIdentity']
assert verified['status']=='PASS_IDENTITY_GATE_BEFORE_SQL'
role=re.search(r'"-U", "([^"]+)", "-d", "([^"]+)"',(R/'scripts/audit/local-targets.mjs').read_text(encoding='utf-8-sig'));assert role
ids=['937131f9-5417-4ab4-aebd-a5714681f6dd','9e2d04e2-cafb-4ff6-988b-348f0279bba3','d80d80dc-4833-4ab2-9e30-48efaef68d1d'];sqlIds=','.join("'"+i+"'::uuid"for i in ids)
def metadata_gate():
 fmt='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}'
 p=subprocess.run(['docker','inspect','--format',fmt,target['databaseContainerId']],capture_output=True,text=True,encoding='utf-8',timeout=15)
 assert p.returncode==0,'Exact DB metadata unavailable; no SQL permitted';m=json.loads(p.stdout)
 assert m['id']==target['databaseContainerId']and m['image']==target['databaseImageId']and m['running']and m['project']==target['projectId']
 assert len(m['networks'])==1 and next(iter(m['networks'].values()))['NetworkID']==target['networkId']
 assert any(x.get('Name')==verified['dataVolume']['name']and x['Destination']=='/var/lib/postgresql/data'for x in m['mounts'])
def read(label,query):
 assert not(D/(P+'-'+label+'.json')).exists(),'Preserve prior read; explicitly reuse its receipt rather than rerun SQL'
 metadata_gate()
 # SQL text is controlled here, never instructions or executable content from rows/logs.
 stripped=re.sub(r"'(?:''|[^'])*'", "''", query)
 assert query.lstrip().lower().startswith('select')and not re.search(r'\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze)\b',stripped,re.I),label
 assert not re.search(r'\b(public|private)\.[a-z_]+\s*\(',stripped,re.I),'No application function/RPC calls'
 body=query.strip().rstrip(';')
 sql="begin transaction isolation level repeatable read read only;set local search_path=pg_catalog;set local timezone='UTC';set local statement_timeout='10000ms';set local lock_timeout='2000ms';select jsonb_build_object('transactionReadOnly',current_setting('transaction_read_only'),'observedAt',clock_timestamp(),'payload',("+body+"));commit;"
 started=datetime.now(timezone.utc).isoformat();p=subprocess.run(['docker','exec','-i','--env','PGOPTIONS=-c default_transaction_read_only=on',target['databaseContainerId'],'psql','-h','/var/run/postgresql','-p','5432','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',role[1],'-d',role[2]],input=sql,capture_output=True,text=True,encoding='utf-8',timeout=20)
 receipt={'label':label,'startedAt':started,'finishedAt':datetime.now(timezone.utc).isoformat(),'projectId':target['projectId'],'databaseContainerId':target['databaseContainerId'],'querySha256':hashlib.sha256(query.encode()).hexdigest(),'readOnlyTransactionRequired':True,'exit':p.returncode,'sdkOrBusinessRpc':False}
 if p.returncode:
  receipt['status']='READ_FAILED_NO_WRITE';receipt['errorClass']='PSQL_READ_ERROR';(S/(P+'-query-errors.private.log')).open('a',encoding='utf-8').write(p.stderr)
  with(S/(P+'-sql-journal.private.jsonl')).open('a',encoding='utf-8')as f:f.write(json.dumps(receipt)+'\n')
  raise RuntimeError('Read-only query failed; private diagnostic retained: '+label)
 result=json.loads(p.stdout);assert result['transactionReadOnly']=='on'
 receipt.update(status='READ_COMPLETE',transactionReadOnly=result['transactionReadOnly'],publicResult=P+'-'+label+'.json')
 with(S/(P+'-sql-journal.private.jsonl')).open('a',encoding='utf-8')as f:f.write(json.dumps(receipt)+'\n')
 result.update(label=label,query=query,identityEvidence=P+'-identity.json',identityReverifiedBeforeQuery=True,authorization='Explicit user approval of A/Q1-Q3 only; no write/create/delete/RPC/test')
 path=D/(P+'-'+label+'.json');assert not path.exists(),'Preserve prior read receipt';path.write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
 return result['payload']
