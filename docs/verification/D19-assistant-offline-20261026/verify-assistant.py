"""File-only receipt/provenance checker; never import a runtime/client or contact a target."""
from pathlib import Path
import csv, hashlib, json, sys
R = Path(__file__).resolve().parents[3]; V = R / 'docs/verification'; P = Path(__file__).resolve().parent
SOURCE = 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def check_ref(item): assert sha(R / item['path']) == item['sha256'], item['path']
def rows(p):
    with Path(p).open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))
def verify():
    checkpoint = read(P / 'checkpoint.json'); before = {x['path']: x for x in checkpoint['files']}
    for item in before.values(): assert sha(R / item['before']) == item['sha256']
    for name in ['code-fingerprint.json', 'D19-C2-application-runtime-manifest.json', 'D19-application-runtime-preparation-20261025/runtime-authorization.json']:
        assert sha(V / name) == before['docs/verification/' + name]['sha256']
    assert sha(V / 'D19-C2-application-runtime-manifest.json') == 'eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
    assert read(V / 'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved'] is False
    source = read(V / 'code-fingerprint.json'); assert source['fingerprint'] == SOURCE and len(source['files']) == 788
    for item in source['files']: assert hashlib.sha256((R / item['path']).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == item['sha256'], item['path']
    receipts = [read(P / name) for name in ['boundary-path-fixed-command.json', 'boundary-lint-command.json', 'boundary-type-command.json']]
    test = receipts[0]
    for receipt in receipts:
        assert receipt['exit'] == 0 and receipt['endedAt'] > receipt['startedAt']
        assert receipt['sourceFingerprint'] == SOURCE and receipt['sourceRecordsUnchanged'] == 788 and receipt['node'] == 'v22.23.4'
        assert receipt['envCredentialsAndPreloadsStripped'] is True and receipt['configEnvDir'] is False
        assert min(receipt['resource']['freePhysicalGiB'], receipt['resource']['freeCommitGiB']) >= receipt['resource']['minimumGiB'] == 3
        assert receipt['verificationArtifacts'] == test['verificationArtifacts']
        for artifact in receipt['verificationArtifacts']: check_ref(artifact)
        assert hashlib.sha256(json.dumps(receipt['verificationArtifacts'], separators=(',', ':')).encode()).hexdigest() == receipt['verificationArtifactFingerprint']
        assert receipt['actualTargetCalls'] == receipt['actualSdkClients'] == receipt['actualProviderCalls'] == 0
    check_ref(receipts[2]['additionalConfiguration'])
    assert test['nativeCounts'] == {'numTotalTests': 8, 'numPassedTests': 8, 'numFailedTests': 0, 'numPendingTests': 0}
    native = read(P / 'boundary-path-fixed-native.json')
    assert native['success'] is True and native['numFailedTestSuites'] == native['numFailedTests'] == native['numPendingTests'] == 0
    assert len(native['testResults']) == 1 and native['testResults'][0]['status'] == 'passed'
    assertions = native['testResults'][0]['assertionResults']; assert len(assertions) == 8 and all(a['status'] == 'passed' for a in assertions)
    initial = read(P / 'boundary-initial-command.json'); initial_native = read(P / 'boundary-initial-native.json')
    assert initial['exit'] == 1 and initial_native['success'] is False
    assert initial_native['numFailedTestSuites'] == 1 and initial_native['numPassedTests'] == 8
    assert 'ENOENT' in initial_native['testResults'][0]['message']
    assert [a['fullName'] for a in initial_native['testResults'][0]['assertionResults']] == [a['fullName'] for a in assertions]
    config = (P / 'vitest.offline.mjs').read_text(encoding='utf-8')
    assert 'envDir: false' in config and 'maxWorkers: 1, minWorkers: 1' in config
    assert read(P / 'tsconfig.offline.json')['include'] == ['assistant-boundary.test.tsx']
    assert sha(P / 'offline-readback.json') == sha(P / 'boundary-path-fixed-readback.json')
    actual = read(P / 'boundary-path-fixed-readback.json')
    assert actual['identity'] == {'transport': 'in-process-Hono-and-JSDOM', 'database': 'scripted-memory-fake', 'provider': 'dependency-injected-mock', 'actualAuth': False, 'persistent': False, 'externalNetwork': False}
    for key in ['actualTargetCalls', 'actualSdkClients', 'actualAuthSubjectsOrFixtures', 'physicalSqlCalls', 'actualProviderCalls']: assert actual[key] == 0
    observed = actual['observations']; assert len(observed) == 8
    for item in observed:
        assert item['trace']['deniedExternalFetch'] == item['trace']['realProviderCalls'] == 0
        assert any(item['test'].endswith(a['title']) for a in assertions)
    sequences = [([], [], 0), (['POST','POST'], [200,200], 2), (['POST','POST'], [429,200], 1), (['POST','POST','POST'], [200,503,202], 1), (['POST','GET'], [503,200], 1), (['POST','GET'], [200,200], 1), (['POST'], [200], 2), (['POST'], [503], 0)]
    for item, (methods, statuses, chats) in zip(observed, sequences):
        t = item['trace']
        assert [r['method'] for r in t['requests']] == methods and [r['status'] for r in t['requests']] == statuses
        assert len(t['chats']) == chats
    retry = observed[2]['trace']['requests']; assert retry[0]['requestId'] == retry[1]['requestId']
    history = observed[1]['trace']['history']; assert history == [{'projection': 'role, content', 'filters': [['conversation_id','00000000-0000-4000-8000-000000000703']], 'order': [['created_at',False],['turn_order',False]], 'limit':20}]
    assert observed[1]['trace']['chats'][1]['roles'] == ['system','user','assistant','user']
    assert observed[4]['scriptedMessages'] == 0 and observed[5]['scriptedMessages'] == 2
    assert observed[6]['trace']['rpc'] == ['reserve_assistant_request','claim_assistant_request','match_kb_chunks','save_assistant_turn']
    assert observed[7]['fakeClientFactories'] == 0
    for revision in (P / 'source-revisions').iterdir():
        manifest = read(revision / 'manifest.json')
        assert manifest['artifactFingerprint'] == revision.name
        for item in manifest['files']: assert sha(revision / Path(item['path']).name) == item['sha256']
    cases, old_cases = rows(V / 'audit_case_coverage.csv'), rows(R / before['docs/verification/audit_case_coverage.csv']['before'])
    assert len(cases) == len(old_cases) == 107
    changed = []
    for current, old in zip(cases, old_cases):
        assert all(current[k] == old[k] for k in old if k not in {'newResult','testStatus','runtimeStatus','newEvidence','limitations'})
        if current != old: changed.append(current['case_id'])
        if current['case_id'] in ['UC-C18','UC-A51','UC-A11','UC-R04']: assert current == old
    assert set(changed) == {'UC-C19','UC-Q04','UC-Q05'}
    assert all('FULL_CASE_NOT_VERIFIED' in c['newResult'] for c in cases if c['case_id'] in changed)
    tasks, old_tasks = rows(V / 'implementation_backlog.csv'), rows(R / before['docs/verification/implementation_backlog.csv']['before'])
    assert len(tasks) == len(old_tasks) == 20
    for current, old in zip(tasks, old_tasks):
        assert all(current[k] == old[k] for k in old if k not in {'newResult','testStatus','runtimeStatus','evidence'})
        if current['task_id'] not in ['D16','D19']: assert current == old
    main, original = read(V / 'adfocate-delivery.json'), read(R / before['docs/verification/adfocate-delivery.json']['before'])
    for key in ['D15','D20','D19ApplicationSupplementPreparation','D19R1FacetReview','D19LegacyMemorySqlVerification','D19MigrationPreservationReview','executionModel','financialNeutrality','currentCandidateVerificationScope']:
        assert main[key] == original[key], key
    assert main['caseResults'] == cases and main['currentRecordAuthority']['currentRuntimeSource'] is None
    delivery = read(P / 'delivery.json'); assert main['D19AssistantOfflineVerification'] == delivery
    for key in ['gates','readbacks','caseCoverage','remaining','rollback','c2Manifest','priorDelivery']: check_ref(delivery[key])
    assert delivery['standalonePassed'] == 8 and delivery['wholeR1Verified'] is False
    assert delivery['c2ApprovalPending'] is delivery['incidentOpen'] is delivery['releaseHold'] is True
    assert delivery['restored'] is delivery['providerEnabled'] is False
    for key in ['actualTargetCalls','actualSdkClients','physicalSqlCalls','productionWrites','formalMembershipOrRoleWrites','actualProviderCalls']: assert delivery[key] == 0
    assert delivery['commit'] is None and delivery['push'] is delivery['merge'] is False and delivery['deployment'] == 'NOT_DEPLOYED'
    gates = read(P / 'gates.json')
    for item in gates['references']: check_ref(item)
    assert gates['countsMustRemainSeparate'] is True
    old_full = read(V / 'D19-application-runtime-preparation-20261025/supplement-full-final.json')
    assert old_full['numPassedTests'] == 2129 and old_full['numFailedTests'] == 0 and old_full['numPendingTests'] == 363
    remaining = read(P / 'remaining-acceptance.json'); group = next(g for g in remaining['remainingCaseGroups'] if g['id'] == 'ASSISTANT-LAYER-REVIEW')
    assert group['wholeCurrentCaseVerified'] is False and group['actualProviderEvaluation'] == 'NOT_RUN_DISABLED'
    for item in [group['offlineEvidence'],group['readbacks']]: check_ref(item)
    assert not remaining['wholeR1Verified']
    old_index = read(R / before['docs/verification/evidence-integrity.json']['before']); assert len(old_index['files']) == 2196
    for item in old_index['files']:
        path = R / (before[item['path']]['before'] if item['path'] in before else item['path'])
        assert sha(path) == item['sha256'], 'Prior evidence changed: ' + item['path']
    assert (V / 'adfocate-task-ledger.md').read_bytes().startswith((R / before['docs/verification/adfocate-task-ledger.md']['before']).read_bytes())
    git = read(P / 'git-final.json')
    assert git['head'] == checkpoint['head'] == '7cfa3dc84c821719a4dff754229a591c81786c53'
    assert git['branch'] == checkpoint['branch'] == 'codex/adfocate-r1-pilot-20261023'
    assert git['remote'] == 'https://github.com/YNWAforever/Remix-Adfocate.git' and git['stagedPaths'] == [] and git['diffCheckExit'] == 0
    for path in P.rglob('*'):
        if path.is_file(): assert bytes([123,123,80,65,83,83,87,79,82,68,95]) not in path.read_bytes(), path
    preseal = len(sys.argv) == 2 and sys.argv[1] == '--preseal'
    if not preseal:
        for name in ['D19-assistant-offline-integrity.json','evidence-integrity.json']:
            index = read(V / name); assert index['codeFingerprint'] == SOURCE
            for item in index['files']: check_ref(item); assert (R / item['path']).stat().st_size == item['bytes']
        index = read(V / 'evidence-integrity.json')
        assert {i['path'] for i in index['files']} == {p.relative_to(R).as_posix() for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json'}
        assert len(index['files']) == main['evidenceIntegrity']['records']
        receipt = read(P / 'verification-summary.json'); assert receipt['preseal']['exit'] == 0 and receipt['checkerSha256'] == sha(Path(__file__))
        if 'final' in receipt: assert receipt['final']['exit'] == 0 and receipt['final']['result']['currentEvidenceRecords'] == len(index['files'])
    return {'status': 'PASS_OFFLINE_ASSISTANT_ASSERTIONS_SEAL_PENDING' if preseal else 'PASS_OFFLINE_ASSISTANT_BOUNDARY_NOT_REAL_AUTH_RLS_PROVIDER_ACCEPTANCE', 'sourceFingerprint': SOURCE, 'sourceRecordsUnchanged': 788, 'standaloneTests': {'passed':8,'failed':0,'skipped':0}, 'targetedLintAndType': 'PASS', 'retainedNativeFull': {'passed':2129,'failed':0,'skipped':363}, 'retainedLegacyMemory': {'passed':7,'failed':0,'skipped':0}, 'countsMustRemainSeparate': True, 'casesWithNewEvidence': sorted(changed), 'originalCasesPreserved':107, 'priorEvidenceRecordsPreserved':2196, 'currentEvidenceRecords': None if preseal else len(index['files']), 'initialEvidenceWriterFailurePreserved':True, 'c2SourceManifestApprovalUnchanged':True, 'c2ApprovalPending':True, 'actualTargetCalls':0, 'actualSdkClients':0, 'actualProviderCalls':0, 'incidentOpen':True, 'releaseHold':True, 'providerEnabled':False, 'wholeR1Verified':False}
if __name__ == '__main__':
    assert len(sys.argv) == 1 or sys.argv == [sys.argv[0], '--preseal']
    print(json.dumps(verify()))
