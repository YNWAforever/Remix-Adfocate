"""Read local evidence only; never import a client, call git, or contact a target."""
from pathlib import Path
import csv,hashlib,json,sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
ids={'UC-C29','UC-A14','UC-S01','UC-A11'}
cases=rows(V/'audit_case_coverage.csv')
unresolved=[r['case_id']for r in cases if r['case_id']in ids and 'FULL_CASE_NOT_VERIFIED'not in r['newResult']]
if len(sys.argv)>1 and sys.argv[1]=='--claims':
 print(json.dumps({'status':'FAIL_OVERBROAD_CASE_LABELS'if unresolved else 'PASS_EXPLICIT_PARTIAL_CASE_LABELS','cases':sorted(ids),'missingExplicitPartialLabel':unresolved,'actualTargetCalls':0}))
 raise SystemExit(1 if unresolved else 0)
assert not unresolved,unresolved
checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for record in before.values():assert sha(R/record['before'])==record['sha256']
frozen='eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
assert sha(V/'D19-C2-application-runtime-manifest.json')==frozen
assert sha(V/'D19-C2-application-runtime-manifest.json')==sha(R/before['docs/verification/D19-C2-application-runtime-manifest.json']['before'])
assert sha(V/'code-fingerprint.json')==sha(R/before['docs/verification/code-fingerprint.json']['before'])
assert sha(V/'D19-application-runtime-preparation-20261025/runtime-authorization.json')==sha(R/before['docs/verification/D19-application-runtime-preparation-20261025/runtime-authorization.json']['before'])
source=read(V/'code-fingerprint.json');assert source['fingerprint']==checkpoint['sourceFingerprint']
for record in source['files']:assert hashlib.sha256((R/record['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==record['sha256']
assert len(source['files'])==788
oldCases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert len(cases)==len(oldCases)==107
changed=[];mutable={'newResult','codeStatus','testStatus','runtimeStatus','newEvidence','limitations'}
for old,current in zip(oldCases,cases):
 assert old['case_id']==current['case_id']
 assert all(old[k]==current[k]for k in old if k not in mutable)
 if old!=current:changed.append(current['case_id'])
 if current['case_id']in ['UC-C18','UC-A51']:assert old==current
gateIds={'UC-C13','UC-C14','UC-C15','UC-C16','UC-C17','UC-C33','UC-C36','UC-A09','UC-A18','UC-A19','UC-S04','UC-A45','UC-A46','UC-A49'}
assert set(changed)==ids|gateIds
tasks=rows(V/'implementation_backlog.csv');oldTasks=rows(R/before['docs/verification/implementation_backlog.csv']['before'])
assert len(tasks)==len(oldTasks)==20
for old,current in zip(oldTasks,tasks):
 assert all(old[k]==current[k]for k in old if k not in {'newResult','runtimeStatus','evidence'})
 if current['task_id']!='D19':assert old==current
main=read(V/'adfocate-delivery.json');original=read(R/before['docs/verification/adfocate-delivery.json']['before'])
assert main['D15']==original['D15'];assert main['caseResults']==cases
assert main['financialNeutrality']==original['financialNeutrality']
assert main['codeFingerprint']==source['fingerprint']and main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['D19ApplicationSupplementPreparation']==original['D19ApplicationSupplementPreparation']
model=read(P/'model-ui-observation.json')
assert model['observedSelectedDisplayName']=='GPT-6.1 Sol'and model['observedReasoningDisplayName']=='Max'
assert model['selectedInterfaceVerified']is True and model['providerModelId']is None
assert model['modelIdInferred']is False and model['modelOptionChanges']==model['reasoningOptionChanges']==0
assert model['finalModelMenuOpen']is False
assert main['executionModel']['verifiedCurrentInterfaceSelection']is True
assert sha(R/main['executionModel']['evidence']['path'])==main['executionModel']['evidence']['sha256']
delivery=read(P/'delivery.json')
for key in ['review','caseCoverage','remaining','rollback','c2Manifest','modelInterfaceObservation']:
 reference=delivery[key]
 assert sha(R/reference['path'])==reference['sha256'],'Current delivery reference stale: '+key
assert main['D19R1FacetReview']==delivery
review=read(P/'review.json');assert review['actualTargetCalls']==0 and review['wholeR1Verified']is False
assert {c['caseId']for c in review['cases']}==ids
for case in review['cases']:
 assert case['wholeCurrentCaseVerified']is False
 assert any(f['status']in ['MISSING_CURRENT_ACCEPTANCE','PARTIAL_HISTORICAL_ONLY','CURRENT_LOCAL_ONLY','SOURCE_UNBOUND_HISTORICAL_ONLY']for f in case['facets'])
for witness in review['references']:
 assert sha(R/witness['path'])==witness['sha256'],witness['path']
applicability=read(P/'gate14-applicability.json');assert len(applicability['cases'])==14
assert all(c['applicability']=='REQUIRED_ORIGINAL_EXPECTATION_NO_WAIVER_APPROVED'and c['wholeCaseVerifiedByThisReview']is False for c in applicability['cases'])
native=read(V/'D19-application-runtime-preparation-20261025/supplement-full-final.json')
assert native['numPassedTests']==2129 and native['numFailedTests']==0 and native['numPendingTests']==363
nativeAssertions={(Path(f['name']).relative_to(R).as_posix(),a.get('fullName',a['title']),a['status'])for f in native['testResults']for a in f['assertionResults']}
for assertion in read(P/'current-native-witnesses.json')['assertions']:assert (assertion['path'],assertion['title'],assertion['status'])in nativeAssertions
for case in applicability['cases']:
 for assertion in case['namedCurrentNativeAssertions']:assert (assertion['path'],assertion['title'],assertion['status'])in nativeAssertions
 for status,count in case['namedAssertionCounts'].items():assert count==sum(a['status']==status for a in case['namedCurrentNativeAssertions'])
assert main['testStatus']==original['testStatus'],'No new application suite was executed'
oldIndex=read(R/before['docs/verification/evidence-integrity.json']['before'])
for record in oldIndex['files']:
 p=R/(before[record['path']]['before']if record['path']in before else record['path'])
 assert sha(p)==record['sha256'],'Old evidence missing or changed: '+record['path']
for name in ['D19-r1-facet-review-integrity.json','evidence-integrity.json']:
 index=read(V/name);assert index['codeFingerprint']==source['fingerprint']
 for record in index['files']:assert sha(R/record['path'])==record['sha256'],record['path']
index=read(V/'evidence-integrity.json');assert len(index['files'])==main['evidenceIntegrity']['records']
assert {r['path']for r in index['files']}=={p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
assert read(P/'delivery.json')['deployment']=='NOT_DEPLOYED'
print(json.dumps({'status':'PASS_LOCAL_R1_FACET_REVIEW_NOT_RUNTIME_OR_R1_VERIFIED','sourceFingerprint':source['fingerprint'],'sourceFilesUnchanged':788,'casesWithCorrectedNewResult':sorted(ids|gateIds),'originalCasesPreserved':107,'gate14ExpectationsRetained':14,'priorEvidenceRecordsPreserved':len(oldIndex['files']),'currentEvidenceRecords':len(index['files']),'c2ManifestUnchanged':True,'c2ApprovalPending':True,'currentModelUiSelection':'GPT-6.1 Sol / Max','modelOptionChanges':0,'newApplicationTestRuns':0,'actualTargetCalls':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
