"""Read-only verification of the completed approved696e scope. No services or credentials."""
from pathlib import Path
import json,csv,hashlib,subprocess,collections
R=Path(__file__).resolve().parents[2];V=R/'docs/verification';C=V/'adfocate-d19-b2-20261025-recovery-4d6ca2c8'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
fp=read(V/'code-fingerprint.json');m=read(R/fp['runtimeManifestPath']);N=C/m['execution']['artifactNamespace'];B=N/'browser';d=read(V/'D19-C1-continuation-delivery.json');root=read(V/'adfocate-delivery.json');g=read(V/'D19-C1-gates.json')
assert len(fp['files'])==782 and fp['fingerprint']==d['sourceFingerprint']==root['codeFingerprint']==g['sourceFingerprint']
assert hashlib.sha256(json.dumps(fp['files'],separators=(',',':')).encode()).hexdigest()==fp['fingerprint']
for f in fp['files']:assert hashlib.sha256((R/f['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
assert sha(R/fp['runtimeManifestPath'])=='696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d'
a=read(R/m['execution']['environment']['ADFOCATE_B2_AUTHORIZATION_PATH']);receipt=read(R/m['execution']['environment']['ADFOCATE_B2_TARGET_RECEIPT_PATH'])
assert a['approved']and a['manifestSha256']==d['manifest']['sha256']and a['sourceFingerprint']==fp['fingerprint']and 'call_4715f74b8ded413ea520b4491078088f'in a['ownerReference']
assert receipt['identity']['ownerAuthorization']==a['ownerReference']and receipt['sourceFingerprint']==fp['fingerprint']and receipt['bootstrap']['verified']
assert sha(R/receipt['bootstrap']['baselinePath'])==receipt['bootstrap']['baselineSha256']
assert sha(R/receipt['originVerifiedReceipt']['path'])==receipt['originVerifiedReceipt']['sha256']
assert m['fixture']==read(V/'D19-C1-source-revision-runtime-manifest.json')['fixture']
assert sha(V/'D19-C1-source-revision-runtime-manifest.json')=='a0f09af0a7bce75e6842a1d42042ac4471e757c184574d7e5dcf9a23fdc57989'
for item in m['schemaProfile']['fullMigrations']:assert sha(R/item['path'])==item['sha256']
for phase in ['role','core']:
 old=read(C/phase/'phase-result.json');new=read(N/phase/'phase-result.json')
 assert old['exitCode']==new['exitCode']==0 and new['apiCasesRerun']==0 and new['originalCaseCount']==(8 if phase=='role'else 9)
 assert new['lineage']['sourceFingerprint']==fp['fingerprint']and new['lineage']['executionNamespace']==m['execution']['artifactNamespace']
for phase in m['fixture']['phases']:
 for item in m['execution']['recovery']['references']['phases'][phase['phase']]['journals']:assert sha(R/item['path'])==item['sha256']
s=read(B/'browser-summary.json');assert s['status']==0 and s['passed']==5 and s['neutrality']['passed']
tests=[t for summary in s['summaries']for t in summary['tests']];assert len(tests)==5 and all(t['ok']and all(r['status']=='passed'for r in t['results'])for t in tests)
assert all(x['stats']['skipped']==x['stats']['unexpected']==x['stats']['flaky']==0 for x in s['summaries'])
assert read(C/'browser/phase-result.json')['exitCode']==1
recovery=read(B/'browser-recovery.json');assert recovery['inputRetained']and recovery['explicitRetry']and recovery['continuedFromExactDraft']and recovery['newSubjectsOrWorkflows']==0
empty=read(B/'denial-empty-ui.json')['data'];assert empty['reloadEmpty']and empty['savedWorkflowCount']==empty['newFixtureRows']==0
handoff=read(B/'handoff-ui.json')['data'];assert handoff['readbacks']==4 and handoff['allVisibleFieldsSame']and handoff['historyRetained']and handoff['oneSavedWorkflowReward']and handoff['creatorInternalIdHidden']
final=read(N/'final-readback-after-collection.json');assert final['authSubjects']==84 and final['workspaces']==final['missions']==6 and final['noNewRootIds']
assert final['wholeContinuationFinancialTotalsEqual']and final['catalogUnchanged']and final['seedRowHashesUnchanged']and final['serviceHistoryUnchanged']and final['legacyRowHashesUnchanged']and final['historicalInvalidLegacyRowHashUnchanged']
assert final['catalogSections']==8 and final['financialTotals']['historyCount']==72 and final['financialTotals']['faultFunctions']==final['financialTotals']['faultTriggers']==0
for p in final['phaseInventories']:
 assert p['families']==70 and p['allCapsPass']and p['allJournalsResolved']
 for name,cap in m['fixture']['rowCaps'][p['phase']].items():
  if name!='requests':assert p['inventory'][name]['count']<=cap
 assert p['addedSessions']<=m['execution']['recovery']['authRenewal']['maxSessionAdds'][p['phase']]
assert final['pending']['onePendingRow']and final['pending']['status']=='pending'and final['pending']['id']==handoff['pendingRewardId']==d['pending']['id']
n=read(B/'browser-neutrality.json');assert n['neutrality']['passed']and n['neutrality']['financialTableFamiliesCompared']==9 and n['neutrality']['legacyAnchorsEqual']
assert n['before']['snapshot']==n['after']['snapshot']and n['before']['legacyAnchors']==n['after']['legacyAnchors']
assert final['browserBefore']['snapshot']==final['browserAfter']['snapshot']and final['browserBefore']['legacyAnchors']==final['browserAfter']['legacyAnchors']
totals=final['financialTotals'];assert[totals[k]for k in ['budgets','points','withdrawable','xp','pointLedger','cashLedger','budgetLedger','inventoryRemaining']]==[26750,1300,250,300,2,2,2,9]
auth=read(N/'auth-session-audit.json');assert auth['existingActorsOnly']and auth['actionCounts']=={'login':7,'token_refreshed':1,'token_revoked':1}
collection=read(B/'creator-collection-after-handoff.json');assert collection['httpStatus']==200 and collection['joinedCollectionContainsExistingWork']and collection['workflowId']==final['pending']['workflowId']and collection['submissionId']==final['pending']['submissionId']and collection['authSignIns']==collection['newSubjectsOrFixtures']==0
for name in ['continuation-final-full.json','node22-npm-full.json']:
 report=read(C/name);assert report['success']and report['numPassedTests']==2082 and report['numFailedTests']==0 and report['numPendingTests']==363 and len(report['testResults'])==289
report=read(C/'node22-npm-full.json');paths={s['name'].replace('\\','/').split('/adfocate-r1-20261023/')[-1]:s for s in report['testResults']}
audits=[a for path,suite in paths.items()if path.startswith('src/audit-tests/')for a in suite['assertionResults']];assert len(audits)==16 and all(a['status']=='passed'for a in audits)
assert g['Node22']['status']=='PASS_LOCAL_CURRENT_SOURCE'and g['Node22']['originalAudit16']['passed']==16 and g['Node22']['protected194']['passed']==194
for mode in ['full','cli','type','lint','build','esm','manifest']:
 r=read(C/f'node22-npm-{mode}-command.json');assert r['exit']==0 and r['nodeVersion']=='v22.23.4'and r['sourceFingerprint']==fp['fingerprint']and r['npmExecpathProvided']and not r['actualC1TargetUsed']and not r['packageDownloadOrInstall']
assert read(C/'node22-full.json')['numFailedTests']==2
coverage=read(V/'D19-C1-continuation-case-coverage.json');assert len(coverage['cases'])==107 and coverage['currentBrowser']['passed']==5 and not coverage['currentR1Verified']
for item in coverage['inputs']:assert sha(R/item['path'])==item['sha256'],('Current coverage input checksum mismatch',item['path'])
carried=[x for x in coverage['cases']if x.get('reviewResult')=='CARRIED_ORIGIN_API_FACET_REVALIDATED_FULL_CASE_REVIEW_OPEN']
assert len(carried)==17 and all(x.get('originC1ApiWitnessIds')and x['currentSourceRuntime']=='ORIGIN_API_DEPENDENCIES_REVALIDATED_NO_API_RERUN'and not x['wholeCurrentCaseClaimedVerified']for x in carried),'Current coverage must distinguish carried/revalidated API facets from unrun full-case acceptance'
assert all(x['reviewResult']!='ORIGIN_C1_PARTIAL_API_WITNESS_CURRENT_RUNTIME_NOT_RUN'for x in coverage['cases'])
resolved={x['id']:x for x in coverage['gaps']if x['status'].startswith('RESOLVED_')};assert set(resolved)=={'CURRENT-BROWSER-HANDOFF','POST-JOIN-COLLECTION'}
assert all('Await the already-pending'not in x['next']for x in resolved.values()),'Resolved scopes must not still request the completed approval'
assert 'new source runtime NOT_RUN'not in read(V/'D19-C1-integrity.json')['method'],'Current evidence seal must describe the completed approved runtime scope'
for x,y in zip(rows(C/'continuation-before/audit_case_coverage.csv'),rows(V/'audit_case_coverage.csv')):
 assert all(x[k]==y[k]for k in x if k not in {'newResult','codeStatus','testStatus','deploymentStatus','runtimeStatus','newEvidence','limitations'})
 if x['case_id']in ['UC-C18','UC-A51']:assert x==y
assert len(rows(V/'finding_traceability.csv'))==28 and sha(V/'finding_traceability.csv')==sha(C/'continuation-before/finding_traceability.csv')
assert root['D19C1ContinuationRuntime']==d and root['financialNeutrality']['allEqual']and not d['wholeR1Verified']and d['scopeVerified']
assert d['incidentOpen']and d['releaseHold']and not d['restored']and not d['providerEnabled']and d['D15ContentBlocked']and d['advisorOwnerDeviceHostedFormalStaffBlocked']
assert not any(d[k]for k in ['productionDataOrMembershipWrites','push','merge','deploy'])and d['commit']is None
assert not root['finalDeliveryReview']['canDeploy']and not root['finalDeliveryReview']['canEnablePilot']
for item in read(V/'D19-C1-rollback.json')['metadataFiles']:assert sha(R/item['path'])==item['afterSha256']and sha(R/item['beforeCopy'])==item['beforeSha256']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()==fp['headSha']and not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=R,text=True).strip()
for name in ['D19-C1-integrity.json','evidence-integrity.json']:
 seal=read(V/name);assert seal['codeFingerprint']==fp['fingerprint']
 for f in seal['files']:assert sha(R/f['path'])==f['sha256']and(R/f['path']).stat().st_size==f['bytes'],f['path']
assert{p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}=={f['path']for f in read(V/'evidence-integrity.json')['files']}
assert root['evidenceIntegrity']['records']==len(read(V/'evidence-integrity.json')['files'])
print(json.dumps({'status':'PASS_APPROVED696E_SCOPE_AND_CURRENT_DELIVERY_NOT_WHOLE_R1','sourceFingerprint':fp['fingerprint'],'browserPassed':5,'apiCasesCarried':17,'apiReruns':0,'Node22Passed':2082,'Node24Passed':2082,'gatedSkipEach':363,'original16':16,'protected194':194,'wholeContinuationFinancialNeutrality':True,'onePendingBinding':True,'authSubjects':84,'newRootsOrResources':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False}))
