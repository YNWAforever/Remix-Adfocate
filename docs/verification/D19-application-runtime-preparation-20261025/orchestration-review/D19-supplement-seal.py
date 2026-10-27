from pathlib import Path
import datetime,hashlib,json,csv,subprocess
R=Path.cwd();V=R/'docs/verification';P=V/'D19-application-runtime-preparation-20261025'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def put(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
def record(p):return {'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
fp=read(P/'candidate-source.json')['fingerprint']
helpers=[]
for path in ['.codex-tmp/D19-supplement-prepare.py','.codex-tmp/D19-supplement-gates.py','.codex-tmp/D19-supplement-manifest.py','.codex-tmp/D19-supplement-delivery.py','.codex-tmp/D19-supplement-seal.py']:
 src=R/path;dst=P/'orchestration-review'/src.name;dst.parent.mkdir(exist_ok=True);dst.write_bytes(src.read_bytes());helpers.append(record(dst))
put(P/'orchestration-review/manifest.json',{'kind':'Reviewed private offline orchestration source copies; not runtime approval or credential stores','files':helpers})
review={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Single-agent local source and manifest review; no independent agent/real runtime review claim','checked':['All prior785 source hashes identical; only3 verification-tooling source adds','Default CLI is file-only; actual execute denial precedes identity/client/claim','Separate source-bound approval receipt, original696e completed authority never reused','Five-service identity shared unchanged; keys/SDK only after identity/provenance/forward gates','New fixture namespace, caps70 families and exact-ID ownership journal; no data cleanup/reset','Protected staff role table uses owner bootstrap only for new synthetic IDs; four exact fixture toggles explicit','Audit/workflow fault exact predicate and function hash; failure retains state and stops','All8 catalog sections, seed and service migration history plus original70 families checked','Original +10XP acceptance counted once, global9 financial row families compared; no pending/payment claim','Three desktop Edge scenarios scoped explicitly,503 mock and injected real sessions labelled','Own exact appserver PID checked before health, only own child stopped; no Docker lifecycle'],'runtimeKnownUnknowns':['Native Auth/RLS/cache/schema outcome still UNKNOWN','Browser selectors, integration SQL and concurrent server outcome not executed','No asset/proof upload, full cross-Creator proof or pending reward reacceptance by C2'],'remainingBlockersPreserved':True}
put(P/'review.json',review)
git={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'branch':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'remote':subprocess.check_output(['git','remote','get-url','origin'],text=True).strip(),'staged':subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines(),'dirtyLineCount':len(subprocess.check_output(['git','status','--short'],text=True).splitlines()),'diffCheck':subprocess.run(['git','diff','--check'],capture_output=True,text=True).returncode,'commitCreated':False}
assert git['branch']=='codex/adfocate-r1-pilot-20261023'and git['head']=='7cfa3dc84c821719a4dff754229a591c81786c53'and git['staged']==[]and git['diffCheck']==0
put(P/'git-final.json',git)
summary=P/'verification-summary.json'
if not summary.exists():put(summary,{'status':'PENDING_LOCAL_CHECKER','actualTargetCalls':0})
subset=V/'D19-application-supplement-integrity.json'
if not subset.exists():put(subset,{'codeFingerprint':fp,'files':[]})
allFiles=sorted(p for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json')
main=read(V/'adfocate-delivery.json');main['evidenceIntegrity']['records']=len(allFiles)
with(V/'implementation_backlog.csv').open(encoding='utf-8-sig',newline='')as f:task=next(r for r in csv.DictReader(f)if r['task_id']=='D19')
if isinstance(main['taskResults'],list):
 for row in main['taskResults']:
  if row.get('task_id')=='D19':row.update(task)
if isinstance(main['approvalRequired'],list):
 text='C2 applications-only runtime: exact reviewed digest/source,6 new synthetic subjects,1 workspace,4 missions,forward73,2 owned temporary fault objects,4 new-OperatorA fixture toggles,API and3 browser scenarios. Original696e completed authority cannot be reused.'
 if text not in main['approvalRequired']:main['approvalRequired'].append(text)
put(V/'adfocate-delivery.json',main)
before=read(P/'before/docs/verification/evidence-integrity.json');old={x['path']:x['sha256']for x in before['files']}
selected=[p for p in allFiles if p!=subset and (p.relative_to(R).as_posix()not in old or hashlib.sha256(p.read_bytes()).hexdigest()!=old[p.relative_to(R).as_posix()])]
selected.extend(R/p for p in ['scripts/audit/application-supplement.mjs','scripts/audit/execute-application-supplement.mjs','server/test/application-supplement.test.ts','docs/superpowers/plans/2026-10-23-adfocate-implementation-plan.md'])
put(subset,{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeFingerprint':fp,'method':'Current local C2 prep files and modified metadata, exact raw SHA256; excludes this seal and root seal; old artifacts resolved by checkpoint before images.','files':[record(p)for p in sorted(set(selected))]})
put(V/'evidence-integrity.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeFingerprint':fp,'method':'Exact raw-byte SHA256 of every verification file; exclude only this root seal. All nested historical seals and exact before images retained.','files':[record(p)for p in allFiles]})
print(json.dumps({'source':fp,'globalRecords':len(allFiles),'subsetRecords':len(selected),'staged':git['staged'],'diffCheck':git['diffCheck']}))
