"""Read-only checkpoint verifier. No Docker, SQL, keys, client or service calls."""
from pathlib import Path
import json, hashlib, csv, subprocess

R=Path(__file__).resolve().parents[2];V=R/'docs/verification';C=V/'adfocate-d19-b2-20261025-recovery-4d6ca2c8'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
fp=read(V/'code-fingerprint.json');d=read(V/'D19-C1-delivery.json');root=read(V/'adfocate-delivery.json');before=read(C/'before/code-fingerprint.json')
assert len(fp['files'])==779 and fp['fingerprint']==d['sourceFingerprint']==root['codeFingerprint']
assert hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest()==fp['fingerprint']
for row in fp['files']:
    assert hashlib.sha256((R/row['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==row['sha256'],row['path']
changed=[b['path'] for a,b in zip(before['files'],fp['files']) if a['sha256']!=b['sha256']]
assert changed==d['sourceChangedPaths']==['scripts/audit/local-targets.mjs','server/test/b2-runtime-manifest.test.ts','server/test/b2-target-context.test.ts']
assert subprocess.run(['git','rev-parse','HEAD'],cwd=R,capture_output=True,text=True,check=True).stdout.strip()==d['headSha']
assert not subprocess.run(['git','diff','--cached','--name-only'],cwd=R,capture_output=True,text=True,check=True).stdout.strip()
assert d['originalC1RuntimeApproved'] and not d['sourceRevisionRuntimeApproved'] and d['sourceRevisionAdditionalResources']==0
assert not d['applicationBootstrapVerified'] and d['applicationMigrationsApplied']==d['businessFixtureRowsCreated']==d['applicationClientsCreated']==d['roleRuns']==d['coreRuns']==d['browserRuns']==0
assert d['incidentOpen'] and d['releaseHold'] and not d['providerEnabled'] and not d['restored'] and not d['wholeR1Verified']
assert d['D15ContentBlocked'] and d['advisorOwnerDeviceHostedFormalStaffBlocked'] and not d['productionDataOrMembershipWrites'] and not d['pristineRpcRerun']
assert d['commit'] is None and not any(d[k] for k in ['push','merge','deploy','originalThreeCampaignsTouched'])
authority=read(C/'original-c1-authority.json');receipt=read(C/'original-c1-target-receipt.json')
assert authority['approved'] and authority['manifestSha256']==d['originalC1ManifestSha256']==sha(V/d['originalC1Manifest'])
assert receipt['manifestSha256']==authority['manifestSha256'] and receipt['sourceFingerprint']==before['fingerprint']==authority['sourceFingerprint']
for record in read(C/'private-receipt-preservation.json')['protected']:
    assert sha(R/record['privatePath'])==record['sha256']
m=read(V/d['sourceRevisionManifest']);template=read(V/'D19-C1-source-revision-authorization-template.json')
assert sha(V/d['sourceRevisionManifest'])==d['sourceRevisionManifestSha256']==template['manifestSha256']
assert template['sourceFingerprint']==m['candidate']['fingerprint']==fp['fingerprint'] and not template['approved'] and template['ownerReference'] is None
assert not m['canExecute'] and not m['approval']['runtimeApproved'] and not m['execution']['pristineRpcRerun']
assert m['target']['actualContainerIds']==receipt['containerIds'] and m['target']['actualNetworkId']==receipt['identity']['networkId']
old=read(V/d['originalC1Manifest']);assert m['fixture']==old['fixture'] and m['schemaProfile']==old['schemaProfile']
assert m['bootstrap']['profileDigest']==old['bootstrap']['profileDigest']==read(V/m['bootstrap']['profilePath'])['profileDigest']
assert all(m['target']['additionalAllocationOnly'][key]==0 for key in ['newProjects','newPersistentDataVolumes','newNetworks','newContainers'])
assert sha(V/m['execution']['matrix'])==m['execution']['matrixSha256']
assert not (R/m['execution']['environment']['ADFOCATE_B2_AUTHORIZATION_PATH']).exists()
for phase in ['role','core','browser']:
    assert not any(p.is_file() for p in (R/'.codex-tmp'/d['projectId']/phase).rglob('*'))
for record in m['schemaProfile']['fullMigrations']:assert sha(R/record['path'])==record['sha256']
assert len(m['schemaProfile']['fullMigrations'])==72 and m['schemaProfile']['protectedEntries']==42
live=read(C/'metadata-after-fix-readonly.json');foundation=read(C/'db-foundation.json')
assert live['allFiveMetadataChecksPassed'] and live['storageBytes']==268435456 and all(c['running'] for c in live['containers'].values())
assert not live['applicationKeysRead'] and not live['applicationClientCreated'] and not live['applicationSqlOrFixtureWrite']
assert foundation['actualPrestartContractPassed'] and foundation['actualPostImageContractPassed']
catalog=foundation['observation']['catalog'];assert str(catalog['bootstrapRole']['oid'])=='10' and catalog['bootstrapRole']['name']=='supabase_admin'
assert catalog['publicTables']==catalog['authUsers']==0 and catalog['applicationHistory'] is None
assert root['financialNeutrality']['allEqual'] is None and not root['finalDeliveryReview']['canDeploy'] and not root['finalDeliveryReview']['canEnablePilot']
gates=read(V/'D19-C1-gates.json');full=read(C/'full-suite-final.json')
assert gates['full']['passed']==full['numPassedTests']==2058 and full['numFailedTests']==0 and full['numPendingTests']==363 and len(full['testResults'])==288
assert read(C/'full-suite-final-command.json')['exit']==0 and read(C/'full-suite-final-command.json')['sourceFingerprint']==fp['fingerprint']
assert gates['originalAudit16']['passed']==16 and gates['protected194']['passed']==194
oldroot=read(C/'before/adfocate-delivery.json')
assert [(r['caseId'],r['originalAuditResult'],r['originalEnvironment']) for r in root['caseResults']]==[(r['caseId'],r['originalAuditResult'],r['originalEnvironment']) for r in oldroot['caseResults']]
for name,count,allowed in [('audit_case_coverage.csv',107,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'}),('implementation_backlog.csv',20,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','evidence'})]:
    a=rows(C/'before'/name);b=rows(V/name);assert len(a)==len(b)==count
    for x,y in zip(a,b):assert all(x[k]==y[k] for k in x if k not in allowed),(name,x)
assert len(rows(V/'finding_traceability.csv'))==28 and sha(V/'finding_traceability.csv')==sha(C/'before/finding_traceability.csv')
for id in ['UC-C18','UC-A51']:
    assert next(x for x in rows(V/'audit_case_coverage.csv') if x['case_id']==id)==next(x for x in rows(C/'before/audit_case_coverage.csv') if x['case_id']==id)
prior=read(C/'before/evidence-integrity.json');preserved=read(V/'D19-C1-preservation.json')
changed=[r['path'] for r in prior['files'] if not (R/r['path']).is_file() or sha(R/r['path'])!=r['sha256']]
assert len(prior['files'])==1439 and sorted(changed)==preserved['changedPriorPaths']
for record in read(V/'D19-C1-rollback.json')['metadataFiles']:
    assert sha(R/record['path'])==record['afterSha256'] and sha(R/record['beforeCopy'])==record['beforeSha256']
for name in ['D19-C1-integrity.json','evidence-integrity.json']:
    seal=read(V/name);assert seal['codeFingerprint']==fp['fingerprint']
    for record in seal['files']:
        p=R/record['path'];assert p.is_file() and sha(p)==record['sha256'] and p.stat().st_size==record['bytes'],record['path']
assert {p.relative_to(R).as_posix() for p in V.rglob('*') if p.is_file() and p!=V/'evidence-integrity.json'}=={r['path'] for r in read(V/'evidence-integrity.json')['files']}
assert root['evidenceIntegrity']['records']==len(read(V/'evidence-integrity.json')['files']) and root['D19C1Followup']==d
print(json.dumps({'status':'PASS_C1_LOCAL_INFRA_AND_EVIDENCE_CHECKPOINT_NOT_R1_ACCEPTANCE','sourceFingerprint':fp['fingerprint'],'fullPassed':2058,'failed':0,'gatedSkip':363,'original16':16,'protected194':194,'priorEvidenceByteUnchanged':preserved['priorEvidenceByteUnchanged'],'originalC1AllocationApproved':True,'sourceRevisionRuntimeApproved':False,'extraResources':0,'applicationSuitesExecuted':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
