"""File-only evidence checks. No network, client, engine, git or runtime construction."""
from pathlib import Path
import csv, hashlib, json, sys

R = Path(__file__).resolve().parents[3]
V = R / 'docs/verification'
P = Path(__file__).resolve().parent
SOURCE = 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
C2 = 'eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
preseal = len(sys.argv) == 2 and sys.argv[1] == '--preseal'
assert len(sys.argv) == 1 or preseal

def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def js_hash(obj): return hashlib.sha256(json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
def rows(p):
    with Path(p).open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))
def check_ref(record):
    assert sha(R / record['path']) == record['sha256'], 'Stale reference: ' + record['path']

checkpoint = read(P / 'checkpoint.json')
before = {x['path']: x for x in checkpoint['files']}
for record in before.values(): assert sha(R / record['before']) == record['sha256']
for path in ['docs/verification/code-fingerprint.json', 'docs/verification/D19-C2-application-runtime-manifest.json', 'docs/verification/D19-application-runtime-preparation-20261025/runtime-authorization.json']:
    assert sha(R / path) == before[path]['sha256'], path
assert sha(V / 'D19-C2-application-runtime-manifest.json') == C2
assert read(V / 'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved'] is False
source = read(V / 'code-fingerprint.json')
assert source['fingerprint'] == checkpoint['sourceFingerprint'] == SOURCE
assert len(source['files']) == 788
for record in source['files']:
    assert hashlib.sha256((R / record['path']).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == record['sha256'], record['path']
migrations = [record for record in source['files'] if record['path'].startswith('supabase/migrations/') and record['path'].endswith('.sql')]
assert len(migrations) == 73
test = read(P / 'memory-readback-final-command.json')
lint = read(P / 'lint-readback-final-command.json')
assert test['exit'] == lint['exit'] == 0
assert test['nativeCounts'] == {'tests': 7, 'pass': 7, 'fail': 0, 'skipped': 0}
assert test['nodeVersion'] == lint['nodeVersion'] == 'v22.23.4'
for command in [test, lint]:
    assert command['sourceFingerprint'] == SOURCE and command['sourceFilesUnchanged'] == 788
    assert command['endedAt'] > command['startedAt']
    assert command['nodePreloadsAndCredentialsStripped'] is True
    assert command['physicalTargetsOrClients'] == command['realAuthSubjectsOrFixtures'] == 0
    assert command['resource']['minimumGiB'] == 3
    assert min(command['resource']['freePhysicalGiB'], command['resource']['freeCommitGiB']) >= 3
    for record in command['verificationArtifactSources']: check_ref(record)
    assert js_hash(command['verificationArtifactSources']) == command['verificationArtifactFingerprint']
assert test['verificationArtifactSources'] == lint['verificationArtifactSources']
tap = (P / 'memory-readback-final.log').read_text(encoding='utf-8')
for line in ['1..7', '# tests 7', '# pass 7', '# fail 0', '# skipped 0']: assert line in tap.splitlines()
assert '--test' in test['command'] and '--test-concurrency=1' in test['command']
profile = read(P / 'sql-profile.json')
assert len(profile['sources']) == 7 and len(profile['statements']) == 23
for record in profile['sources']: check_ref(record)
assert profile['includesFullMigrationReplay'] is False
assert profile['includesAuthRlsOrIndependentConnectionConcurrency'] is False
assert js_hash({k: v for k, v in profile.items() if k != 'profileDigest'}) == profile['profileDigest']
engine = read(P / 'memory-readback-final-engine-result.json')
assert sha(P / 'engine-result.json') == sha(P / 'memory-readback-final-engine-result.json')
assert engine['target']['locator'] == 'memory://'
assert engine['target']['persistent'] is engine['target']['externalNetwork'] is False
assert engine['enginesCreated'] == engine['enginesClosed'] == 7
assert engine['networkAttempts'] == engine['externalClientsOrTargets'] == engine['externalAuthSubjectsOrFixtures'] == engine['applicationSourceChanges'] == engine['realPaymentsOrPendingRewards'] == 0
assert engine['callsUseSeparateAutocommitStatements'] is True
assert engine['profileDigest'] == profile['profileDigest']
assert engine['tableFamiliesCompared'] == 9 and len(engine['caseEvidence']) == 7
families = {'creators', 'missions', 'mission_submissions', 'point_balances', 'point_transactions', 'earnings_balances', 'earnings_transactions', 'workspace_budgets', 'workspace_budget_transactions'}
base = {'xp': 35, 'points': 0, 'cash': 0, 'budget': 500, 'pointLedgerRows': 0, 'cashLedgerRows': 0, 'budgetLedgerRows': 0}
cash = {'xp': 185, 'points': 250, 'cash': 47.25, 'budget': 452.75, 'pointLedgerRows': 1, 'cashLedgerRows': 1, 'budgetLedgerRows': 1}
nocash = {'xp': 135, 'points': 250, 'cash': 0, 'budget': 500, 'pointLedgerRows': 1, 'cashLedgerRows': 0, 'budgetLedgerRows': 0}
for case in engine['caseEvidence']:
    assert case['outcome'] == 'passed-local-memory-only'
    for key, data in case['readbacks'].items():
        assert set(data) == families
        assert js_hash(data) == case['stateSha256'][key]
        values = {'xp': data['creators'][0]['xp'], 'points': data['point_balances'][0]['balance'], 'cash': float(data['earnings_balances'][0]['available']), 'budget': float(data['workspace_budgets'][0]['balance']), 'pointLedgerRows': len(data['point_transactions']), 'cashLedgerRows': len(data['earnings_transactions']), 'budgetLedgerRows': len(data['workspace_budget_transactions'])}
        assert values == case['values'][key]
    hashes = case['stateSha256']
    if 'afterFailure' in hashes: assert hashes['before'] == hashes['afterFailure']
    if 'afterRecovery' in hashes:
        assert hashes['afterRecovery'] == hashes['afterRetry']
        assert case['values']['afterRecovery'] == cash
    if 'afterRetry' in hashes and 'afterFirst' in hashes: assert hashes['afterFirst'] == hashes['afterRetry']
    if 'afterChangedRetry' in hashes: assert hashes['afterFirst'] == hashes['afterChangedRetry']
first, budget, late, xp, invalid, plain, acl = engine['caseEvidence']
assert first['name'] == 'committed-exact-and-changed-payload-retry'
assert first['values']['before'] == base and first['values']['afterFirst'] == cash
assert first['detail']['concurrentConnectionsTested'] is False
saved = first['detail']['firstSavedSubmission']
assert saved['status'] == 'approved' and saved['quality_rating'] == 5 and saved['evidence_revision'] == 1
assert saved['reviewer_notes'] == 'Synthetic saved legacy operator note'
assert saved['xp_awarded'] == 185 and saved['points_awarded'] == 250
assert first['readbacks']['afterFirst']['mission_submissions'][0] == saved
assert budget['values']['before'] == {**base, 'budget': 20}
assert budget['detail']['productionFundingWorkflowTested'] is False
assert late['name'] == 'late-cash-ledger-fault-rollback' and late['values']['before'] == base
assert xp['name'] == 'final-xp-fault-rollback' and xp['values']['before'] == base
assert invalid['detail']['notAnIncidentBeforeImage'] is True and invalid['detail']['originalDataRestored'] is False
assert invalid['values']['afterFailure'] == base
assert plain['values']['afterFirst'] == nocash and plain['values']['afterRetry'] == nocash
assert acl['detail']['deniedRoles'] == ['anon', 'authenticated'] and acl['detail']['permittedRole'] == 'service_role'
assert acl['detail']['realAuthOrMembershipTested'] is False and acl['values']['afterServiceCall'] == cash
summary = read(P / 'readback-summary.json')
assert summary['cases'] == [{k: v for k, v in case.items() if k != 'readbacks'} for case in engine['caseEvidence']]
check_ref(summary['fullSnapshots'])
cases, old_cases = rows(V / 'audit_case_coverage.csv'), rows(R / before['docs/verification/audit_case_coverage.csv']['before'])
assert len(cases) == len(old_cases) == 107
changed = []
mutable = {'newResult', 'testStatus', 'runtimeStatus', 'newEvidence', 'limitations'}
for old, current in zip(old_cases, cases):
    assert old['case_id'] == current['case_id']
    assert all(old[key] == current[key] for key in old if key not in mutable)
    if old != current: changed.append(current['case_id'])
    if current['case_id'] in ['UC-C18', 'UC-A51']: assert old == current
assert changed == ['UC-A11']
assert 'FULL_CASE_NOT_VERIFIED' in next(c for c in cases if c['case_id'] == 'UC-A11')['newResult']
old_tasks, tasks = rows(R / before['docs/verification/implementation_backlog.csv']['before']), rows(V / 'implementation_backlog.csv')
assert len(old_tasks) == len(tasks) == 20
for old, current in zip(old_tasks, tasks):
    assert old['task_id'] == current['task_id']
    assert all(old[key] == current[key] for key in old if key not in {'newResult', 'testStatus', 'runtimeStatus', 'evidence'})
    if current['task_id'] != 'D19': assert old == current
assert (V / 'adfocate-task-ledger.md').read_bytes().startswith((R / before['docs/verification/adfocate-task-ledger.md']['before']).read_bytes())
main, original = read(V / 'adfocate-delivery.json'), read(R / before['docs/verification/adfocate-delivery.json']['before'])
assert main['D15'] == original['D15']
assert main['D19ApplicationSupplementPreparation'] == original['D19ApplicationSupplementPreparation']
assert main['D19R1FacetReview'] == original['D19R1FacetReview']
assert main['executionModel'] == original['executionModel']
assert main['financialNeutrality'] == original['financialNeutrality']
assert main['caseResults'] == cases
assert main['currentRecordAuthority']['currentRuntimeSource'] is None
assert main['currentCandidateVerificationScope'] == original['currentCandidateVerificationScope']
assert main['currentCandidateVerificationScope']['wholeR1Verified'] is False
assert main['finalDeliveryReview']['canDeploy'] is main['finalDeliveryReview']['canEnablePilot'] is False
native = read(V / 'D19-application-runtime-preparation-20261025/supplement-full-final.json')
assert native['numPassedTests'] == 2129 and native['numFailedTests'] == 0 and native['numPendingTests'] == 363
assert main['currentToolchainVerification']['Node24CurrentFull'] == 'NOT_RUN'
delivery = read(P / 'delivery.json')
assert main['D19LegacyMemorySqlVerification'] == delivery
assert delivery['sourceFingerprint'] == SOURCE and delivery['verificationArtifactFingerprint'] == test['verificationArtifactFingerprint']
for key in ['gates', 'readbacks', 'schema', 'caseCoverage', 'remaining', 'rollback', 'c2Manifest', 'priorCurrentDelivery', 'priorSnapshotCheckpoint', 'modelInterfaceObservation']: check_ref(delivery[key])
for field in ['actualTargetCalls', 'externalClients', 'realAuthSubjectsOrDomainFixtures', 'formalMembershipOrRoleWrites', 'productionWrites', 'providerCalls']: assert delivery[field] == 0
assert delivery['releaseHold'] is True and delivery['providerEnabled'] is False
assert delivery['wholeR1Verified'] is False and delivery['originalIncident'] == 'OPEN_UNRESTORED'
assert delivery['commit'] is None and delivery['push'] is delivery['merge'] is False and delivery['deployment'] == 'NOT_DEPLOYED'
coverage = read(P / 'case-coverage.json')
assert coverage['cases'] == cases and coverage['wholeCurrentCaseAcceptedByThisTurn'] == []
assert coverage['newResultRowsChangedThisTurn'] == ['UC-A11'] and coverage['gate14RequiredWithoutWaiver'] == 14
for key in ['legacyMemoryEvidence', 'remainingAcceptance']: check_ref(coverage[key])
gates = read(P / 'gates.json')
for record in [gates['nativeFullRetained']['evidence'], gates['memorySql']['receipt'], gates['memorySql']['log'], gates['memorySql']['engine'], gates['targetedLint']['receipt'], gates['targetedLint']['log'], gates['profile'], gates['initialPassPreserved'], gates['initialLintPreserved']]: check_ref(record)
assert gates['memorySql']['pglite'] == read(R / 'node_modules/@electric-sql/pglite/package.json')['version']
remaining = read(P / 'remaining-acceptance.json')
legacy = next(g for g in remaining['remainingCaseGroups'] if g['id'] == 'LEGACY-APPROVAL-REPLAY')
check_ref(legacy['memoryEvidence']); check_ref(legacy['readbackEvidence'])
assert remaining['wholeR1Verified'] is False
assert not any(x.startswith('Execution-interface') for x in remaining['blockers'])
assert any('D15' in x for x in remaining['blockers']) and any('advisor' in x for x in remaining['blockers']) and any('Formal staff' in x for x in remaining['blockers'])
old_index = read(R / before['docs/verification/evidence-integrity.json']['before'])
assert len(old_index['files']) == 2114
for record in old_index['files']:
    path = R / (before[record['path']]['before'] if record['path'] in before else record['path'])
    assert sha(path) == record['sha256'], 'Prior evidence changed: ' + record['path']
for revision in (P / 'source-revisions').iterdir():
    manifest = read(revision / 'manifest.json')
    if isinstance(manifest, list):
        records, fingerprint = manifest, js_hash(manifest)
    else:
        fingerprint = manifest.get('artifactFingerprint', manifest.get('verificationArtifactFingerprint'))
        records = manifest.get('files', manifest.get('sources'))
        if records is None: records = manifest.get('verificationArtifactSources')
    assert fingerprint == revision.name
    assert js_hash(records) == fingerprint
    for record in records: assert sha(revision / Path(record['path']).name) == record['sha256']
git = read(P / 'git-final.json')
assert git['head'] == checkpoint['head'] == '7cfa3dc84c821719a4dff754229a591c81786c53'
assert git['branch'] == checkpoint['branch'] == 'codex/adfocate-r1-pilot-20261023'
assert git['remote'] == 'https://github.com/YNWAforever/Remix-Adfocate.git'
assert git['stagedPaths'] == [] and git['diffCheck']['exit'] == 0
for path in [p for p in P.rglob('*') if p.is_file()]:
    assert bytes([123,123,80,65,83,83,87,79,82,68,95]) not in path.read_bytes(), 'Display redaction token copied: ' + str(path)
if not preseal:
    for name in ['D19-legacy-sql-memory-integrity.json', 'evidence-integrity.json']:
        index = read(V / name)
        assert index['codeFingerprint'] == SOURCE
        for record in index['files']:
            check_ref(record)
            assert (R / record['path']).stat().st_size == record['bytes']
    index = read(V / 'evidence-integrity.json')
    assert len(index['files']) == main['evidenceIntegrity']['records']
    assert {r['path'] for r in index['files']} == {p.relative_to(R).as_posix() for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json'}
    final_summary = read(P / 'verification-summary.json')
    assert final_summary['preseal']['exit'] == 0 and final_summary['checkerSha256'] == sha(Path(__file__))
    if 'finalVerification' in final_summary:
        assert final_summary['finalVerification']['exit'] == 0
        assert final_summary['finalVerification']['result']['currentEvidenceRecords'] == len(index['files'])
print(json.dumps({'status': 'PASS_LOCAL_MEMORY_ASSERTIONS_SEAL_PENDING' if preseal else 'PASS_LEGACY_MEMORY_SQL_EVIDENCE_NOT_REAL_ACCEPTANCE', 'sourceFingerprint': SOURCE, 'sourceRecordsUnchanged': 788, 'sqlSourcesUnchanged': 73, 'standaloneMemoryTests': {'passed': 7, 'failed': 0, 'skipped': 0}, 'enginesCreatedAndClosed': 7, 'externalNetworkAttempts': 0, 'comparedDataFamilies': 9, 'casesWithNewEvidence': ['UC-A11'], 'originalAuditCasesPreserved': 107, 'D15RowsUnchanged': ['UC-C18', 'UC-A51'], 'priorEvidenceRecordsPreserved': len(old_index['files']), 'currentEvidenceRecords': None if preseal else len(index['files']), 'c2SourceManifestApprovalUnchanged': True, 'c2ApprovalPending': True, 'nativeFullRerun': False, 'nativeFullRetained': {'passed': 2129, 'failed': 0, 'skipped': 363}, 'actualTargetCalls': 0, 'originalIncident': 'OPEN_UNRESTORED', 'releaseHold': True, 'providerEnabled': False, 'wholeR1Verified': False}))
