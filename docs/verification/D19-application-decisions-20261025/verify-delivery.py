"""Pure file/source/evidence checks. No SDK, services, credentials or target queries."""
from pathlib import Path
import csv,hashlib,json,subprocess
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';A=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
s=read(A/'candidate-source.json');fp=read(V/'code-fingerprint.json');d=read(A/'delivery.json');root=read(V/'adfocate-delivery.json');g=read(A/'gates.json')
assert len(s['files'])==785 and s['fingerprint']==fp['fingerprint']==d['sourceFingerprint']==root['codeFingerprint']==g['sourceFingerprint']
assert hashlib.sha256(json.dumps(s['files'],separators=(',',':')).encode()).hexdigest()==s['fingerprint']
for f in s['files']:assert hashlib.sha256((R/f['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
assert fp['files']==s['files']and fp['runtimeManifestPath']is None and fp['runtimeApprovalStatus']=='NOT_GRANTED_FOR_CURRENT_SOURCE'
old=read(R/fp['runtimeEvidenceSource']['path']);assert sha(R/fp['runtimeEvidenceSource']['path'])==fp['runtimeEvidenceSource']['sha256']and old['fingerprint']==fp['runtimeEvidenceSource']['fingerprint']!=fp['fingerprint']
m=read(R/old['runtimeManifestPath']);assert m['candidate']['fingerprint']==old['fingerprint']and sha(R/old['runtimeManifestPath'])=='696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d'
for item in m['schemaProfile']['fullMigrations']:assert sha(R/item['path'])==item['sha256']
assert len(m['schemaProfile']['fullMigrations'])==72 and len(list((R/'supabase/migrations').glob('*.sql')))==73
manifest=read(R/'supabase/release-manifest.json');before=read(A/'before/supabase/release-manifest.json');assert len(manifest['migrations'])==43 and manifest['migrations'][:-1]==before['migrations']
last=manifest['migrations'][-1];assert last['version']=='20261025120934'and last['phase']=='operator_crm'and len(last['capabilities'])==4
capabilities={c for x in manifest['migrations']for c in x['capabilities']};assert len(capabilities)==591 and len(capabilities-set(last['capabilities']))==587
assert last['sha256']==sha(R/last['path'])
full=read(A/'full-delivery-final.json');assert full['success']and(full['numPassedTests'],full['numFailedTests'],full['numPendingTests'],len(full['testResults']))==(2103,0,363,291)
reports={x['name'].replace('\\','/').split('/adfocate-r1-20261023/')[-1]:x for x in full['testResults']}
audit=[a for p,x in reports.items()if p.startswith('src/audit-tests/')for a in x['assertionResults']];assert len(audit)==16 and all(a['status']=='passed'for a in audit)
protected=[a for p in g['protectedPaths']for a in reports[p]['assertionResults']];assert len(protected)==194 and all(a['status']=='passed'for a in protected)
for name,total in [('applicationTransport',7),('applicationEmbedded',10),('operatorUi',4),('creatorDetailUi',20)]:assert g[name]=={'passed':total,'failed':0,'skipped':0,'total':total}
for name in ['full-delivery-final','type-delivery-final','lint-delivery-final','build-delivery-final','esm-delivery-final','manifest-delivery-final']:
 c=read(A/f'{name}-command.json');assert c['exit']==0 and c['sourceFingerprint']==s['fingerprint']and c['nodeVersion']=='v22.23.4'and c['childPathPrefersSameNode22']and c['offlineOnly']and not c['actualTargetUsed']and not c['packageDownloadOrInstall']
 for item in [g[name]['receipt'],g[name]['log']]:assert sha(R/item['path'])==item['sha256']
assert read(A/'red.json')['numFailedTests']==3 and read(A/'creator-reason-red.json')['numFailedTests']==2 and read(A/'no-body-compatibility-red.json')['numFailedTests']==1
assert read(A/'full-final.json')['numFailedTests']==12 and read(A/'full-current-candidate.json')['numFailedTests']==1
oldRows=rows(A/'before/docs/verification/audit_case_coverage.csv');newRows=rows(V/'audit_case_coverage.csv');assert len(oldRows)==len(newRows)==107
allowed={'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'};changed=[]
for x,y in zip(oldRows,newRows):
 assert all(x[k]==y[k]for k in x if k not in allowed)
 if x!=y:changed.append(x['case_id'])
 if x['case_id']in ['UC-C18','UC-A51']:assert x==y
assert set(changed)=={'UC-C25','UC-A06','UC-A10'}
coverage=read(A/'case-coverage.json');assert len(coverage['cases'])==107 and not coverage['wholeR1Verified']and coverage['retainedRuntime']['sourceFingerprint']==old['fingerprint']
beforeRoot=read(A/'before/docs/verification/adfocate-delivery.json');assert root['D15']==beforeRoot['D15']and root['D19C1ContinuationRuntime']==beforeRoot['D19C1ContinuationRuntime']
assert root['D19ApplicationDecisionLocal']==d and root['currentRecordAuthority']['currentLocalSource']==s['fingerprint']and root['currentRecordAuthority']['currentRuntimeSource']is None
assert not d['runtime']['authorizedForCurrentSource']and d['runtime']['serverTargetActionsExecuted']==d['runtime']['physicalResourcesCreated']==d['runtime']['newAuthSubjectsOrSessions']==d['runtime']['newServerFixtures']==0
assert d['runtime']['memoryContractTestsExecuted']and not d['wholeR1Verified']and d['incidentOpen']and not d['restored']and d['releaseHold']and not d['providerEnabled']
assert d['D15ContentBlocked']and d['advisorOwnerDeviceHostedFormalStaffBlocked']and not d['productionDataOrMembershipWrites']and d['commit']is None and not any(d[x]for x in ['push','merge','deploy'])
assert not root['finalDeliveryReview']['canDeploy']and not root['finalDeliveryReview']['canEnablePilot']and root['financialNeutrality']['allEqual']is None
checkpoint=read(A/'checkpoint.json');beforeMap={x['path']:R/x['beforeCopy']for x in checkpoint['files']}
for x in checkpoint['files']:assert sha(R/x['beforeCopy'])==x['sha256']
prior=read(A/'before/docs/verification/evidence-integrity.json');modified=[]
def historical_file(item):
 path=R/item['path']
 if sha(path)==item['sha256']:return path
 assert item['path']in beforeMap and sha(beforeMap[item['path']])==item['sha256'],('Missing exact previous bytes',item['path'])
 return beforeMap[item['path']]
for item in prior['files']:
 historical_file(item)
 if sha(R/item['path'])!=item['sha256']:modified.append(item['path'])
historical=read(V/'D19-C1-integrity.json');assert historical['codeFingerprint']==old['fingerprint']
for item in historical['files']:historical_file(item)
assert len(rows(V/'finding_traceability.csv'))==28
rollback=read(A/'rollback.json');assert rollback['reconstruction']['passed']and rollback['reconstruction']['fingerprint']==old['fingerprint']and not rollback['dataRollbackExecuted']and not rollback['serverTargetSchemaApplied']and not rollback['resourceStopDeleteResetRecreateAllowed']
for x in rollback['metadataFiles']:assert sha(R/x['path'])==x['afterSha256']and sha(R/x['beforeCopy'])==x['beforeSha256']
for p in [V/'D19-application-decisions-integrity.json',V/'evidence-integrity.json']:
 seal=read(p);assert seal['codeFingerprint']==s['fingerprint']
 for x in seal['files']:assert sha(R/x['path'])==x['sha256']and(R/x['path']).stat().st_size==x['bytes'],x['path']
assert{p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}=={x['path']for x in read(V/'evidence-integrity.json')['files']}
assert root['evidenceIntegrity']['records']==len(read(V/'evidence-integrity.json')['files'])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()==s['headSha']and not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=R,text=True).strip()
print(json.dumps({'status':'PASS_LOCAL_APPLICATION_DECISION_DELIVERY_NOT_REAL_RUNTIME_OR_WHOLE_R1','sourceFingerprint':s['fingerprint'],'sourceFiles':785,'fullPassed':2103,'failed':0,'gatedSkip':363,'originalAudit16':16,'protected194':194,'sourceMigrations':73,'oldMigrationChecksumsPreserved':72,'serverTargetActions':0,'priorEvidenceRecordsPreserved':len(prior['files']),'modifiedPriorMetadataWithExactBefore':len(modified),'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False}))
