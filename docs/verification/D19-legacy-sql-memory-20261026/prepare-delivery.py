from pathlib import Path
import csv, datetime, hashlib, io, json, shutil, subprocess, sys

R = Path.cwd()
V = R / 'docs/verification'
P = V / 'D19-legacy-sql-memory-20261026'
SOURCE = 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
C2 = 'eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'

def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p): return Path(p).relative_to(R).as_posix()
def put(p, obj): Path(p).write_text(json.dumps(obj, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')
def ref(p): return {'path': rel(p), 'sha256': sha(p)}
def rows(p):
    with Path(p).open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))
def write_csv(p, data):
    out = io.StringIO(newline='')
    w = csv.DictWriter(out, fieldnames=list(data[0]), lineterminator='\n')
    w.writeheader(); w.writerows(data)
    Path(p).write_text(out.getvalue(), encoding='utf-8', newline='\n')

checkpoint = read(P / 'checkpoint.json')
before = {x['path']: x for x in checkpoint['files']}
source = read(V / 'code-fingerprint.json')
assert source['fingerprint'] == SOURCE and len(source['files']) == 788
for row in source['files']:
    assert hashlib.sha256((R / row['path']).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == row['sha256'], row['path']
for path in ['docs/verification/code-fingerprint.json', 'docs/verification/D19-C2-application-runtime-manifest.json', 'docs/verification/D19-application-runtime-preparation-20261025/runtime-authorization.json']:
    assert sha(R / path) == before[path]['sha256']
assert sha(V / 'D19-C2-application-runtime-manifest.json') == C2
assert read(V / 'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved'] is False
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

if sys.argv[1] == 'prepare':
    assert not (P / 'delivery.json').exists(), 'One-shot generation; never replace prior delivery'
    for row in before.values():
        assert sha(R / row['before']) == row['sha256']
        assert sha(R / row['path']) == row['sha256'], row['path']
    test = read(P / 'memory-readback-final-command.json')
    lint = read(P / 'lint-readback-final-command.json')
    profile = read(P / 'sql-profile.json')
    engine = read(P / 'memory-readback-final-engine-result.json')
    assert test['exit'] == lint['exit'] == 0
    assert test['nativeCounts'] == {'tests': 7, 'pass': 7, 'fail': 0, 'skipped': 0}
    assert test['verificationArtifactSources'] == lint['verificationArtifactSources']
    assert engine['enginesCreated'] == engine['enginesClosed'] == len(engine['caseEvidence']) == 7
    assert engine['networkAttempts'] == 0 and engine['target']['locator'] == 'memory://'
    assert engine['profileDigest'] == profile['profileDigest']
    assert len(profile['sources']) == 7 and len(profile['statements']) == 23
    # Public review copy of the exact runner used above; caller must use repository cwd.
    shutil.copyfile(R / '.codex-tmp/D19-legacy-memory-run.py', P / 'run-memory-verification.py')
    revision = P / 'source-revisions' / test['verificationArtifactFingerprint']
    revision.mkdir()
    for row in test['verificationArtifactSources']:
        shutil.copyfile(R / row['path'], revision / Path(row['path']).name)
    put(revision / 'manifest.json', {'artifactFingerprint': test['verificationArtifactFingerprint'], 'files': test['verificationArtifactSources'], 'applicationFingerprint': SOURCE, 'includedInNativeFullOrC2Runtime': False})
    witnesses = [{k: v for k, v in case.items() if k != 'readbacks'} for case in engine['caseEvidence']]
    put(P / 'readback-summary.json', {'at': stamp, 'sourceFingerprint': SOURCE, 'verificationArtifactFingerprint': test['verificationArtifactFingerprint'], 'cases': witnesses, 'fullSnapshots': ref(P / 'memory-readback-final-engine-result.json'), 'tableFamilies': 9, 'valuesAreSyntheticMemoryOnly': True, 'notIncidentBeforeImagesOrPendingNeutrality': True})
    put(P / 'schema-scope.json', {'sourceMigrations': 73, 'sourceMigrationChanges': 0, 'physicalSchemaCalls': 0, 'physicalTargetState': 'NOT_READ_THIS_TURN; historical C1 schema72 retained only', 'memoryProfile': ref(P / 'sql-profile.json'), 'originalSqlFiles': 7, 'selectedOriginalStatements': 23, 'comparedTableFamilies': 9, 'fullMigrationOrTriggerReplay': False, 'newDatabaseFeatureOrPersistentLedger': False, 'excluded': profile['excluded'], 'invalidFixture': 'Invented, in-process row inserted before the actual evidence guard; never an incident before-image. No live trigger disabled or data restored.'})
    gates = {'at': stamp, 'sourceFingerprint': SOURCE, 'sourceRecordsUnchanged': 788, 'applicationSourceChanges': 0, 'standaloneVerificationArtifactFingerprint': test['verificationArtifactFingerprint'], 'standaloneArtifactSources': test['verificationArtifactSources'], 'nativeFullRetained': {'passed': 2129, 'failed': 0, 'skipped': 363, 'files': 292, 'evidence': ref(V / 'D19-application-runtime-preparation-20261025/supplement-full-final.json'), 'rerunThisTurn': False}, 'memorySql': {'passed': 7, 'failed': 0, 'skipped': 0, 'notAddedToNativeFullCounts': True, 'node': test['nodeVersion'], 'pglite': read(R / 'node_modules/@electric-sql/pglite/package.json')['version'], 'command': test['command'], 'receipt': ref(P / 'memory-readback-final-command.json'), 'log': ref(P / 'memory-readback-final.log'), 'engine': ref(P / 'memory-readback-final-engine-result.json')}, 'targetedLint': {'exit': 0, 'command': lint['command'], 'receipt': ref(P / 'lint-readback-final-command.json'), 'log': ref(P / 'lint-readback-final.log')}, 'profile': ref(P / 'sql-profile.json'), 'initialPassPreserved': ref(P / 'memory-initial-command.json'), 'initialLintPreserved': ref(P / 'lint-initial-command.json'), 'initialArtifactSourcePreserved': 'source-revisions/4e3a7504ab4021888f27f974a24448481ef4a20f7a4659554948bb4d5d03a7f0/', 'resourceGate': 'Fresh physical and commit availability >=3GiB before each child; actual run readings in immutable command/resource receipts.', 'redGreen': 'Missing legacy replay evidence was the target. Original SQL passed the first valid seven-case suite; no product regression found, no fabricated RED and no SQL repair.', 'actualPhysicalTargetsOrClients': 0, 'realAuthOrFixtureWrites': 0, 'c2RuntimeExecuted': False}
    put(P / 'gates.json', gates)
    cases = rows(V / 'audit_case_coverage.csv')
    for row in cases:
        if row['case_id'] != 'UC-A11': continue
        row['newResult'] = 'PARTIAL_CURRENT_MEMORY_SQL_AND_HISTORICAL_EVIDENCE; CURRENT_FULL_CASE_NOT_VERIFIED'
        row['testStatus'] += ' | Standalone Node22 memory SQL7/0/0: original legacy function/evidence guard, separate committed retries, points/XP/cash/budget once, saved rating/note/revision, two late-write failures, insufficient budget and SQL execute ACL. Not part of native2129 full suite.'
        row['runtimeStatus'] = 'CURRENT_REAL_AUTH_RLS_CONCURRENCY_AND_BROWSER_NOT_VERIFIED. New in-process memory-only core subset7 pass; full9-family persisted-in-memory readbacks retained. No server/target/client/session/fixture action and no legacy issuance outside memory. C2 remains unchanged/unapproved and excludes legacy replay.'
        row['newEvidence'] += ';D19-legacy-sql-memory-20261026/gates.json;D19-legacy-sql-memory-20261026/readback-summary.json;D19-legacy-sql-memory-20261026/memory-readback-final-engine-result.json;D19-legacy-sql-memory-20261026/sql-profile.json'
        row['limitations'] += ' | Only selected original SQL tables/function/guard/ACL in memory://; no full73 trigger stack, actual Auth/membership/RLS, independent connections, persistScores/API/UI or active pending flow. Saved core note/rating is directly read back; score/API/UI acceptance remains missing. In-memory legacy credits are not pending-reward neutrality or incident restoration.'
    write_csv(V / 'audit_case_coverage.csv', cases)
    previous = read(V / 'D19-R1-facet-review-20261025/remaining-acceptance.json')
    remaining = dict(previous)
    remaining['at'] = stamp
    remaining['previousReview'] = ref(V / 'D19-R1-facet-review-20261025/remaining-acceptance.json')
    remaining['sourceFingerprint'] = SOURCE
    remaining['nextTask'] = 'D19: keep the existing exact C2 application-runtime approval pending; execute only after that explicit approval. Independently review local assistant/migration/gate facets. Legacy core memory evidence is now explicit, but actual same-submission Auth/RLS/concurrent/API-score/browser acceptance needs a separate bounded scope; no extra runtime is authorized by these tests.'
    for group in remaining['remainingCaseGroups']:
        if group['id'] == 'LEGACY-APPROVAL-REPLAY':
            group.update({'knownEvidence': 'Current source: seven standalone memory SQL cases use the original final legacy function and evidence guard on selected original table definitions. Same committed submission replay/changed valid payload preserves saved note/rating/revision and points250/XP185/cash47.25/budget452.75 with one ledger each; late cash and XP faults roll back all nine compared data families. Earlier distinct C1 legacy issuances remain historical only.', 'missing': 'Actual identity-gated signed-in operator/API flow, full migration/trigger stack including score persistence and any related side effects, independent-connection same-submission concurrency, saved score/note UI and reload. Core saved note/rating SQL evidence does not prove these full-case facets.', 'status': 'CURRENT_MEMORY_SQL_CORE_PASS7; REAL_FULL_CASE_ACCEPTANCE_STILL_MISSING', 'memoryEvidence': ref(P / 'gates.json'), 'readbackEvidence': ref(P / 'readback-summary.json'), 'pendingManifestCovers': 'No; frozen pending C2 expressly excludes legacy issuance/replay.', 'next': 'Retain local readbacks without promoting whole-case acceptance. Do not execute legacy replay under completed696e or applications-only C2; any real target/fixture/financial replay needs its own concretely approved scope.'})
    remaining['historicalBlockerTextBeforeModelObservation'] = [x for x in previous['blockers'] if x.startswith('Execution-interface')]
    remaining['blockers'] = [x for x in previous['blockers'] if not x.startswith('Execution-interface')]
    remaining['memorySqlCoreComplete'] = True
    remaining['newPhysicalTargetCalls'] = 0
    put(P / 'remaining-acceptance.json', remaining)
    coverage = {'at': stamp, 'sourceFingerprint': SOURCE, 'auditCases': 107, 'originalAuditFieldsPreserved': True, 'newResultRowsChangedThisTurn': ['UC-A11'], 'wholeCurrentCaseAcceptedByThisTurn': [], 'D15RowsUnchanged': ['UC-C18', 'UC-A51'], 'gate14RequiredWithoutWaiver': 14, 'cases': cases, 'legacyMemoryEvidence': ref(P / 'gates.json'), 'remainingAcceptance': ref(P / 'remaining-acceptance.json'), 'scope': 'Seven memory SQL core assertions strengthen one facet, never all107/wholeR1/Auth/RLS/UI acceptance.'}
    put(P / 'case-coverage.json', coverage)
    rollback = {'at': stamp, 'scope': 'Selective local verification metadata/artifact rollback only. Application/runtime source and C2 authority unchanged; no physical data/schema operation to reverse.', 'before': checkpoint['files'], 'instructions': ['Verify after-integrity and preserve any later/user edits before restoring only explicitly changed local metadata from these exact before copies.', 'Retain this evidence and all earlier logs, manifests, source revisions, seals and incident records; do not reset/clean checkout.', 'New standalone artifacts are non-runtime verification documents; they can remain archived without affecting application behavior.', 'No restore/delete/rebuild/stop/cleanup of targets or fixtures is authorized. In-memory engines were closed; nothing was persisted to a target.', 'Restoring an older label is not proof of acceptance or a reversal of the original campaign incident.'], 'afterIntegrity': 'docs/verification/D19-legacy-sql-memory-integrity.json', 'applicationSourceOrSqlRollback': 'NONE_NEEDED_UNCHANGED', 'physicalDataRollback': 'NOT_APPLICABLE_NO_TARGET_ACTIONS', 'originalIncident': 'OPEN_UNRESTORED', 'releaseHold': True, 'providerEnabled': False, 'c2SourceManifestApprovalUnchanged': True}
    put(P / 'rollback.json', rollback)
    delivery = {'at': stamp, 'status': 'PASS_STANDALONE_LEGACY_MEMORY_SQL_CORE_NOT_R1_VERIFIED', 'sourceFingerprint': SOURCE, 'sourceFilesUnchanged': 788, 'applicationSourceChanges': 0, 'verificationArtifactFingerprint': test['verificationArtifactFingerprint'], 'code': 'Existing legacy SQL unchanged. Added isolated, explicitly invoked memory-only verification artifacts; no new reward engine or financial capability.', 'test': {'standaloneMemory': {'passed': 7, 'failed': 0, 'skipped': 0}, 'standaloneLintExit': 0, 'retainedNativeFull': {'passed': 2129, 'failed': 0, 'skipped': 363, 'files': 292}, 'nativeFullRerunThisTurn': False, 'countsMustNotBeCombinedAsFullSuite': True}, 'gates': ref(P / 'gates.json'), 'readbacks': ref(P / 'readback-summary.json'), 'schema': ref(P / 'schema-scope.json'), 'caseCoverage': ref(P / 'case-coverage.json'), 'remaining': ref(P / 'remaining-acceptance.json'), 'rollback': ref(P / 'rollback.json'), 'c2Manifest': ref(V / 'D19-C2-application-runtime-manifest.json'), 'c2ApprovalPending': True, 'c2SourceManifestOrApprovalChanged': False, 'actualTargetCalls': 0, 'externalClients': 0, 'realAuthSubjectsOrDomainFixtures': 0, 'formalMembershipOrRoleWrites': 0, 'productionWrites': 0, 'providerCalls': 0, 'pristineGlobalRpcRerun': False, 'legacyIssuanceOutsideMemory': False, 'pendingRewardNeutralityMeasuredThisTurn': False, 'originalIncident': 'OPEN_UNRESTORED', 'oldShapedTarget': 'FORENSIC_ONLY_NOT_QUERIED', 'releaseHold': True, 'providerEnabled': False, 'deployment': 'NOT_DEPLOYED', 'commit': None, 'push': False, 'merge': False, 'wholeR1Verified': False, 'blockers': remaining['blockers'], 'nextTask': remaining['nextTask'], 'priorCurrentDelivery': ref(V / 'D19-R1-facet-review-20261025/delivery.json'), 'priorSnapshotCheckpoint': ref(P / 'checkpoint.json'), 'modelInterfaceObservation': read(V / 'adfocate-delivery.json')['executionModel']['evidence']}
    put(P / 'delivery.json', delivery)
    text = '''# D19 legacy SQL 本機補驗 — 2026-10-26

本輪補齊 UC-A11 的 SQL core 證據，原 application source 788 筆、73 migrations 及待批 C2 manifest 全部不變。七項 standalone Node22/PGlite 記憶體測試與指定 lint 通過，沒有發現需要修改的 SQL。先前 native full 2129 pass / 0 fail / 363 gated skips（292 files）保留於原 source，今輪未重跑；七項獨立測試不能併稱為新的 full-suite count。

執行前先驗證不可覆寫的 memory:// descriptor，之後才 import／建立 engine。每項獨立 engine，跨交易 retry 使用分開的 autocommit statements；七個 engine 全部關閉，external fetch attempts 0。這沒有建立物理 target、Auth subject、session 或持久 fixture。

| 行為 | 直接讀回證據 |
| --- | --- |
| 同一 cash-bearing submission 首次批准、原 payload 重試、不同合法 note/rating 重試 | points 250、XP 185（原35＋100＋5星50）、cash 47.25、budget 452.75；三種 ledger 各1筆。saved note/rating/revision 保留原結果，九類資料 hash 在重試後相同 |
| budget 不足／late cash-ledger fault／final Creator XP fault | 拒絕後九類資料完整讀回等於事前；記憶體內受控修正後只批准一次，重試不增發 |
| pre-guard 無效 URL | 真正 evidence guard 拒絕，九類資料不變；fixture 是自行建立的合成值，完全不是事故事前像 |
| non-cash legacy mission | points 250、XP 135；cash 0、budget 500，cash/budget ledger 0；retry 不變 |
| execute ACL | 原 SQL 的 anon/authenticated 拒絕，service_role 允許；不等於真實 Auth、membership 或 RLS 驗收 |

`sql-profile.json` 綁定七份原 SQL raw hashes、23個 selected original statements、bootstrap／profile digest。只載入原 table、final approve_submission、evidence guard 及 ACL；不是完整73 migration／trigger replay。沒有驗證 GoTrue/PostgREST/Hono、實際 Auth／membership／RLS、多連線併發、campaign/notification/level hooks、API persistScores 或 browser rating/note reload。沒有測 active pending flow，這些 legacy 記憶體 credits 不構成 pending reward 財務 neutrality。

可重現命令（在 worktree root，使用新的 label 保留舊 receipt）：

```powershell
python docs/verification/D19-legacy-sql-memory-20261026/run-memory-verification.py test memory-review-next
python docs/verification/D19-legacy-sql-memory-20261026/run-memory-verification.py lint lint-review-next
python docs/verification/D19-legacy-sql-memory-20261026/verify-memory.py
```

首輪及最後一輪的實際 Node command、version、physical/commit resource readings、terminal exit、TAP log、artifact source revisions 與 engine readbacks 全部保留。首輪就已通過，沒有虛構 RED 或產品修復。

本輪只更新 UC-A11 新層，107個 originalAuditResult／expected 等原欄及 D15 UC-C18／A51 整行不變。完整剩餘清單、依賴與缺少的角色／browser facets 在 remaining-acceptance.json；C2 application runtime 仍待原問題的明確批准，不能沿用已完成696e批准，也不能用 C2 跑 legacy replay。

D15 教材、具名 advisor owner／實體裝置／manual AT／hosted、正式 staff scope、audit ZIP 原檔核實及其餘 R1 facets 保持未完成。模型介面沿用上一輪已觀察的 GPT-6.1 Sol／Max；沒有切換或推測 ID。

事故 OPEN、未還原；舊 shaped target 只供鑑證，沒有查詢或驗收重用。release HOLD、真實 provider disabled。未 commit／push／merge／deploy，未改正式資料。Rollback 只涉及 exact-before local metadata；沒有物理資料或 schema rollback。
'''
    (P / 'delivery.md').write_text(text, encoding='utf-8', newline='\n')
    tasks = rows(V / 'implementation_backlog.csv')
    for row in tasks:
        if row['task_id'] != 'D19': continue
        row['newResult'] += '; current standalone legacy memory SQL core7 pass, full UC-A11/runtime still unverified'
        row['testStatus'] += ' Separate memory7/0/0 and targeted lint pass; not added to native full counts and not real Auth/RLS/concurrency.'
        row['runtimeStatus'] += ' New legacy memory core only: no physical target/client/session/setup action; C2 approval remains pending and digest unchanged.'
        row['evidence'] += ';D19-legacy-sql-memory-20261026/delivery.json;D19-legacy-sql-memory-20261026/gates.json'
    write_csv(V / 'implementation_backlog.csv', tasks)
    ledger = V / 'adfocate-task-ledger.md'
    with ledger.open('a', encoding='utf-8', newline='\n') as f:
        f.write('\n\n### D19 legacy SQL memory-only followup — 2026-10-26\n\nCode: application788/SQL73/C2 source and manifest unchanged; standalone verification only. Test: memory SQL7/0/0 plus lint pass, separate from retained native2129/0/363. Deployment: not deployed; no commit/push/merge. Runtime: memory:// only, seven engines closed, network0; no actual target/client/Auth/fixture/member action. UC-A11 remains partial pending actual full-stack/concurrent/score/UI acceptance. Incident OPEN, HOLD, provider disabled. Evidence: D19-legacy-sql-memory-20261026/delivery.json; exact-before rollback in its rollback.json.\n')
    main = read(V / 'adfocate-delivery.json')
    main['updatedAt'] = stamp
    main['codeStatus'] = 'Application/runtime source788 and all73 SQL source files unchanged. Separate explicitly invoked verification artifacts under docs/verification only.'
    main['testStatus'] += ' Standalone legacy memory SQL7/0/0 plus targeted lint pass, recorded separately; no native full-suite rerun.'
    main['runtimeStatus'] = 'C2 NOT_RUN; unchanged source-bound approval template false. This followup ran only memory:// SQL; no actual target/client/session/setup. Approved696e evidence remains bound to e839.'
    main['D19LegacyMemorySqlVerification'] = delivery
    main['currentRecordAuthority'].update(currentSummary=rel(P / 'delivery.json'), currentCaseCoverage=rel(P / 'case-coverage.json'), checker=rel(P / 'verify-memory.py'), currentSupplementGates=rel(P / 'gates.json'))
    main['caseResults'] = cases
    main['caseCoverageSummary'].update(details=rel(P / 'case-coverage.json'), legacyMemoryOnlySupplement=rel(P / 'readback-summary.json'))
    main['nextTask'] = remaining['nextTask']
    main['remainingRisks'] = remaining['blockers'] + [g['id'] + ': ' + g.get('status', 'MISSING_ACCEPTANCE') for g in remaining['remainingCaseGroups'] if not g.get('status', '').startswith('RESOLVED')]
    main['rollback'] = rel(P / 'rollback.json')
    main['verificationLimit'] = 'Current788-source native full retained; separate memory SQL core7 pass only. Actual full-stack Auth/RLS/concurrent/browser/hosted legacy facets and C2 runtime remain unverified. Historical696e scope is limited to e839. Not107 browser passes; wholeR1 not verified.'
    main['changedFiles'] = sorted(set(main['changedFiles'] + [rel(P) + '/', 'docs/verification/D19-legacy-sql-memory-integrity.json', 'docs/verification/adfocate-delivery.json', 'docs/verification/audit_case_coverage.csv', 'docs/verification/implementation_backlog.csv', 'docs/verification/adfocate-task-ledger.md', 'docs/verification/evidence-integrity.json']))
    main['evidenceIntegrity'].update(taskSubset='docs/verification/D19-legacy-sql-memory-integrity.json', checker=rel(P / 'verify-memory.py'))
    main['currentExecutionModelVerification'] = {'status': 'OBSERVED_GPT_6_1_SOL_MAX_PRIOR_REVIEW', 'selectedInterfaceStateReturned': True, 'modelSwitchPerformed': False, 'providerModelId': None, 'modelIdInferred': False, 'evidence': main['executionModel']['evidence'], 'scope': 'Retained prior current-thread UI observation; no new observation or retrospective/provider-route claim this followup.', 'priorFailedAttemptPreservedIn': before['docs/verification/adfocate-delivery.json']['before']}
    main['currentToolchainVerification'] = {'sourceFingerprint': SOURCE, 'Node22': {'version': test['nodeVersion'], 'full': gates['nativeFullRetained'], 'standaloneMemory': gates['memorySql'], 'staticBuild': 'PASS_RETAINED_AT_IDENTICAL_SOURCE'}, 'Node24CurrentFull': 'NOT_RUN', 'retainedNode24Full': main['currentToolchainVerification']['retainedNode24Full'], 'realServerRuntime': 'NOT_RUN_CURRENT_SOURCE'}
    main['schema'] = {'sourceMigrationFiles': 73, 'sourceMigrationRawHashesUnchanged': True, 'newPhysicalSchemaWrites': 0, 'currentPhysicalTarget': 'NOT_READ_THIS_TURN_UNKNOWN; historical C1 evidence72 only', 'retainedHistoricalCatalog': 'D19-C1-continuation-schema.json', 'standaloneMemorySubset': ref(P / 'schema-scope.json')}
    main['finalDeliveryReview'] = {'status': delivery['status'], 'machineReadable': rel(P / 'delivery.json'), 'report': rel(P / 'delivery.md'), 'taskCount': 20, 'auditCases': 107, 'findings': 28, 'wholeCurrentR1Verified': False, 'originalIncidentOpen': True, 'releaseHold': True, 'providerEnabled': False, 'canDeploy': False, 'canEnablePilot': False, 'currentEvidence': rel(P / 'delivery.json'), 'retained696eAtItsSource': 'D19-C1-continuation-delivery.json'}
    for row in main['taskResults']:
        if row['task'] != 'D19': continue
        row['newResult'] = {'code': delivery['code'], 'test': main['testStatus'], 'deployment': 'not-deployed; no commit/push/merge/deploy', 'runtime': main['runtimeStatus']}
        row.setdefault('followupResults', []).append({'id': 'LEGACY_MEMORY_SQL_20261026', 'newResult': row['newResult'], 'evidence': rel(P / 'delivery.json'), 'wholeR1Verified': False})
        row['evidence'].append(rel(P / 'delivery.json'))
    main['postFullSuiteVerification'].append({'task': 'D19 legacy memory SQL only', 'sourceFingerprint': SOURCE, 'sourceRecordsUnchanged': 788, 'standaloneMemoryPassed': 7, 'standaloneMemoryFailed': 0, 'standaloneMemorySkipped': 0, 'nativeFullRerun': False, 'actualTargetCalls': 0, 'evidence': rel(P / 'gates.json')})
    put(V / 'adfocate-delivery.json', main)
    print(json.dumps({'status': 'PREPARED_LOCAL_MEMORY_DELIVERY_NOT_SEALED', 'memory': 7, 'sourceUnchanged': 788, 'c2Unchanged': True, 'actualTargetCalls': 0}))
elif sys.argv[1] == 'seal':
    # Must run only after terminal verifier receipt is captured. This is a file-only seal.
    assert (P / 'verification-summary.json').exists()
    shutil.copyfile(Path(__file__), P / 'prepare-delivery.py')
    changes = [R / x['path'] for x in checkpoint['files'] if sha(R / x['path']) != x['sha256'] and not x['path'].endswith('evidence-integrity.json')]
    main = read(V / 'adfocate-delivery.json')
    subset = V / 'D19-legacy-sql-memory-integrity.json'
    if not subset.exists(): put(subset, {})
    all_files = sorted(p for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json')
    main['evidenceIntegrity']['records'] = len(all_files)
    put(V / 'adfocate-delivery.json', main)
    selected = sorted(set(changes + [p for p in P.rglob('*') if p.is_file()]))
    def entries(files): return [{'path': rel(f), 'sha256': sha(f), 'bytes': f.stat().st_size} for f in files]
    put(subset, {'at': stamp, 'codeFingerprint': SOURCE, 'method': 'Exact raw-byte hashes of this standalone memory verification and changed local metadata. Exclude this subset and root seal. Preserve all earlier hashes via exact before copies.', 'files': entries(selected)})
    put(V / 'evidence-integrity.json', {'createdAt': stamp, 'codeFingerprint': SOURCE, 'method': 'Exact raw-byte SHA256 of every verification file; excludes only this root seal. Historical seals, source revisions and exact before copies retained.', 'files': entries(all_files)})
    print(json.dumps({'status': 'SEALED_LOCAL_MEMORY_EVIDENCE', 'records': len(all_files), 'subset': len(selected), 'sourceFingerprint': SOURCE, 'actualTargetCalls': 0}))
else:
    raise SystemExit('Use prepare or seal')
