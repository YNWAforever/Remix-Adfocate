"""Read-only current C1 handoff verifier. No Docker, SQL, keys, clients or services."""
from pathlib import Path
import json,hashlib,csv,subprocess
R=Path(__file__).resolve().parents[2];V=R/'docs/verification';C=V/'adfocate-d19-b2-20261025-recovery-4d6ca2c8'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
fp=read(V/'code-fingerprint.json');d=read(V/'D19-C1-delivery.json');root=read(V/'adfocate-delivery.json');g=read(V/'D19-C1-gates.json')
assert fp['fingerprint']==d['sourceFingerprint']==root['codeFingerprint']==g['sourceFingerprint']
assert len(fp['files'])==782 and hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest()==fp['fingerprint']
for f in fp['files']:assert hashlib.sha256((R/f['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()==d['headSha']
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=R,text=True).strip()
m=read(R/fp['runtimeManifestPath']);a=read(V/'D19-C1-browser-continuation-authorization-template.json')
assert m['candidate']['fingerprint']==a['sourceFingerprint']==fp['fingerprint']
assert sha(R/fp['runtimeManifestPath'])==a['manifestSha256']==d['sourceRevisionManifestSha256']
assert not a['approved'] and a['ownerReference']is None and not m['canExecute'] and not m['approval']['runtimeApproved']
assert not (R/m['execution']['environment']['ADFOCATE_B2_AUTHORIZATION_PATH']).exists()
assert not (R/'.codex-tmp'/m['target']['projectId']/m['execution']['artifactNamespace']).exists()
origin=read(V/'D19-C1-source-revision-runtime-manifest.json');assert sha(V/'D19-C1-source-revision-runtime-manifest.json')=='a0f09af0a7bce75e6842a1d42042ac4471e757c184574d7e5dcf9a23fdc57989'
assert m['fixture']==origin['fixture'] and m['bootstrap']['profileDigest']==origin['bootstrap']['profileDigest']
assert m['sourceRevision']['changedSourcePaths']==d['sourceChangedPaths'] and len(d['sourceChangedPaths'])==9
assert all(m['target']['additionalAllocationOnly'][k]==0 for k in ['newProjects','newPersistentDataVolumes','newNetworks','newContainers'])
assert not m['execution']['pristineRpcRerun'] and sha(V/m['execution']['matrix'])==m['execution']['matrixSha256']
for item in m['schemaProfile']['fullMigrations']:assert sha(R/item['path'])==item['sha256']
assert len(m['schemaProfile']['fullMigrations'])==72
for phase in ['role','core','browser']:
 result=read(C/phase/'phase-result.json');assert result['lineage']['sourceFingerprint']==d['originRuntimeSource']
 assert result['lineage']['manifestSha256']==d['originRuntimeManifestSha256']
 assert result['exitCode']==(1 if phase=='browser'else 0)
assert read(C/'source-revision-authorization.json')['approved']
for item in read(C/'private-receipt-preservation.json')['protected']:assert sha(R/item['privatePath'])==item['sha256']
assert read(C/'capabilities-before-compatibility.json')['passed']==584
assert read(C/'application-bootstrap-72.json')['migrationsApplied']==72
assert read(C/'target-receipt-bootstrap-verified.json')['bootstrap']['verified']
state=read(C/'state-after-independent-ui.json');assert state['allEightCatalogSectionsUnchanged']and state['originalSeedHashesAndServiceHistoriesUnchanged']
assert state['resumeCheckpoint']['requiredDraft']['revision']==0 and state['resumeCheckpoint']['requiredDraft']['captionIsEmpty']
assert len(state['phaseInventories'])==3 and all(p['allCapsPass']and p['allJournalsResolved']and p['families']==70 for p in state['phaseInventories'])
assert all(w['beforeAfterExactlyEqual']and w['nineFinancialFamiliesAndAllWorkspaceXpCompared']and w['inventoryCompared']for w in read(C/'core/neutrality-evidence-summary.json')['windows'])
assert d['originalRuntime']['role']['passed']==8 and d['originalRuntime']['core']['passed']==9
assert d['originalRuntime']['browser']=={'passed':2,'failed':1,'notRun':2,'phaseExit':1}
assert d['incidentOpen']and d['releaseHold']and not d['providerEnabled']and not d['restored']and not d['wholeR1Verified']
assert d['D15ContentBlocked']and d['advisorOwnerDeviceHostedFormalStaffBlocked']and not d['sourceRevisionRuntimeApproved']
assert not any(d[k]for k in ['productionDataOrMembershipWrites','pristineRpcRerun','push','merge','deploy','originalThreeCampaignsTouched'])and d['commit']is None
assert root['financialNeutrality']['allEqual']is None and not root['finalDeliveryReview']['canDeploy']and not root['finalDeliveryReview']['canEnablePilot']
full=read(R/g['full']['report']);receipt=read(R/g['full']['commandReceipt']);assert full['success']and full['numFailedTests']==0 and receipt['exit']==0 and receipt['sourceFingerprint']==fp['fingerprint']
assert full['numPassedTests']==g['full']['passed']and full['numPendingTests']==g['full']['gatedSkip']and len(full['testResults'])==g['full']['files']
assert g['originalAudit16']['passed']==16 and g['protected194']['passed']==194
for k in ['lint','type','build','esm','manifest','offline']:
 r=read(R/g[k]['receipt']);assert r['exit']==0 and r['sourceFingerprint']==fp['fingerprint']and not r['actualC1TargetUsed']
oldroot=read(C/'runtime-before/adfocate-delivery.json')
assert [(r['caseId'],r['originalAuditResult'],r['originalEnvironment'])for r in root['caseResults']]==[(r['caseId'],r['originalAuditResult'],r['originalEnvironment'])for r in oldroot['caseResults']]
for name,count,allowed in [('audit_case_coverage.csv',107,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'}),('implementation_backlog.csv',20,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','evidence'})]:
 old,new=rows(C/'runtime-before'/name),rows(V/name);assert len(old)==len(new)==count
 for x,y in zip(old,new):assert all(x[k]==y[k]for k in x if k not in allowed),(name,x)
assert len(rows(V/'finding_traceability.csv'))==28 and sha(V/'finding_traceability.csv')==sha(C/'runtime-before/finding_traceability.csv')
for case in ['UC-C18','UC-A51']:assert next(r for r in rows(V/'audit_case_coverage.csv')if r['case_id']==case)==next(r for r in rows(C/'runtime-before/audit_case_coverage.csv')if r['case_id']==case)
rollback=read(V/'D19-C1-rollback.json')
for item in rollback['metadataFiles']:assert sha(R/item['path'])==item['afterSha256']and sha(R/item['beforeCopy'])==item['beforeSha256']
for item in rollback['sourceFiles']:
 assert sha(R/item['path'])==item['afterSha256']
 if 'beforePrivateCopy'in item:assert sha(R/item['beforePrivateCopy'])==item['beforeSha256']
for n in ['D19-C1-integrity.json','evidence-integrity.json']:
 seal=read(V/n);assert seal['codeFingerprint']==fp['fingerprint']
 for item in seal['files']:assert sha(R/item['path'])==item['sha256']and(R/item['path']).stat().st_size==item['bytes'],item['path']
assert {p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}=={r['path']for r in read(V/'evidence-integrity.json')['files']}
assert root['evidenceIntegrity']['records']==len(read(V/'evidence-integrity.json')['files'])and root['D19C1Followup']==d
print(json.dumps({'status':'PASS_CURRENT_LOCAL_HANDOFF_AND_PARTIAL_ORIGIN_RUNTIME_RECORDS_NOT_R1_ACCEPTANCE','sourceFingerprint':fp['fingerprint'],'localPassed':g['full']['passed'],'failed':0,'gatedSkip':g['full']['gatedSkip'],'original16':16,'protected194':194,'originApiPassed':17,'originBrowserPassFailNotRun':[2,1,2],'newSourceRuntimeApproved':False,'incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
