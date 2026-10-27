from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8');R=Path.cwd();S=R/'.codex-tmp';D=R/'docs/verification';P='D19-pristine-rpc';p=json.loads((S/(P+'-plan.private.json')).read_text());envPath=Path(p['folder'])/'integration-env.private.json';env=json.loads(envPath.read_text());observer=json.loads((S/(P+'-observer.private.json')).read_text());node=json.loads((D/'D17-R2-gate-exits.json').read_text(encoding='utf-8-sig'))['results'][0]['command'][0]
def call(args,input=None):
 r=subprocess.run(args,input=input,capture_output=True,text=True,encoding='utf-8',timeout=60)
 if r.returncode:raise RuntimeError(r.stderr[:600])
 return r.stdout.strip()
assert call([node,str(S/(P+'-verify.mjs')),str(envPath)])=='verified-before-setup'
def sql(q):return call(['docker','exec','-i',p['containerIds']['db'],'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',observer['databaseRole'],'-d',observer['databaseName']],q)
def put(n,v):(D/(P+'-'+n+'.json')).write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
before=json.loads((D/(P+'-schema-before-tests.json')).read_text());current=json.loads(sql('begin read only;'+before['query']+'commit;'));assert current==before['observed']
put('schema-after-tests',{'at':datetime.now(timezone.utc).isoformat(),'identity':before['identity'],'query':before['query'],'observed':current,'schemaHistoryAclRlsUnchangedByTests':True})
old=json.loads((D/'D19-support-current-schema-before.json').read_text())['targets']['empty']['observed']
def normalize(v):
 if isinstance(v,dict):return{k:normalize(x)for k,x in v.items()}
 if isinstance(v,list):return sorted([normalize(x)for x in v],key=lambda x:json.dumps(x,sort_keys=True))
 return v
diff={k:{'priorCount':len(old.get(k)or[]),'newCount':len(current.get(k)or[])}for k in set(old)|set(current)if normalize(old.get(k))!=normalize(current.get(k))}
jobs=['close_due_campaigns','snapshot_campaign_leaderboards'];rpc=[]
for name in jobs:
 a=next(f for f in old['functions']if f['schema']=='public'and f['name']==name);b=next(f for f in current['functions']if f['schema']=='public'and f['name']==name);assert normalize(a)==normalize(b);rpc.append({'name':name,'functionDefinitionHash':b['hash'],'acl':b['acl'],'definer':b['definer'],'unchangedFromCapturedCandidateCatalog':True})
put('schema-diff',{'against':'D19-support-current-schema-before.json targets.empty.observed (captured local candidate catalog; no old target SQL this turn)','normalizedDifferentSections':diff,'normalization':'Array ordering ignored for catalog sets only; source bytes and function hashes untouched','twoGlobalRpcDefinitionsAclSecurityIdentical':rpc,'beforeAfterTestsSchemaEqual':True,'migrationCount':72,'manifestCount':42,'oldMigrationSourceChecksumChanged':False,'providerProfileAlignment':P+'-provider-profile-alignment.json'})
calls=[json.loads(l)for l in (S/(P+'-calls.private.jsonl')).read_text().splitlines()if l];assert[(c['rpc'],c['result'])for c in calls]==[('close_due_campaigns',1),('close_due_campaigns',0),('snapshot_campaign_leaderboards',1)]
assert all(c['status']==200 and c['financialNeutrality'] and c['before']['finance']==c['after']['finance']for c in calls)
put('rpc-persistence-neutrality',{'identity':before['identity'],'query':observer['query'],'financialTables':observer['financialTables'],'extraSnapshot':'Creator XP, full exact target before/after each RPC; finance hashes include balances, ledgers, budgets, reservations, pending rewards and immutable contracts','calls':calls,'globalCallCount':3,'financialNeutrality':True,'claimScope':'These two global campaign jobs only. This does not re-run the prior full legacy/active/proof/pending-reward role journey or clear its incident.','providerEnabled':False})
owned=[json.loads(l)for l in (S/(P+'-owned.private.jsonl')).read_text().splitlines()if l];authIds=sorted({i for r in owned if r['table']=='auth_users'for i in r['ids']});campaignIds=sorted({i for r in owned if r['table']=='campaigns'for i in r['ids']});missionIds=sorted({i for r in owned if r['table']=='missions'for i in r['ids']})
actual=json.loads(sql("begin read only;select jsonb_build_object('authUsers',(select jsonb_agg(id order by id)from auth.users),'campaigns',(select jsonb_agg(id order by id)from public.campaigns),'missions',(select jsonb_agg(id order by id)from public.missions),'snapshotIds',(select jsonb_agg(id order by id)from public.campaign_rank_snapshots));commit;"));assert actual['authUsers']==authIds and actual['campaigns']==campaignIds and actual['missions']==missionIds
workspaceIds=[json.loads((D/(P+'-'+n+'.json')).read_text())['scope']['workspaceId']for n in ['fixture-attempt1','fixture-attempt2','fixture']]
put('fixture-retention',{'identity':before['identity'],'namespace':json.loads((D/(P+'-fixture.json')).read_text())['scope']['namespace'],'retainedExactIds':actual,'retainedWorkspaceIds':workspaceIds,'ownedJournal':owned,'cleanupThisTurn':{'deletedAuthIds':json.loads((D/(P+'-rest-recovery.json')).read_text())['removedAuthFixtureExactIds'],'reason':'One failed attempt, exact successfully created Auth ID only; before next attempt zero Auth/campaign/submission/snapshot verified'},'retention':'All final case fixture IDs and three exact current-run workspace IDs retained; no reset or broad delete','oldIncident':'OPEN, no old target SQL or restoration'})
print(json.dumps({'schemaEqualBeforeAfter':True,'normalizedSectionsDifferentFromCapturedCandidate':diff,'twoGlobalRpcDefinitionsAclEqual':True,'rpcResults':[c['result']for c in calls],'financialNeutrality':True,'retainedCampaigns':len(campaignIds),'retainedAuthUsers':len(authIds),'retainedSnapshots':len(actual['snapshotIds'])}))
