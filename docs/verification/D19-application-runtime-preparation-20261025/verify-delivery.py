"""File-only current checkpoint verification. No subprocess, DB, SDK or network."""
from pathlib import Path
import csv,hashlib,json
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def bound(reference):
 p=R/reference['path'];assert p.is_relative_to(R);assert sha(p)==reference['sha256'],reference['path'];return p
def rows(path):
 with Path(path).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
checkpoint=read(P/'checkpoint.json'); before={x['path']:x for x in checkpoint['preservedFiles']}
for rec in before.values():assert sha(R/rec['before'])==rec['sha256'],rec['path']
source=read(P/'candidate-source.json');fp=source['fingerprint']
assert hashlib.sha256(json.dumps(source['files'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==fp
assert len(source['files'])==788
for f in source['files']:assert hashlib.sha256((R/f['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
previous=read(V/'D19-application-decisions-20261025/candidate-source.json')
current={f['path']:f['sha256']for f in source['files']};prior={f['path']:f['sha256']for f in previous['files']}
assert len(prior)==785 and all(current.get(k)==v for k,v in prior.items())
assert set(current)-set(prior)=={'scripts/audit/application-supplement.mjs','scripts/audit/execute-application-supplement.mjs','server/test/application-supplement.test.ts'}
main=read(V/'adfocate-delivery.json');published=read(V/'code-fingerprint.json');delivery=read(P/'delivery.json');gates=read(P/'gates.json')
assert main['codeFingerprint']==published['fingerprint']==delivery['sourceFingerprint']==fp
assert published['files']==source['files'] and published['runtimeManifestPath']is None
assert main['currentRecordAuthority']['currentSummary']==(P/'delivery.json').relative_to(R).as_posix()
assert main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['D15']==read(R/before['docs/verification/adfocate-delivery.json']['before'])['D15']
assert main['commit']is None and main['deploymentStatus']=='not-deployed'
assert delivery['actualTargetCalls']==delivery['realClientsCreated']==delivery['authSubjectsCreated']==delivery['fixtureRowsCreated']==delivery['browserRuntimeScenariosExecuted']==0
assert delivery['incidentOpen']is True and delivery['releaseHold']is True and delivery['providerEnabled']is False and delivery['wholeR1Verified']is False
for name,g in gates.items():
 if isinstance(g,dict)and 'receipt'in g:
  c=read(bound(g['receipt']));bound(g['log']);assert c['sourceFingerprint']==fp;assert c['exit']==(1 if name.endswith('denied')else 0)
full=read(P/'supplement-full-final.json')
assert full['numFailedTests']==0 and full['numPassedTests']==2129 and full['numPendingTests']==363 and len(full['testResults'])==292
assert gates['full']=={'passed':2129,'failed':0,'skipped':363,'files':292}
assert gates['originalAudit16']=={'passed':16,'failed':0,'skipped':0,'total':16}
assert gates['protected194']=={'passed':194,'failed':0,'skipped':0,'total':194}
assert gates['supplement26']=={'passed':26,'failed':0,'skipped':0,'total':26}
manifest=read(bound(delivery['runtimeManifest']));assert manifest['candidate']['fingerprint']==fp
assert manifest['supplement']['runtimeApproved']is False and read(P/'runtime-authorization.json')['approved']is False
assert manifest['supplement']['resourceAdds']=={'projects':0,'volumes':0,'networks':0,'containers':0}
assert manifest['supplement']['authSubjects']==6 and manifest['supplement']['workspaces']==1 and manifest['supplement']['missions']==4
assert manifest['supplement']['legacyIssuance']is False
assert sha(R/'docs/verification/D19-C1-browser-continuation-runtime-manifest.json')=='696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d'
for key in ['source','originManifest','originFinalReadback','originCatalog','originImmutableBaseline','originTargetReceipt']:bound(manifest['supplement'][key])
oldCases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);cases=rows(V/'audit_case_coverage.csv')
assert len(cases)==len(oldCases)==107
mutable={'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'}
changed=[]
for old,new in zip(oldCases,cases):
 assert old['case_id']==new['case_id']
 assert all(old[k]==new[k]for k in old if k not in mutable)
 if old!=new:changed.append(new['case_id'])
 if new['case_id']in ['UC-C18','UC-A51']:assert old==new
assert set(changed)=={'UC-C25','UC-A06','UC-A10'}
assert read(P/'case-coverage.json')['cases']==main['caseResults']==cases
oldTasks=rows(R/before['docs/verification/implementation_backlog.csv']['before']);tasks=rows(V/'implementation_backlog.csv')
assert len(tasks)==len(oldTasks)==20
for old,new in zip(oldTasks,tasks):
 assert old['task_id']==new['task_id']
 assert all(old[k]==new[k]for k in old if k not in {'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','evidence'})
 if new['task_id']!='D19':assert new==old
oldSeal=read(R/before['docs/verification/evidence-integrity.json']['before'])
for record in oldSeal['files']:
 p=R/(before[record['path']]['before']if record['path']in before else record['path'])
 assert sha(p)==record['sha256'],'Prior evidence changed without exact before image: '+record['path']
for name in ['D19-application-supplement-integrity.json','evidence-integrity.json']:
 index=read(V/name)
 assert index['codeFingerprint']==fp
 for record in index['files']:assert sha(R/record['path'])==record['sha256'],record['path']
globalSeal=read(V/'evidence-integrity.json');assert main['evidenceIntegrity']['records']==len(globalSeal['files'])
actual={p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
assert actual=={x['path']for x in globalSeal['files']}
print(json.dumps({'status':'PASS_LOCAL_C2_PREPARATION_NOT_RUNTIME_OR_R1','source':fp,'fullPassed':2129,'originalAudit16':16,'protected194':194,'supplementChecks':26,'originalCases':107,'priorEvidenceRecordsPreserved':len(oldSeal['files']),'currentEvidenceRecords':len(globalSeal['files']),'actualTargetCalls':0,'runtimeApproved':False,'incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
