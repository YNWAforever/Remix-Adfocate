"""File-only evidence/source checks. No subprocess, network, Docker, SQL or SDK."""
from pathlib import Path
import csv, hashlib, json, sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent;Q=V/'D19-C2-transport-preparation-20261026'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(p):
    with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
def bound(ref):
    p=R/ref['path'];assert p.resolve().is_relative_to(R);assert sha(p)==ref['sha256'],ref['path'];return p
checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for item in before.values():assert sha(R/item['before'])==item['sha256'],item['path']
source=read(V/'code-fingerprint.json');snapshot=read(Q/'candidate-source.json');fp=source['fingerprint']
assert fp=='ead55a808470f90d72290905db90933cb4a6df48eaba519d4587339a4659b71d'
assert source['files']==snapshot['files'] and snapshot['fingerprint']==fp and len(source['files'])==789
assert hashlib.sha256(json.dumps(source['files'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==fp
for item in source['files']:assert hashlib.sha256((R/item['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==item['sha256'],item['path']
oldsource=read(R/before['docs/verification/code-fingerprint.json']['before']);old={x['path']:x['sha256']for x in oldsource['files']};new={x['path']:x['sha256']for x in source['files']}
assert len(old)==788 and len(new)==789 and set(new)-set(old)=={'server/test/audit-docker-output-capture.test.ts'}
assert [p for p in old if old[p]!=new[p]]==['scripts/audit/local-targets.mjs']
assert len([p for p in old if p.startswith('supabase/migrations/')and p.endswith('.sql')])==73
assert source['runtimeApprovalStatus']=='NOT_GRANTED_FOR_CURRENT_SOURCE' and source['runtimeManifestPath']is None and not source['currentCandidateRuntimeProven']
originalpath=V/'D19-C2-application-runtime-manifest.json';assert sha(originalpath)=='eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
original=read(originalpath);authpath=R/original['approval']['receipt'];auth=read(authpath)
assert auth['approved']is True and auth['manifestSha256']==sha(originalpath) and auth['sourceFingerprint']==oldsource['fingerprint']
assert 'call_f61485a0a76947afa36bfffd9b99fab0'in auth['ownerReference']
manifestpath=V/'D19-C2-transport-continuation-runtime-manifest.json';manifest=read(manifestpath);template=read(Q/'runtime-authorization.json')
assert sha(manifestpath)=='f5caccfdc354e7209b320064f08c9a59ce73cc0ae4bdfca4bcde6e255b424ba0'
assert template['approved']is False and template['manifestSha256']==sha(manifestpath) and template['sourceFingerprint']==fp
assert manifest['candidate']['fingerprint']==fp and manifest['candidate']['records']==789
assert manifest['target']==original['target'] and manifest['fixture']==original['fixture'] and manifest['bootstrap']==original['bootstrap'] and manifest['invariants']==original['invariants']
assert manifest['supplement']=={**original['supplement'],'source':manifest['supplement']['source']}
assert manifest['supplement']['resourceAdds']=={'projects':0,'volumes':0,'networks':0,'containers':0}
assert manifest['supplement']['runtimeApproved']is False and manifest['supplement']['providerEnabled']is False
assert manifest['execution']['originalApiReruns']==manifest['execution']['originalBrowserReruns']==0 and manifest['execution']['pristineRpcRerun']is False
for key in ['source','originManifest','originFinalReadback','originCatalog','originImmutableBaseline','originTargetReceipt']:bound(manifest['supplement'][key])
assert not manifest['continuation']['localArchivesExecuted']
for entry in manifest['continuation']['allowedLocalArchives']:
    bound(entry['source']);assert not (R/entry['destination']).exists() and entry['executed']is False
private=R/'.codex-tmp'/manifest['target']['projectId']/manifest['execution']['artifactNamespace']/'role'
assert not (private/'supplement-claim.json').exists() and not (private/'owned-journal.jsonl').exists()
main=read(V/'adfocate-delivery.json');delivery=read(P/'delivery.json');gates=read(P/'gates.json');prior=read(R/before['docs/verification/adfocate-delivery.json']['before'])
assert main['codeFingerprint']==delivery['sourceFingerprint']==gates['sourceFingerprint']==fp
assert main['currentRecordAuthority']['currentSummary']==(P/'delivery.json').relative_to(R).as_posix() and main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['D15']==prior['D15'] and main['commit']is None and main['deploymentStatus']=='not-deployed'
assert main['finalDeliveryReview']['wholeCurrentR1Verified']is False and main['finalDeliveryReview']['canDeploy']is False
assert gates['full']=={'passed':2133,'failed':0,'skipped':363,'files':293}
for key,n in [('originalAudit16',16),('protected194',194),('supplement26',26),('transport4',4)]:assert gates[key]=={'passed':n,'failed':0,'skipped':0,'total':n}
full=read(P/'transport-full-host-results.json');assert full['success'] and (full['numPassedTests'],full['numFailedTests'],full['numPendingTests'],len(full['testResults']))==(2133,0,363,293)
assert read(P/'transport-full-results.json')['numFailedTests']==13
assert read(P/'transport-red-results.json')['numFailedTests']==2 and read(P/'transport-green-results.json')['numPassedTests']==4
assert read(P/'transport-focused-results.json')['numPassedTests']==33 and read(P/'transport-host-boundaries-results.json')['numPassedTests']==32
for gate in gates['commands'].values():
    c=read(bound(gate['receipt']));bound(gate['log']);resource=read(bound(gate['resource']));assert c['exit']==0 and min(resource['freePhysicalGiB'],resource['freeCommitGiB'])>=3
    assert c.get('sourceFingerprint',fp)==fp and c.get('sourceUnchangedAfter',True)
reconciliation=read(P/'runtime-reconciliation.json');post=read(P/'post-provenance-failure.json');first=read(P/'read-only-provenance-checked.json')
assert reconciliation['old70FamiliesAndEightSectionCatalogUnchanged'] and reconciliation['readonlyCompletedSqlCalls']==19 and reconciliation['failedCaptureReadonlyCatalogSelectAttempts']==1
assert post['state']=={'history':72,'missions':6,'newHistory':0,'workspaces':6,'newFunction':0,'authSubjects':84,'newWorkspace':0}
assert post['fullFiveServiceIdentityPassed'] and post['catalogEightSectionsEqual'] and post['original70FamilyRowsMatch']
assert first['financial']==post['financial'] and len(post['financial'])==9
assert read(P/'permission-attempt-result.json')['failedStage']=='provenance' and read(P/'runtime-first-attempt-result.json')['failedStage']=='identity'
for key in ['currentSourceWriterAttempts','applicationApiScenariosExecuted','applicationBrowserScenariosExecuted','newAuthSubjectsCreated','newDomainFixturesCreated','migrationWrites','dockerLifecycleActions','productionOrFormalMembershipWrites','providerCalls']:assert delivery[key]==0,key
assert delivery['proposedRuntimeApproved']is False and delivery['localArchivesExecuted']is False and delivery['wholeR1Verified']is False
assert delivery['incidentOpen'] and delivery['releaseHold'] and not delivery['restored'] and not delivery['providerEnabled']
cases=rows(V/'audit_case_coverage.csv');oldcases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert len(cases)==len(oldcases)==107
original_columns=['case_id','title','primary_task','secondary_tasks','phase','original_audit_result','original_environment','expected','implementation_result','evidence_required','release_note']
changed=[]
for a,b in zip(cases,oldcases):
    assert all(a[k]==b[k]for k in original_columns)
    if a!=b:changed.append(a['case_id'])
    if a['case_id']in ['UC-C18','UC-A51']:assert a==b
assert set(changed)=={'UC-A06','UC-A10','UC-C25'} and main['caseResults']==cases
assert len(main['taskResults'])==20 and len(rows(V/'implementation_backlog.csv'))==20
for filename in ['gates.json','case-coverage.json','remaining-acceptance.json','rollback.json','schema-diff.json','financial-preservation.json','failure-reconciliation.json']:
    assert (P/filename).is_file()
git=read(P/'git-final.json');assert git['head']=='7cfa3dc84c821719a4dff754229a591c81786c53' and git['branch']=='codex/adfocate-r1-pilot-20261023' and git['staged']==[] and git['diffCheckExit']==0
oldseal=read(R/before['docs/verification/evidence-integrity.json']['before']);assert len(oldseal['files'])==2249
for item in oldseal['files']:
    current=R/item['path']
    if current.is_file()and sha(current)==item['sha256']:continue
    preserved=before.get(item['path']);assert preserved and sha(R/preserved['before'])==item['sha256'],item['path']
if '--preseal'not in sys.argv:
    seal=read(V/'evidence-integrity.json');assert seal['codeFingerprint']==fp
    actual={p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
    assert set(x['path']for x in seal['files'])==actual and main['evidenceIntegrity']['records']==len(actual)
    for item in seal['files']:assert bound(item).stat().st_size==item['bytes']
    for item in read(V/'D19-C2-runtime-integrity.json')['files']:bound(item)
print(json.dumps({'status':'PASS_CURRENT_C2_TRANSPORT_DELIVERY_NOT_RUNTIME_OR_R1','source':fp,'sourceRecords':789,'fullPassed':2133,'fullSkipped':363,'originalAudit16':16,'protected194':194,'originalCases':107,'priorEvidenceRecordsPreserved':2249,'originalC2Approval':True,'changedSourceRuntimeApproved':False,'claimOrDataWrites':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'preseal':'--preseal'in sys.argv}))
