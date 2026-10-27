"""Read exact local evidence only. No runtime module/client/engine/network import."""
from pathlib import Path
import csv, hashlib, json, re, sys

R = Path(__file__).resolve().parents[3]
V = R / 'docs/verification'
P = Path(__file__).resolve().parent
SOURCE = 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
C2 = 'eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def lfsha(p): return hashlib.sha256(Path(p).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest()
def rel(p): return Path(p).relative_to(R).as_posix()
def ref(p): return {'path': rel(p), 'sha256': sha(p)}
def check_ref(record): assert sha(R / record['path']) == record['sha256'], record['path']
def rows(p):
    with Path(p).open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))

def inspect():
    source = read(V / 'code-fingerprint.json')
    assert source['fingerprint'] == SOURCE and len(source['files']) == 788
    for item in source['files']: assert lfsha(R / item['path']) == item['sha256'], item['path']
    c1 = read(V / 'D19-C1-source-revision-runtime-manifest.json')
    approved72 = c1['schemaProfile']['fullMigrations']
    assert len(approved72) == 72 and len({m['path'] for m in approved72}) == 72
    for m in approved72: assert sha(R / m['path']) == m['sha256'], m['path']
    shaped = read(V / 'shaped-replay.json')
    assert len(shaped['migrations']) == 36
    for m in shaped['migrations']: assert lfsha(R / m['path']) == m['sha256'], m['path']
    protected = read(R / 'supabase/release-manifest.json')
    assert len(protected['migrations']) == 43
    for m in protected['migrations']: assert lfsha(R / m['path']) == m['sha256'], m['path']
    pending = read(V / 'pending-forward-replay.json')
    assert len(pending['targets']) == 2
    for target in pending['targets']:
        assert target['pendingOnSecondPass'] == []
        assert len(target['applied']) == 1
        for m in target['applied']: assert lfsha(R / m['path']) == m['sha256']
    empty = read(V / 'empty-replay.json')
    assert len(empty['migrations']) == 66
    assert sha(V / 'D19-C2-application-runtime-manifest.json') == C2
    manifest = read(V / 'D19-C2-application-runtime-manifest.json')
    assert manifest['supplement']['runtimeApproved'] is manifest['canExecute'] is False
    assert read(V / 'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved'] is False
    schema = manifest['supplement']['schema']
    assert schema['baselineMigrationCount'] == 72 and schema['forwardOnly'] is True
    check_ref({'path': schema['file'], 'sha256': schema['sha256']})
    assert schema['file'] not in {m['path'] for m in approved72}
    assert {m['path'] for m in approved72} | {schema['file']} == {m['path'] for m in source['files'] if m['path'].startswith('supabase/migrations/') and m['path'].endswith('.sql')}
    check_ref(manifest['supplement']['originFinalReadback'])
    final = read(R / manifest['supplement']['originFinalReadback']['path'])
    assert len(final['phaseInventories']) == 3
    cohorts = {}
    for phase in final['phaseInventories']:
        assert phase['families'] == len(phase['inventory']) == 70
        for family, inventory in phase['inventory'].items():
            assert inventory['count'] == len(inventory['ids']) == len(set(inventory['ids']))
            assert set(inventory['ids']) == set(inventory['rowHashes'])
            assert all(re.fullmatch('[a-f0-9]{32}', digest) for digest in inventory['rowHashes'].values())
            cohort = cohorts.setdefault(family, {})
            for item, digest in inventory['rowHashes'].items():
                assert item not in cohort or cohort[item] == digest
                cohort[item] = digest
    counts = {family: len(cohort) for family, cohort in sorted(cohorts.items())}
    assert counts['mission_submissions'] == 7 and counts['mission_workflows'] == 4
    assert counts['mission_publication_proof_attempts'] == counts['mission_publication_proof_reviews'] == 6
    assert counts['mission_pending_rewards'] == 4
    assert counts['point_transactions'] == counts['earnings_transactions'] == counts['workspace_budget_transactions'] == 2
    assert counts['mission_publication_proof_assets'] == counts['mission_draft_assets'] == counts['storage_objects'] == 0
    runner = R / 'scripts/audit/execute-application-supplement.mjs'
    script = runner.read_text(encoding='utf-8')
    ordered = ['provenance: async () => {', 'oldRows = jsonSql(originalQuery);', 'save("before.json"', 'migrate: async () => {', 'assert.deepEqual(jsonSql(originalQuery), oldRows);', 'save("migration.json"', 'createClient: async () => {']
    positions = [script.index(token) for token in ordered]
    assert positions == sorted(positions)
    assert 'assertFinancialRowsUnchanged(financial, jsonSql(financialSql))' in script
    assert 'current.functions = current.functions.filter' in script and 'current.history = current.history.filter' in script
    assert 'assert.deepEqual(current, r.originalCatalog.observed' in script
    assert 'assertImmutable();' in script
    financial = json.loads(re.search(r'const financialTables = (\[[^;]+\]);', script).group(1))
    assert len(financial) == 9
    native_path = V / 'D19-application-runtime-preparation-20261025/supplement-full-final.json'
    native = read(native_path)
    assert native['numPassedTests'] == 2129 and native['numFailedTests'] == 0 and native['numPendingTests'] == 363
    focus = {'scripts/release/rehearsal.test.ts': 9, 'server/test/audit-schema-compatibility.test.ts': 2, 'server/test/audit-forward-migrations.embedded.test.ts': 11, 'server/test/application-supplement.test.ts': 26}
    witnesses = []
    for file in native['testResults']:
        key = Path(file['name']).relative_to(R).as_posix()
        if key not in focus: continue
        assert len(file['assertionResults']) == focus[key]
        assert all(a['status'] == 'passed' for a in file['assertionResults'])
        witnesses.append({'path': key, 'assertions': [{'title': a.get('fullName', a['title']), 'status': a['status']} for a in file['assertionResults']]})
    assert {w['path'] for w in witnesses} == set(focus)
    refs = [V / 'code-fingerprint.json', V / 'D19-C1-source-revision-runtime-manifest.json', V / 'D19-C1-browser-continuation-runtime-manifest.json', V / 'shaped-replay.json', V / 'empty-replay.json', V / 'pending-forward-replay.json', V / 'D19-C1-continuation-schema.json', R / manifest['supplement']['originFinalReadback']['path'], V / 'D19-C2-application-runtime-manifest.json', V / 'D19-application-runtime-preparation-20261025/runtime-authorization.json', R / 'scripts/audit/apply-shaped-manifest.mjs', runner, R / 'scripts/audit/application-supplement.mjs', R / 'scripts/audit/b2-bootstrap-profile.mjs', R / 'scripts/audit/b2-fixture-inventory.mjs', R / 'supabase/release-manifest.json', R / schema['file'], native_path]
    return {'sourceFingerprint': SOURCE, 'sourceFilesUnchanged': 788, 'sourceSqlFiles': 73, 'historicalC1RawMigrationMatches': approved72, 'historicalC1RawMigrationMatchCount': 72, 'protectedManifestLfMatches': [{'path': m['path'], 'sha256': m['sha256']} for m in protected['migrations']], 'protectedManifestLfMatchCount': 43, 'shapedLfMatches': [{'path': m['path'], 'sha256': m['sha256']} for m in shaped['migrations']], 'shapedLfMatchCount': 36, 'historicalEmptyFileCount': 66, 'historicalShapedOldHistoryCount': len(shaped['oldHistoryPreserved']), 'historicalAdditionalNoteMigrationTargets': 2, 'originalC1PhaseCount': 3, 'originalC1FamilyCountPerPhase': 70, 'originalC1UniqueRowCounts': counts, 'originalC1RowHashAlgorithm': 'PostgreSQL MD5 of serialized row, sealed by artifact SHA256; counts are historical file evidence, not live state', 'originalC1CohortDigest': hashlib.sha256(json.dumps(cohorts, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'plannedForwardMigration': schema, 'plannedFinancialFamilies': financial, 'plannedBeforeClientChecks': ordered, 'retainedNativeWitnesses': witnesses, 'retainedNativeAssertionCount': sum(focus.values()), 'references': [ref(p) for p in refs], 'c2ManifestSha256': C2, 'c2RuntimeApproved': False, 'c2RuntimeExecuted': False, 'actualTargetCalls': 0, 'databaseEnginesCreated': 0, 'newApplicationOrMemoryTestRuns': 0}

def verify():
    facts = inspect()
    assert read(P / 'migration-provenance.json') == facts
    checkpoint = read(P / 'checkpoint.json')
    before = {r['path']: r for r in checkpoint['files']}
    for record in before.values(): assert sha(R / record['before']) == record['sha256']
    for path in ['docs/verification/code-fingerprint.json', 'docs/verification/D19-C2-application-runtime-manifest.json', 'docs/verification/D19-application-runtime-preparation-20261025/runtime-authorization.json']:
        assert sha(R / path) == before[path]['sha256']
    cases, old_cases = rows(V / 'audit_case_coverage.csv'), rows(R / before['docs/verification/audit_case_coverage.csv']['before'])
    assert len(cases) == len(old_cases) == 107
    changed = []
    for current, old in zip(cases, old_cases):
        assert all(current[k] == old[k] for k in old if k not in {'newResult', 'testStatus', 'runtimeStatus', 'newEvidence', 'limitations'})
        if current != old: changed.append(current['case_id'])
        if current['case_id'] in ['UC-C18', 'UC-A51', 'UC-A11']: assert current == old
    assert changed == ['UC-R04']
    assert 'FULL_CASE_NOT_VERIFIED' in next(c for c in cases if c['case_id'] == 'UC-R04')['newResult']
    tasks, old_tasks = rows(V / 'implementation_backlog.csv'), rows(R / before['docs/verification/implementation_backlog.csv']['before'])
    for current, old in zip(tasks, old_tasks):
        assert all(current[k] == old[k] for k in old if k not in {'newResult', 'testStatus', 'runtimeStatus', 'evidence'})
        if current['task_id'] not in ['D02', 'D19']: assert current == old
    main, original = read(V / 'adfocate-delivery.json'), read(R / before['docs/verification/adfocate-delivery.json']['before'])
    for key in ['D15', 'D19ApplicationSupplementPreparation', 'D19R1FacetReview', 'D19LegacyMemorySqlVerification', 'executionModel', 'financialNeutrality', 'currentCandidateVerificationScope']:
        assert main[key] == original[key], key
    assert main['caseResults'] == cases and main['currentRecordAuthority']['currentRuntimeSource'] is None
    assert main['currentToolchainVerification'] == original['currentToolchainVerification']
    review = read(P / 'review.json')
    assert review['wholeCurrentCaseVerified'] is False and review['wholeR1Verified'] is False
    assert review['facts'] == ref(P / 'migration-provenance.json')
    assert review['plannedC2MigrationPreservation']['status'] == 'STATIC_SOURCE_CHECKS_EXIST_RUNTIME_NOT_RUN'
    assert review['historicalShapedScope']['directCheckedRowFields'] == ['status', 'content_urls[0]']
    assert review['historicalShapedScope']['fullBeforeAfterRowSnapshotSaved'] is False
    assert review['historicalShapedScope']['existingProofLedgerPreservationProven'] is False
    remaining = read(P / 'remaining-acceptance.json')
    group = next(g for g in remaining['remainingCaseGroups'] if g['id'] == 'NONEMPTY-MIGRATION-SCOPE')
    assert '73' in group['pendingManifestCovers'] and group['newTargetRequestedByThisReview'] is False
    assert group['currentRuntimeVerified'] is False
    delivery = read(P / 'delivery.json')
    assert main['D19MigrationPreservationReview'] == delivery
    for key in ['review', 'facts', 'remaining', 'caseCoverage', 'rollback', 'c2Manifest', 'priorDelivery']: check_ref(delivery[key])
    assert delivery['actualTargetCalls'] == delivery['newTestRuns'] == delivery['databaseEnginesCreated'] == 0
    assert delivery['newTargetsRequestedOrApproved'] == delivery['formalMembershipOrRoleWrites'] == delivery['productionWrites'] == delivery['providerCalls'] == 0
    assert delivery['releaseHold'] is True and delivery['providerEnabled'] is False and delivery['wholeR1Verified'] is False
    assert delivery['incidentOpen'] is True and delivery['restored'] is False
    assert delivery['deployment'] == 'NOT_DEPLOYED' and delivery['commit'] is None
    assert delivery['push'] is delivery['merge'] is False
    red, green = read(P / 'scope-red.json'), read(P / 'scope-green.json')
    assert red['exit'] == 1 and green['exit'] == 0
    assert len(json.loads(red['stdout'])['issues']) == 2 and json.loads(green['stdout'])['issues'] == []
    assert red['productTestFailure'] is green['productTestRun'] is False
    old_index = read(R / before['docs/verification/evidence-integrity.json']['before'])
    assert len(old_index['files']) == 2171
    for item in old_index['files']:
        p = R / (before[item['path']]['before'] if item['path'] in before else item['path'])
        assert sha(p) == item['sha256'], 'Prior evidence changed: ' + item['path']
    assert (V / 'adfocate-task-ledger.md').read_bytes().startswith((R / before['docs/verification/adfocate-task-ledger.md']['before']).read_bytes())
    git = read(P / 'git-final.json')
    assert git['head'] == checkpoint['head'] == '7cfa3dc84c821719a4dff754229a591c81786c53'
    assert git['branch'] == checkpoint['branch'] == 'codex/adfocate-r1-pilot-20261023'
    assert git['remote'] == 'https://github.com/YNWAforever/Remix-Adfocate.git'
    assert git['stagedPaths'] == [] and git['diffCheckExit'] == 0
    for p in P.rglob('*'):
        if p.is_file(): assert bytes([123,123,80,65,83,83,87,79,82,68,95]) not in p.read_bytes()
    preseal = len(sys.argv) == 2 and sys.argv[1] == '--preseal'
    if not preseal:
        for name in ['D19-migration-preservation-integrity.json', 'evidence-integrity.json']:
            index = read(V / name)
            assert index['codeFingerprint'] == SOURCE
            for item in index['files']:
                check_ref(item); assert (R / item['path']).stat().st_size == item['bytes']
        index = read(V / 'evidence-integrity.json')
        assert {x['path'] for x in index['files']} == {p.relative_to(R).as_posix() for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json'}
        assert len(index['files']) == main['evidenceIntegrity']['records']
        receipt = read(P / 'verification-summary.json')
        assert receipt['preseal']['exit'] == 0 and receipt['checkerSha256'] == sha(Path(__file__))
        if 'final' in receipt: assert receipt['final']['exit'] == 0 and receipt['final']['result']['currentEvidenceRecords'] == len(index['files'])
    return {'status': 'PASS_LOCAL_MIGRATION_SCOPE_REVIEW_SEAL_PENDING' if preseal else 'PASS_LOCAL_MIGRATION_SCOPE_REVIEW_NOT_RUNTIME_ACCEPTANCE', 'sourceFingerprint': SOURCE, 'sourceFilesUnchanged': 788, 'sourceMigrations': 73, 'historicalRaw72Match': 72, 'protectedLf43Match': 43, 'historicalShapedLf36Match': 36, 'originalC1HistoricalRows': {k: facts['originalC1UniqueRowCounts'][k] for k in ['mission_submissions', 'mission_workflows', 'mission_pending_rewards', 'mission_publication_proof_attempts', 'point_transactions', 'earnings_transactions', 'workspace_budget_transactions', 'storage_objects']}, 'correctedNewResultCase': 'UC-R04', 'originalCasesPreserved': 107, 'D15AndLegacyMemoryRowsUnchanged': True, 'priorEvidenceRecordsPreserved': len(old_index['files']), 'currentEvidenceRecords': None if preseal else len(index['files']), 'newTargetsRequiredOrAuthorizedByThisReview': 0, 'c2SourceManifestApprovalUnchanged': True, 'c2ApprovalPending': True, 'actualTargetCalls': 0, 'newTestRuns': 0, 'incidentOpen': True, 'releaseHold': True, 'providerEnabled': False, 'wholeR1Verified': False}

if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--claims':
        main = read(V / 'adfocate-delivery.json')
        current = read(R / main['currentRecordAuthority']['currentSummary'])
        remaining = read(R / current['remaining']['path'])
        group = next(g for g in remaining['remainingCaseGroups'] if g['id'] == 'NONEMPTY-MIGRATION-SCOPE')
        row = next(c for c in rows(V / 'audit_case_coverage.csv') if c['case_id'] == 'UC-R04')
        missing = []
        if '73' not in group['pendingManifestCovers']: missing.append('Pending C2 forward73 nonempty-preservation checks are not reconciled in the current remaining list')
        if 'FULL_CASE_NOT_VERIFIED' not in row['newResult']: missing.append('UC-R04 lacks an explicit whole-current-case unverified label')
        print(json.dumps({'status': 'FAIL_STALE_MIGRATION_ACCEPTANCE_SCOPE' if missing else 'PASS_EXPLICIT_MIGRATION_SCOPE', 'issues': missing, 'actualTargetCalls': 0, 'productTestFailure': False}))
        raise SystemExit(1 if missing else 0)
    assert len(sys.argv) == 1 or sys.argv == [sys.argv[0], '--preseal']
    print(json.dumps(verify()))
