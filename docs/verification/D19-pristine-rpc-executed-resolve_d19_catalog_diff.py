from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';p=json.loads((S/(P+'-plan.private.json')).read_text());envPath=Path(p['folder'])/'integration-env.private.json';observer=json.loads((S/(P+'-observer.private.json')).read_text());node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
def call(args,input=None):
 r=subprocess.run(args,input=input,capture_output=True,text=True,encoding='utf-8',timeout=60)
 if r.returncode:raise RuntimeError(r.stderr[:1000])
 return r.stdout.strip()
assert call([node,str(S/(P+'-verify.mjs')),str(envPath)])=='verified-before-setup'
def sql(q):return call(['docker','exec','-i',p['containerIds']['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',observer['databaseRole'],'-d',observer['databaseName']],q)
diff=json.loads((D/(P+'-schema-diff.json')).read_text());current=json.loads((D/(P+'-schema-after-tests.json')).read_text())['observed'];old=json.loads((D/'D19-support-current-schema-before.json').read_text())['targets']['empty']['observed']
rows=json.loads(sql("begin read only;select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'body',p.prosrc)order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.prokind='f';commit;"))
formatting=[]
for entry in diff['detailedDifferences']['functions']:
 assert set(entry['differences'])<={'hash','acl'}
 if 'hash'not in entry['differences']:continue
 row=next(x for x in rows if [x['schema'],x['name'],x['args']]==entry['key']);body=row['body'];definition=row['definition'];assert body in definition
 variant=definition.replace(body,body.replace('\r\n','\n'),1)
 prior=entry['differences']['hash']['prior'];matched=hashlib.md5(variant.encode()).hexdigest()==prior
 formatting.append({'key':entry['key'],'currentDefinitionMd5':hashlib.md5(definition.encode()).hexdigest(),'capturedPriorDefinitionMd5':prior,'reconstructedLfBodyDefinitionMd5':hashlib.md5(variant.encode()).hexdigest(),'priorHashExactlyReproducedByLfBodyOnly':matched})
assert all(x['priorHashExactlyReproducedByLfBodyOnly']for x in formatting),[x['key']for x in formatting if not x['priorHashExactlyReproducedByLfBodyOnly']]
# Table-level REVOKE during provider-profile alignment also removed these explicit
# legacy column grants. Restore only the exact captured column/role permissions.
mapping={'r':'select','a':'insert','w':'update','d':'delete','x':'references'};statements=[]
for entry in diff['detailedDifferences']['columns']:
 assert set(entry['differences'])=={'acl'} and entry['differences']['acl']['current']is None
 table,column=entry['key'];assert (table=='creators'and column in {'avatar_url','categories','display_name','level_seen','onboarding_step','phone','social_handles'})or(table=='notifications'and column=='read_at')
 for acl in entry['differences']['acl']['prior']:
  who,grants=acl.split('=',1);grants=grants.split('/')[0];assert who=='authenticated'and grants=='w'
  statements.append(f'grant update("{column}")on public."{table}"to authenticated;')
assert len(statements)==8
statements.append('revoke execute on function public.get_assistant_request(uuid,uuid)from service_role;')
sql('begin;'+''.join(statements)+'commit;')
before=json.loads((D/(P+'-schema-before-tests.json')).read_text());after=json.loads(sql('begin read only;'+before['query']+'commit;'))
def norm(v):
 if isinstance(v,dict):return{k:norm(x)for k,x in v.items()}
 if isinstance(v,list):return sorted([norm(x)for x in v],key=lambda x:json.dumps(x,sort_keys=True))
 return v
remaining={k for k in set(old)|set(after)if norm(old.get(k))!=norm(after.get(k))};assert remaining=={'functions'}
def effectiveAcl(acl):
 if acl is None:return {'public':True,**{r:True for r in ['anon','authenticated','service_role']}}
 public=any(s.startswith('=X/')for s in acl)
 return {'public':public,**{r:public or any(s.startswith(r+'=X/')for s in acl)for r in ['anon','authenticated','service_role']}}
for a in after['functions']:
 b=next(x for x in old['functions']if all(x[k]==a[k]for k in ['schema','name','args']))
 assert all(norm(a[k])==norm(b[k])for k in a if k not in {'hash','acl'})
 assert effectiveAcl(a['acl'])==effectiveAcl(b['acl'])
for name in ['close_due_campaigns','snapshot_campaign_leaderboards']:
 a=next(x for x in current['functions']if x['schema']=='public'and x['name']==name);b=next(x for x in after['functions']if x['schema']=='public'and x['name']==name);assert a==b
finalFinancial=json.loads(sql('begin read only;'+observer['query']+'commit;'));calls=[json.loads(l)for l in (S/(P+'-calls.private.jsonl')).read_text().splitlines()if l];assert finalFinancial==calls[-1]['after']
report={'at':datetime.now(timezone.utc).isoformat(),'identity':before['identity'],'initialCatalogDiff':P+'-schema-diff.json','functionDifferences':formatting,'all20PriorRawHashesReproducedByLfBodyOnly':True,'reason':'Windows Python text stdin translated new SQL LF into CRLF; prior native Node runner retained LF. Function wrapper bytes unchanged; converting only the new CRLF body back to LF exactly reproduces every prior changed definition MD5. Nine other function ACL representations contain redundant API-role grants already inherited from PUBLIC, with equal effective execution permissions.','configurationCause':'Provider profile alignment revoked 7 creator and 1 notification column grants; restored exact captured authenticated UPDATE grants. Also removed one excess service_role EXECUTE grant on get_assistant_request. No application source or old target changed.','configurationSql':statements,'postAlignmentSchema':after,'remainingRawDifferenceSections':sorted(remaining),'semanticCatalogParityVerified':True,'rawFullCatalogByteParity':False,'twoGlobalRpcDefinitionsAclSecurityStillIdentical':True,'financeAndPersistedRpcStateUnchangedByProfileAlignment':True,'integrationImpact':'7 creator / 1 notification authenticated column grants and get_assistant_request execution only; original cases use service-role campaign/submission operations, whose grants and two RPC bytes are unchanged. No broader profile/notification/assistant journey rerun claim.','oldIncident':'OPEN; no old target SQL'}
(D/(P+'-catalog-diff-resolution.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'columnGrantsRestored':8,'excessFunctionExecuteRemoved':1,'functionsWithOnlyProvenLineEndingBodyHashDifference':len(formatting),'semanticCatalogParity':True,'rpcAndFinancialStateStillEqual':True}))
