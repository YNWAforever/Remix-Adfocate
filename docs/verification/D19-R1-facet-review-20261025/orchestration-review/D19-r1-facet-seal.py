from pathlib import Path
import datetime,hashlib,json,subprocess
R=Path.cwd();V=R/'docs/verification';P=V/'D19-R1-facet-review-20261025'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def put(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
def record(p):return {'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
fp=read(P/'checkpoint.json')['sourceFingerprint']
helpers=[]
for name in ['D19-r1-facet-review.py','D19-r1-facet-seal.py']:
 source=R/'.codex-tmp'/name;dest=P/'orchestration-review'/name;dest.parent.mkdir(exist_ok=True);dest.write_bytes(source.read_bytes());helpers.append(record(dest))
put(P/'orchestration-review/manifest.json',{'kind':'Local evidence/metadata orchestration source only; not runtime authority','files':helpers})
git={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'branch':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),'remote':subprocess.check_output(['git','remote','get-url','origin'],text=True).strip(),'staged':subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines(),'diffCheck':subprocess.run(['git','diff','--check'],capture_output=True,text=True).returncode,'commitCreated':False}
assert git['head']=='7cfa3dc84c821719a4dff754229a591c81786c53'and git['branch']=='codex/adfocate-r1-pilot-20261023'and git['staged']==[]and git['diffCheck']==0
put(P/'git-final.json',git)
summary=P/'verification-summary.json'
if not summary.exists():put(summary,{'status':'PENDING_FILE_ONLY_VERIFICATION','actualTargetCalls':0})
subset=V/'D19-r1-facet-review-integrity.json'
if not subset.exists():put(subset,{'codeFingerprint':fp,'files':[]})
allFiles=sorted(p for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json')
main=read(V/'adfocate-delivery.json');main['evidenceIntegrity']['records']=len(allFiles)
delivery=read(P/'delivery.json')
for key in ['review','caseCoverage','remaining','rollback','c2Manifest','modelInterfaceObservation']:
 reference=delivery[key];reference['sha256']=hashlib.sha256((R/reference['path']).read_bytes()).hexdigest()
put(P/'delivery.json',delivery)
main['D19R1FacetReview']=delivery
main['caseCoverageSummary'].update(details=(P/'case-coverage.json').relative_to(R).as_posix(),facetReview=(P/'review.json').relative_to(R).as_posix(),gate14ExpectationsRequired=14,gate14WaiversApproved=0,wholeCurrentR1Verified=False)
main['rollback']=(P/'rollback.json').relative_to(R).as_posix()
put(V/'adfocate-delivery.json',main)
old=read(P/'before/docs/verification/evidence-integrity.json');known={f['path']:f['sha256']for f in old['files']}
changed=[p for p in allFiles if p!=subset and(p.relative_to(R).as_posix()not in known or hashlib.sha256(p.read_bytes()).hexdigest()!=known[p.relative_to(R).as_posix()])]
put(subset,{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeFingerprint':fp,'method':'Exact raw-byte hashes of this local facet review and changed verification metadata; excludes this seal and root seal. Source/manifest unchanged; earlier evidence resolved by exact before images.','files':[record(p)for p in changed]})
put(V/'evidence-integrity.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeFingerprint':fp,'method':'Exact raw-byte SHA256 of every verification file; exclude only this root seal. All nested historical seals and exact before images retained.','files':[record(p)for p in allFiles]})
print(json.dumps({'source':fp,'globalRecords':len(allFiles),'subsetRecords':len(changed),'sourceOrC2ManifestChanges':0,'staged':git['staged'],'diffCheck':git['diffCheck']}))
