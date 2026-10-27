"""Read-only local records verifier; never creates clients or connects to targets."""
from pathlib import Path
import os,json,hashlib,csv,subprocess

ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
V=Path('docs/verification');P='D19-B2-neutrality-guard'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
def canonical(p):return hashlib.sha256(Path(p).read_bytes().decode('utf-8').replace('\r\n','\n').encode()).hexdigest()

fp=read(V/'code-fingerprint.json');d=read(V/(P+'-delivery.json'));r=read(V/'adfocate-delivery.json')
assert len(fp['files'])==779 and fp['fingerprint']==d['sourceFingerprint']==r['codeFingerprint']
assert hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest()==fp['fingerprint']
for f in fp['files']:assert canonical(f['path'])==f['sha256'],f['path']
oldfp=read(V/(P+'-before/docs/verification/code-fingerprint.json'))
assert len(oldfp['files'])==777 and set(f['path']for f in oldfp['files'])<=set(f['path']for f in fp['files'])
assert fp['fingerprint']!=oldfp['fingerprint']
assert not subprocess.run(['git','diff','--cached','--name-only'],check=True,capture_output=True,text=True).stdout.strip()
assert subprocess.run(['git','rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()==d['headSha']

m=read(V/d['runtimeManifest']);a=read(V/d['runtimeAuthorizationTemplate'])
assert sha(V/d['runtimeManifest'])==a['manifestSha256']==d['runtimeManifestSha256']
assert m['candidate']['fingerprint']==a['sourceFingerprint']==fp['fingerprint']
assert m['sourceRecords']==m['candidate']['sourceRecords']==779
assert not a['approved']and not m['canExecute']and not m['ownerApproved']and not m['approval']['runtimeApproved']
assert a['ownerReference']is None
oldm=read(V/'D19-B2-runtime-manifest.json')
assert oldm['target']==m['target']and oldm['fixture']['rowCaps']==m['fixture']['rowCaps']and oldm['fixture']['rowScopes']==m['fixture']['rowScopes']
assert not m['execution']['pristineRpcRerun']
for f in m['schemaProfile']['fullMigrations']:assert sha(f['path'])==f['sha256'],f['path']
assert len(m['schemaProfile']['fullMigrations'])==72 and m['schemaProfile']['protectedEntries']==42
assert read(V/'D19-B2-bootstrap-profile.json')['profileDigest']==m['bootstrap']['profileDigest']
assert d['incidentOpen']and d['releaseHold']and not d['restored']and not d['providerEnabled']and not d['wholeR1Verified']
assert d['D15ContentBlocked']and d['advisorOwnerDeviceHostedFormalStaffBlocked']
assert d['actualNewTargets']==d['actualFixtureRowsCreated']==d['actualBrowserOrIntegrationRuns']==0
assert not d['runtimeApproved']and not d['productionDataOrMembershipWrites']and not d['pristineRpcRerun']
assert d['commit']is None and not d['push']and not d['merge']and not d['deploy']
assert r['deploymentStatus']=='not-deployed'and r['currentCandidateVerificationScope']['newRuntimeEvidence']is False
assert r['financialNeutrality']['actualDatabaseEqualityClaimed']is False and r['browser']['currentRuntime']=='NOT_RUN_NOT_APPROVED'
assert not r['finalDeliveryReview']['canDeploy']and not r['finalDeliveryReview']['canEnablePilot']
assert r['currentExecutionModelVerification']['actualModelId']is None and not r['currentExecutionModelVerification']['modelSwitchPerformed']
assert r['currentToolchainVerification']['node22CurrentCandidate']=='NOT_RUN'

g=read(V/(P+'-gates.json'))
assert len(g['gates'])==5 and not g['actualIntegrationOrBrowserExecuted']
for gate in g['gates']:
 assert gate['exit']==0 and gate['sourceUnchangedAfter']and gate['sourceFingerprint']==fp['fingerprint']and gate['sourceRecords']==779
 assert gate['realTargetIntegrationEnabled']is False and gate['providerKeysSupplied']is False
 assert sha(V/gate['publicLog'])==gate['publicLogSha256']==gate['logSha256']
f=read(V/(P+'-full-results.json'))
assert(f['numPassedTests'],f['numFailedTests'],f['numPendingTests'],f['files'])==(2047,0,363,288)
assert(f['audit16Passed'],f['original194Passed'],f['newLocalTests'],f['newRuntimeCasesPassed'])==(16,194,20,0)
assert sum(a['status']=='passed'for t in f['testResults']for a in t['assertions'])==2047
history=read(V/(P+'-test-history.json'))
for x in history['attempts']:assert sha(V/x['path'])==x['sha256']
valid=[x for x in history['attempts']if x['interpretation'].startswith('VALID_RED')]
assert [(x['passed'],x['failed'])for x in valid]==[(0,18),(0,2)]
assert read(V/(P+'-e2e-syntax.json'))['runtimeExecuted']is False
assert read(V/(P+'-e2e-syntax.json'))['diagnostics']==[]
metadata=read(V/(P+'-post-full-metadata-check.json'))
assert(metadata['exit'],metadata['passed'],metadata['failed'],metadata['skipped'])==(0,3,0,0)
assert metadata['sourceFingerprint']==fp['fingerprint']and metadata['sourceUnchangedAfter']
assert sha(V/metadata['publicLog'])==metadata['logSha256']

old=read(V/(P+'-before/docs/verification/adfocate-delivery.json'))
assert [(c['caseId'],c['originalAuditResult'],c['originalEnvironment'])for c in old['caseResults']]==[(c['caseId'],c['originalAuditResult'],c['originalEnvironment'])for c in r['caseResults']]
for name,allowed,count in [('audit_case_coverage.csv',{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'},107),('implementation_backlog.csv',{'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','evidence'},20)]:
 previous=rows(V/(P+'-before/docs/verification/'+name));current=rows(V/name)
 assert len(previous)==len(current)==count
 for x,y in zip(previous,current):assert all(x[k]==y[k]for k in x if k not in allowed),(name,x)
assert len(rows(V/'finding_traceability.csv'))==28
for case in ['UC-C18','UC-A51']:
 assert next(c for c in rows(V/'audit_case_coverage.csv')if c['case_id']==case)==next(c for c in rows(V/(P+'-before/docs/verification/audit_case_coverage.csv'))if c['case_id']==case)
index=read(V/(P+'-before-index.json'))
assert len(index['files'])==14
for x in index['files']:assert sha(V/(P+'-before')/x['path'])==x['sha256']
changes=read(V/(P+'-changed-source.json'))
assert changes['sourceFilesChanged']==8 and len(changes['files'])==9
for x in changes['files']:
 assert sha(x['path'])==x['afterSha256']
 if x['beforeCopy']:assert sha(V/x['beforeCopy'])==x['beforeSha256']
previous=read(V/(P+'-before/docs/verification/evidence-integrity.json'))
allow={'docs/verification/'+n for n in ['adfocate-delivery.json','code-fingerprint.json','implementation_backlog.csv','audit_case_coverage.csv']}
changed=[]
for x in previous['files']:
 if not Path(x['path']).is_file()or sha(x['path'])!=x['sha256']:changed.append(x['path'])
assert set(changed)<=allow,changed
assert len(previous['files'])==1321
preservation=read(V/(P+'-preservation.json'))
assert preservation['priorEvidenceRecords']==len(previous['files'])and preservation['priorEvidenceChanged']==sorted(changed)
assert preservation['originalP0ArtifactsBytePreserved']and preservation['oldRuntimeManifestBytePreserved']
for name in [P+'-integrity.json','evidence-integrity.json']:
 seal=read(V/name);assert seal['codeFingerprint']==fp['fingerprint']
 for x in seal['files']:assert Path(x['path']).stat().st_size==x['bytes']and sha(x['path'])==x['sha256'],x['path']
assert {x['path']for x in read(V/'evidence-integrity.json')['files']}=={p.as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
print(json.dumps({'status':'PASS_LOCAL_NEUTRALITY_GUARD_RECORD_INTEGRITY_NOT_RUNTIME_ACCEPTANCE','sourceFingerprint':fp['fingerprint'],'sourceRecords':779,'fullPass':2047,'fullFail':0,'gatedSkip':363,'priorEvidenceRecords':len(previous['files']),'priorEvidenceByteUnchanged':len(previous['files'])-len(changed),'auditCases':107,'findings':28,'runtimeApproved':False,'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False}))
