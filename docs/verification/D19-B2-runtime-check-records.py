"""Read-only source/evidence/decision verifier. Never contacts Docker or a service target."""
from pathlib import Path
import os,json,hashlib,csv,subprocess
R=Path(__file__).resolve().parents[2];os.chdir(R);V=Path('docs/verification');P='D19-B2-runtime'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
fp=read(V/'code-fingerprint.json');d=read(V/(P+'-delivery.json'));root=read(V/'adfocate-delivery.json')
assert len(fp['files'])==779 and fp['fingerprint']==d['sourceFingerprint']==root['codeFingerprint']
assert hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest()==fp['fingerprint']
for f in fp['files']:assert hashlib.sha256(Path(f['path']).read_bytes().decode('utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
assert not subprocess.run(['git','diff','--cached','--name-only'],capture_output=True,text=True,check=True).stdout.strip()
assert subprocess.run(['git','rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()==d['headSha']
assert d['runtimeApproved']and not d['applicationBootstrapVerified']and not d['sourceChanged']
assert d['actualProjectsAllocated']==d['actualVolumesCreated']==d['actualNetworksCreated']==1 and d['actualContainersCreated']==5
assert d['fixtureRowsCreated']==d['actualApplicationClientsCreated']==d['roleRuns']==d['coreRuns']==d['browserRuns']==0
assert not d['recoveryRuntimeApproved']and d['actualRecoveryResourceOperations']==0
assert d['incidentOpen']and not d['restored']and not d['originalThreeCampaignsTouched']and d['releaseHold']and not d['providerEnabled']and not d['wholeR1Verified']
assert d['commit']is None and not d['push']and not d['merge']and not d['deploy']and not d['productionDataOrMembershipWrites']and not d['pristineRpcRerun']
assert d['D15ContentBlocked']and d['advisorOwnerDeviceHostedFormalStaffBlocked']
public=V/Path(d['resources']).parent
authority=read(public/'authorization.json');receipt=read(public/'target-receipt.json');live=read(public/'final-infrastructure-readback.json')
assert authority['approved']and authority['ownerReference']==d['ownerReference']and authority['manifestSha256']==d['approvedManifestSha256']==sha(V/d['approvedManifest'])
assert len(receipt['containerIds'])==5 and len(set(receipt['containerIds'].values()))==5
assert live['containers']['db']['running']and all(not c['running']for s,c in live['containers'].items()if s!='db')
assert not live['fullFiveServiceIdentityGatePassed']and not live['applicationBootstrapVerified']and not receipt['bootstrap']['verified']
c=live['publicApplicationCatalog'];assert c['publicTables']==c['publicViews']==c['publicRpcs']==c['publicPolicies']==c['authUsers']==0 and c['applicationMigrationHistory']is None
bad=read(public/'role-baseline-diff.json')['catalog'];assert str(bad['bootstrapRole']['oid'])=='10'and bad['bootstrapRole']['name']=='post'+'gres'and bad['bootstrapRole']['superuser']
assert root['financialNeutrality']['allEqual']is None and not root['finalDeliveryReview']['canDeploy']and not root['finalDeliveryReview']['canEnablePilot']
m=read(V/d['recoveryManifest']);a=read(V/'D19-B2-recovery-runtime-authorization-template.json');profile=read(V/'D19-B2-recovery-bootstrap-profile.json')
assert sha(V/d['recoveryManifest'])==a['manifestSha256']==d['recoveryManifestSha256']
assert not a['approved']and a['ownerReference']is None and not m['approval']['runtimeApproved']and not m['canExecute']
assert m['candidate']['fingerprint']==fp['fingerprint']and m['candidate']['sourceRecords']==779
assert m['target']['projectId']!=receipt['identity']['projectId']and m['target']['plannedOwnerRunId']!=receipt['identity']['runId']
assert m['target']['databaseInitialization']['initialDatabaseUser']=='supabase_admin'
assert sha(V/m['target']['databaseInitialization']['prestartGuardPath'])==m['target']['databaseInitialization']['prestartGuardSha256']
assert profile['profileDigest']==m['bootstrap']['profileDigest']and len(profile['migrations'])==72
for f in m['schemaProfile']['fullMigrations']:assert sha(f['path'])==f['sha256']
assert m['schemaProfile']['protectedEntries']==42
original=read(V/d['approvedManifest']);assert original['fixture']['rowCaps']==m['fixture']['rowCaps']and original['fixture']['rowScopes']==m['fixture']['rowScopes']
assert original['target']['serviceImageIds']==m['target']['serviceImageIds']
assert m['bootstrap']['historicalLegacy']['submissionId']!=original['bootstrap']['historicalLegacy']['submissionId']
assert len(set(x['plannedNamespace']for x in original['fixture']['phases'])&set(x['plannedNamespace']for x in m['fixture']['phases']))==0
assert read(V/'D19-B2-recovery-offline-check.json')['futureRuntimeApproved']is False
assert all(x['passed']for x in read(V/(P+'-cli-refusals.json'))['results'])
assert not any(read(V/(P+'-cli-refusals.json'))['counts'].values())
old=read(V/(P+'-before/adfocate-delivery.json'))
assert[(c['caseId'],c['originalAuditResult'],c['originalEnvironment'])for c in old['caseResults']]==[(c['caseId'],c['originalAuditResult'],c['originalEnvironment'])for c in root['caseResults']]
for name,count,allowed in [('audit_case_coverage.csv',107,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'}),('implementation_backlog.csv',20,{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','evidence'})]:
 x=rows(V/(P+'-before')/name);y=rows(V/name);assert len(x)==len(y)==count
 for a,b in zip(x,y):assert all(a[k]==b[k]for k in a if k not in allowed),(name,a)
assert len(rows(V/'finding_traceability.csv'))==28 and sha(V/'finding_traceability.csv')==sha(V/(P+'-before/finding_traceability.csv'))
for name in ['UC-C18','UC-A51']:
 assert next(x for x in rows(V/'audit_case_coverage.csv')if x['case_id']==name)==next(x for x in rows(V/(P+'-before/audit_case_coverage.csv'))if x['case_id']==name)
previous=read(V/(P+'-before/evidence-integrity.json'))
allowed={'docs/verification/'+name for name in ['adfocate-delivery.json','implementation_backlog.csv','audit_case_coverage.csv','adfocate-task-ledger.md']}
changed=[x['path']for x in previous['files']if not Path(x['path']).is_file()or sha(x['path'])!=x['sha256']]
assert len(previous['files'])==1380 and set(changed)<=allowed,changed
assert read(V/(P+'-preservation.json'))['changedPriorPaths']==sorted(changed)
for x in read(V/(P+'-rollback.json'))['metadataFiles']:
 assert sha(x['path'])==x['afterSha256']and sha(V/x['beforeCopy'])==x['beforeSha256']
for name in [P+'-integrity.json','evidence-integrity.json']:
 seal=read(V/name);assert seal['codeFingerprint']==fp['fingerprint']
 for x in seal['files']:assert Path(x['path']).is_file()and Path(x['path']).stat().st_size==x['bytes']and sha(x['path'])==x['sha256'],x['path']
assert{p.as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}=={x['path']for x in read(V/'evidence-integrity.json')['files']}
print(json.dumps({'status':'PASS_PARTIAL_RUNTIME_EVIDENCE_INTEGRITY_NOT_R1_ACCEPTANCE','sourceFingerprint':fp['fingerprint'],'sourceRecords':779,'priorEvidenceRecords':len(previous['files']),'priorEvidenceByteUnchanged':len(previous['files'])-len(changed),'originalAuditCases':107,'originalFindings':28,'originalB2RuntimeApproved':True,'applicationSuitesExecuted':0,'recoveryRuntimeApproved':False,'incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
