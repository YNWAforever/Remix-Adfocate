"""Verify the107-case offline reconciliation against actual immutable reports. No services."""
from pathlib import Path
import json,csv,hashlib,collections,re
R=Path(__file__).resolve().parents[2];V=R/'docs/verification';C=V/'adfocate-d19-b2-20261025-recovery-4d6ca2c8'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with(V/'audit_case_coverage.csv').open(encoding='utf-8-sig',newline='')as f:original=list(csv.DictReader(f))
d=read(V/'D19-C1-R1-applicability-reconciliation.json');fp=read(V/'code-fingerprint.json');assert d['sourceFingerprint']==fp['fingerprint']and d['sourceFiles']==len(fp['files'])==782
assert len(d['cases'])==len(original)==107 and len({r['caseId']for r in d['cases']})==107
assert d['phaseCounts']=={'R0':2,'R1':62,'R2':29,'GATE':14}
assert not d['currentR1Verified']and not d['pendingManifestChanged']and d['runtimeExecutedThisReview']==d['sdkDockerSqlAuthCalls']==0
for item in d['inputs']+[d['pendingManifest']]:assert sha(R/item['path'])==item['sha256'],item['path']
assert d['pendingManifest']['sha256']=='696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d'
m=read(R/d['pendingManifest']['path']);assert not(R/m['execution']['environment']['ADFOCATE_B2_AUTHORIZATION_PATH']).exists()
assert not(R/'.codex-tmp'/m['target']['projectId']/m['execution']['artifactNamespace']).exists()
full=read(C/'continuation-final-full.json');suites={s['name'].replace('\\','/').split('/adfocate-r1-20261023/')[-1]:s for s in full['testResults']}
originalNamed=[a for p,s in suites.items()if p.startswith('src/audit-tests/')for a in s['assertionResults']]
assert len(originalNamed)==16 and all(a['status']=='passed'for a in originalNamed)
originalIds={match for a in originalNamed for match in re.findall(r'\bUC-[A-Z]\d{2}\b',a['fullName'])};assert len(originalIds)==15
assert d['currentOriginalAuditAssertions']==16 and d['currentOriginalAuditCaseIds']==15
assert [d['protectedContractGroups'][k]['passed']for k in ['UC-A34','UC-A35','UC-A36','UC-A37']]==[20,6,67,101]
witnesses={w['id']:w for w in d['originC1ApiWitnesses']};assert len(witnesses)==17
for witness in witnesses.values():
 assert witness['status']=='passed'and not witness['currentSourceApiReexecution']and sha(R/witness['file'])==witness['fileSha256']
 result=read(R/witness['phaseResult']['path']);assert result['exitCode']==0 and result['lineage']['sourceFingerprint']==witness['sourceFingerprint']
 assert sha(R/witness['phaseResult']['path'])==witness['phaseResult']['sha256']
for case,row in zip(d['cases'],original):
 assert(case['caseId'],case['phase'],case['originalAuditResult'],case['originalEnvironment'],case['originalExpected'])==(row['case_id'],row['phase'],row['original_audit_result'],row['original_environment'],row['expected'])
 assert case['currentNewResultPreserved']==row['newResult']and case['currentSourceRuntime']=='NOT_RUN'and not case['wholeCurrentCaseClaimedVerified']
 assert all(id in witnesses for id in case['originC1ApiWitnessIds'])
 for item in case['currentLocalExactAssertions']:
  assert sha(R/item['file'])==item['fileSha256']and any(a['status']=='passed'and a['fullName']==item['assertion']for a in suites[item['file']]['assertionResults'])
 if row['case_id']in ['UC-C18','UC-A51']:assert case['reviewResult']=='BLOCKED_APPROVED_REAL_LESSON_CONTENT_NOT_PROVIDED'
assert(R/'server/test/audit-workflow-roundtrip.test.ts').read_text(encoding='utf-8').count('"/missions/my"')==1
assert d['retiredTargetPolicy']['newAcceptanceReuseAllowed']is False and d['retiredTargetPolicy']['historicalResultsMayBeRelabeledCurrent']is False
assert read(R/d['retiredTargetPolicy']['file']['path'])['status']=='FOR_ACCEPTANCE_RETIRED_NOT_RESTORED'
assert d['retainedPristineRpc']['passedOriginalGlobalCases']==2 and d['retainedPristineRpc']['calls']==3 and not d['retainedPristineRpc']['rerun']
matches=d['migrationEvidence']['historicalForwardSourceComparison'];assert len(matches)==36 and collections.Counter(r['match']for r in matches)=={'raw-match':4,'canonical-LF-match-only':32}
for item in matches:
 p=R/item['path'];assert sha(p)==item['currentRawSha256']and hashlib.sha256(p.read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==item['currentCanonicalLfSha256']
 assert item['historicalReportedSha256']==(item['currentRawSha256']if item['match']=='raw-match'else item['currentCanonicalLfSha256'])
for item in m['schemaProfile']['fullMigrations']:assert sha(R/item['path'])==item['sha256']
probe=read(C/'node22-exact-path-probe.json');preflight=read(C/'node22-full-preflight-attempt1.json');assert probe['version']=='v22.23.4'and probe['exists']and not probe['networkOrInstall']
assert not preflight['resourceGatePassed']and not preflight['suiteStarted']and not(C/'node22-full-command.json').exists()
assert preflight['physicalFreeGiB']<preflight['requiredPhysicalAndCommitGiB']and preflight['commitHeadroomGiB']<preflight['requiredPhysicalAndCommitGiB']
model=read(C/'model-interface-attempt.json');assert not model['selectedModelObserved']and not model['modelIdInferred']and not model['modelSwitchPerformed']
print(json.dumps({'status':'PASS_OFFLINE107_FACET_RECONCILIATION_NOT_R1_ACCEPTANCE','sourceFingerprint':fp['fingerprint'],'cases':107,'R0':2,'R1':62,'GATE':14,'R2':29,'originalAuditAssertions':16,'protectedContracts':194,'originC1ApiWitnesses':17,'originC1PartialCaseFacets':32,'gapGroups':10,'newSourceRuntimeCases':0,'manifestChanged':False,'node22KnownVersion':'v22.23.4','node22Suite':'NOT_STARTED_RESOURCE_GATE','modelInterfaceSelection':'UNKNOWN','incidentOpen':True,'releaseHold':True,'providerEnabled':False}))
