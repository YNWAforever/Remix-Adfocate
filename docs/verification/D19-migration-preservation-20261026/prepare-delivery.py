from pathlib import Path
import csv, datetime, hashlib, io, json, shutil, subprocess, sys

R = Path.cwd(); V = R / 'docs/verification'; P = V / 'D19-migration-preservation-20261026'
SOURCE = 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p): return Path(p).relative_to(R).as_posix()
def ref(p): return {'path': rel(p), 'sha256': sha(p)}
def put(p, value): Path(p).write_text(json.dumps(value, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')
def rows(p):
    with Path(p).open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))
def put_csv(p, data):
    s = io.StringIO(newline=''); w = csv.DictWriter(s, fieldnames=list(data[0]), lineterminator='\n'); w.writeheader(); w.writerows(data)
    Path(p).write_text(s.getvalue(), encoding='utf-8', newline='\n')
checkpoint = read(P / 'checkpoint.json'); before = {x['path']: x for x in checkpoint['files']}
for row in before.values(): assert sha(R / row['before']) == row['sha256']
for name in ['code-fingerprint.json', 'D19-C2-application-runtime-manifest.json', 'D19-application-runtime-preparation-20261025/runtime-authorization.json']:
    assert sha(V / name) == before['docs/verification/' + name]['sha256']
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
if sys.argv[1] == 'prepare':
    assert not (P / 'delivery.json').exists(), 'One-shot generation; preserve existing results'
    for row in before.values(): assert sha(R / row['path']) == row['sha256'], row['path']
    facts = read(P / 'migration-provenance.json')
    assert facts['sourceFingerprint'] == SOURCE and facts['actualTargetCalls'] == 0
    assert read(P / 'scope-red.json')['exit'] == 1
    review = {'at': stamp, 'tasks': ['D02', 'D19'], 'case': 'UC-R04', 'wholeCurrentCaseVerified': False, 'wholeR1Verified': False, 'facts': ref(P / 'migration-provenance.json'), 'historicalShapedScope': {'classification': 'HISTORICAL_SOURCE_AND_OUTPUT_ONLY', 'directCheckedRowFields': ['status', 'content_urls[0]'], 'fixtureCount': {'workspace': 1, 'creator': 1, 'mission': 1, 'submission': 1}, 'fullBeforeAfterRowSnapshotSaved': False, 'existingProofLedgerPreservationProven': False, 'oldHistoryCount': 14, 'oldHistoryArray': 'Captured before migration and copied to output; this file alone is not an independently saved after-history readback.', 'secondPass': 'pendingOnSecondPass is an observed pending-list query. It does not mean the raw migration SQL was executed twice.', 'unknown': ['Full historical submission row equality beyond the two explicit fields', 'A nonempty pre-migration proof/ledger cohort and its full before/after row hashes in this shaped witness', 'Current state of retired shaped target; not queried and never eligible for acceptance reuse']}, 'historicalC1Scope': {'classification': 'SEALED_APPROVED696E_HISTORICAL_FILE_EVIDENCE_ONLY', 'source': 'e83998d178061043688016056a5a78fc61df58bac28f3d0d0b66d639306037bd', 'threePhases': 3, 'familiesPerPhase': 70, 'uniqueCounts': facts['originalC1UniqueRowCounts'], 'migrationWindow': 'The baseline72 bootstrap precedes the active/proof/legacy acceptance cohorts. These final inventories are not themselves evidence of a later73 migration.', 'binaryLimit': 'draft assets, publication-proof assets and storage objects are zero. Existing URL proof attempt/review rows are nonempty; binary bytes preservation is not proven.'}, 'currentSourceComparison': {'classification': 'DIRECT_CURRENT_FILE_FACT', 'raw72Unchanged': True, 'protectedLf43Unchanged': True, 'historicalShapedLf36Unchanged': True, 'sourceMigrations': 73, 'protectedManifestMigrations': 43, 'differentCountsMeaning': 'Protected manifest is a selected forward-release list; full C1 baseline is all72 files. Do not substitute either count for the other or mark all source files applied.', 'newForwardOnly': facts['plannedForwardMigration']}, 'plannedC2MigrationPreservation': {'status': 'STATIC_SOURCE_CHECKS_EXIST_RUNTIME_NOT_RUN', 'classification': 'DIRECT_SOURCE_FACT_NOT_RUNTIME_RESULT', 'manifestSha256': facts['c2ManifestSha256'], 'migration': '72 to73, one new function + explicit ACL + one history row; no replay of the existing72 or9 compatibility statements', 'preconditions': ['Existing source-bound C2 approval must become explicit; unchanged authorization template is currently false', 'Fresh identity and read-only provenance before claim/migration/client/setup', 'Live old row hashes and catalog/history/seeds must equal sealed C1 evidence; mismatch stops without restore or compensation'], 'orderedChecks': facts['plannedBeforeClientChecks'], 'dataChecks': 'Compare originalQuery complete family inventory and nine global financial ID/row-hash sets immediately after migration and before SDK client or new fixture creation.', 'catalogChecks': 'Compare original eight-section catalog allowing only the one new function/history; independently preserve72 history, service histories and immutable migration seeds; assert original ACL denied for anon/authenticated and allowed for service_role.', 'successEvidenceRequired': ['Source/manifest/identity bound before.json with original row hashes and financial ID/hash sets', 'migration.json with before/after catalog and both data comparisons true, backed by actual successful assertions', 'Final supplement preservation readback; no execution claim from this static review'], 'newTargetRequested': False, 'extraFixturesOrWritesApprovedHere': False}, 'unrunRollbackScope': {'databaseDownOrReset': 'FORBIDDEN_NOT_REQUIRED_AS_A_TEST_SHORTCUT', 'oldBinaryRedeployment': 'NOT_RUN_NOT_AUTHORIZED; no deployment this review', 'operationalPolicy': 'Keep data/schema/history and original incident evidence; future reviewed forward repair only. Prepared local metadata rollback cannot restore a production database.'}, 'actualTargetCalls': 0, 'newApplicationOrMemorySuites': 0, 'incidentOpen': True, 'releaseHold': True, 'providerEnabled': False}
    put(P / 'review.json', review)
    cases = rows(V / 'audit_case_coverage.csv')
    for row in cases:
        if row['case_id'] != 'UC-R04': continue
        row['newResult'] = 'PARTIAL_HISTORICAL_REPLAY_AND_CURRENT_SOURCE_PROVENANCE; CURRENT_FULL_CASE_NOT_VERIFIED'
        row['testStatus'] += ' | Current file review: C1 raw72, protected LF43 and shaped LF36 hashes match. Existing48 native assertions inspected, not rerun; no new application/memory suite.'
        row['runtimeStatus'] = 'CURRENT_NONEMPTY_72_TO73_PRESERVATION_NOT_RUN. Old shaped witness directly checks one legacy URL/status only. C2 already contains original70-family and9 financial-row comparisons after forward73 and before new client/setup, but approval remains pending. Current target state UNKNOWN; no target/client/SQL action this review.'
        row['newEvidence'] += ';D19-migration-preservation-20261026/review.json;D19-migration-preservation-20261026/migration-provenance.json'
        row['limitations'] += ' | Old shaped output does not retain full legacy/proof/ledger before/after snapshots; original14 history array is pre-migration capture. C1 final nonempty URL-proof and ledger hashes remain historical, not a73 result. C2 static checks are not acceptance. Binary object count0; no bytes-preservation claim. Existing72/9 compatibility not replayed; no new target requested or authorized.'
    put_csv(V / 'audit_case_coverage.csv', cases)
    old_remaining = read(V / 'D19-legacy-sql-memory-20261026/remaining-acceptance.json')
    remaining = dict(old_remaining); remaining['at'] = stamp
    remaining['previousReview'] = ref(V / 'D19-legacy-sql-memory-20261026/remaining-acceptance.json')
    remaining['migrationPreservationReview'] = ref(P / 'review.json')
    remaining['nextTask'] = 'D19: retain the existing exact C2 application-runtime question and await explicit approval; do not request another target for the same nonempty73 preservation assertion. After approval, fresh identity/provenance must precede forward73 and complete old-row/financial comparisons before SDK/setup. No C2 runtime action is authorized by this review. Other original R1 asset/Creator-isolation/legacy/UI facets and existing blockers remain open.'
    for group in remaining['remainingCaseGroups']:
        if group['id'] != 'NONEMPTY-MIGRATION-SCOPE': continue
        group.update(knownEvidence='Current file inspection: all72 original C1 raw hashes,43 protected-manifest LF hashes and36 old shaped LF hashes match. Historical C1 final inventories contain seven submissions, four workflows, six URL-proof attempts/reviews, four pending records and two rows in each points/cash/budget ledger. Old shaped directly checks only one URL/status;48 current native assertions are retained, not new runtime.', missing='Actual approved current-source nonempty72-to73 before/after preservation and catalog/history/ACL readbacks. Historical cohorts or static runner assertions alone cannot prove it. No binary stored object cohort exists in this scope; binary asset acceptance remains separate. No database down/reset or redeployment was executed.', pendingManifestCovers='YES_AFTER_EXPLICIT_APPROVAL: existing frozen C2 adds forward73 once and compares original70-family data plus nine global financial ID/row-hash sets immediately afterward, before SDK/client/setup. Bootstrap does not replay the existing72/9 compatibility statements. This is not yet executed or approved.', next='Use the already prepared unchanged C2 scope if explicitly approved; fresh identity and exact original row hashes first. Do not create another target/fixture or query forensic-only shaped target for this review. Retain limits for pre72 shaped history and zero binary objects.', status='LOCAL_SOURCE_AND_HISTORICAL_SCOPE_RECONCILED; C2_NONEMPTY73_RUNTIME_PENDING', reviewEvidence=rel(P / 'review.json'), newTargetRequestedByThisReview=False, currentRuntimeVerified=False)
    put(P / 'remaining-acceptance.json', remaining)
    put(P / 'case-coverage.json', {'at': stamp, 'sourceFingerprint': SOURCE, 'auditCases': 107, 'originalAuditFieldsPreserved': True, 'newResultCasesChangedThisTurn': ['UC-R04'], 'wholeCurrentCasesAccepted': [], 'D15AndLegacyMemoryRowsUnchanged': ['UC-C18', 'UC-A51', 'UC-A11'], 'cases': cases, 'remaining': ref(P / 'remaining-acceptance.json'), 'review': ref(P / 'review.json')})
    rollback = {'at': stamp, 'scope': 'Selective local verification metadata only; application/SQL/C2 bytes unchanged and no physical data/schema action.', 'before': checkpoint['files'], 'afterIntegrity': 'docs/verification/D19-migration-preservation-integrity.json', 'instructions': ['Verify exact after-hashes and preserve later/user edits before any selective restoration from these exact before copies.', 'Preserve all earlier artifacts, logs, incident records and seals. Do not reset/clean the worktree.', 'No runtime data rollback applies. Do not stop/delete/rebuild targets, delete fixtures, rewrite history or guess original campaign values.', 'Restoring an older label does not prove migration acceptance or close the original incident.'], 'physicalDataOrSchemaRollback': 'NONE_APPLICABLE_NO_TARGET_ACTIONS', 'incidentOpen': True, 'restored': False, 'releaseHold': True, 'providerEnabled': False}
    put(P / 'rollback.json', rollback)
    delivery = {'at': stamp, 'status': 'PASS_LOCAL_MIGRATION_SCOPE_RECONCILIATION_NOT_RUNTIME_ACCEPTANCE', 'tasks': ['D02', 'D19'], 'sourceFingerprint': SOURCE, 'code': 'Application788/SQL73, protected manifest and pending C2 unchanged; local verification artifacts and metadata only.', 'test': 'File hashes/source assertions and retained native evidence inspected; no new application or memory suite. Retained current Node22 full2129/0/363 and separate legacy memory7/0/0 remain at their original bindings.', 'runtime': 'No target/client/engine/Auth/session/fixture/migration/provider operation. C2 runtime remains unapproved/not run; planned current nonempty73 comparison is now mapped accurately.', 'review': ref(P / 'review.json'), 'facts': ref(P / 'migration-provenance.json'), 'remaining': ref(P / 'remaining-acceptance.json'), 'caseCoverage': ref(P / 'case-coverage.json'), 'rollback': ref(P / 'rollback.json'), 'c2Manifest': ref(V / 'D19-C2-application-runtime-manifest.json'), 'priorDelivery': ref(V / 'D19-legacy-sql-memory-20261026/delivery.json'), 'c2SourceManifestApprovalUnchanged': True, 'c2ApprovalPending': True, 'newTargetsRequestedOrApproved': 0, 'actualTargetCalls': 0, 'databaseEnginesCreated': 0, 'newTestRuns': 0, 'formalMembershipOrRoleWrites': 0, 'productionWrites': 0, 'providerCalls': 0, 'incidentOpen': True, 'restored': False, 'releaseHold': True, 'providerEnabled': False, 'wholeR1Verified': False, 'deployment': 'NOT_DEPLOYED', 'commit': None, 'push': False, 'merge': False, 'blockers': remaining['blockers'], 'nextTask': remaining['nextTask'], 'changedThisTurn': ['docs/verification/D19-migration-preservation-20261026/', 'docs/verification/D19-migration-preservation-integrity.json', 'docs/verification/adfocate-delivery.json', 'docs/verification/audit_case_coverage.csv', 'docs/verification/implementation_backlog.csv', 'docs/verification/adfocate-task-ledger.md', 'docs/verification/evidence-integrity.json']}
    put(P / 'delivery.json', delivery)
    (P / 'delivery.md').write_text('''# D02／D19 migration preservation 覆核 — 2026-10-26

本輪完成唯讀本機證據覆核，沒有新的 application／SQL 修改、測試 suite 或 runtime 操作。

- 舊 C1 baseline72 的 raw hashes 全部與當前 source 相符；protected manifest43 及舊 shaped36 的 LF hashes 亦全部相符。Full baseline 和 protected forward manifest 範圍不同，不能互相替代。
- 舊 shaped replay 只直接比較一筆 legacy submission 的 status 和 content_urls[0]；沒有保存完整 before／after row snapshot，也沒有證明非空 proof／ledger cohort 保留。14筆 oldHistory 是事前讀回變數，不能冒作獨立 after-history 證據。
- 舊 C1 最終三個 phase、每個70 families 的 sealed inventory 合計有7筆 submissions、4個 workflows、6次 URL proof attempts／reviews、4筆 pending reward，以及 points／cash／budget ledger 各2筆。這是 e839 時的歷史直接檔案證據，不是本輪 live state 或 migration73 結果。Draft/proof assets 與 storage objects 均0，不能聲稱 binary bytes 已保留。
- 當前 C2 runner 已在 forward73 後、建立 SDK client 或新 fixture 前，比較原有70 families 的完整 inventory 及9類全域財務 ID／row hashes，並核對 catalog／history／ACL／immutable seeds。這是 source 直接證據，runtime 仍未批准或執行。

因此，原 remaining list 的「只唯讀／沒有 migration」描述已修正：不重播原72 migrations／9 compatibility statements，但待批 C2 明確包含一次 forward73 及非空資料保留比較。今輪沒有要求另一個 target，也沒有擴大 C2 批准範圍或重問已完成696e批准。

UC-R04 只更新新結果欄，明確保留 whole-current-case NOT_VERIFIED。107個原欄、D15 UC-C18／A51 及上一輪 UC-A11 整行均保留。現有48項相關 native assertions 從同 source 的 full report 核對；未重跑，也不新增到2129 full 或獨立 memory7計數。

重現本機證據檢查：

```powershell
python docs/verification/D19-migration-preservation-20261026/verify-preservation.py
```

scope-red.json／scope-green.json 記錄的是文件驗收範圍檢查前後，不是產品 RED／GREEN 或 DB 測試。最初一次臨時唯讀 helper 使用 Windows CP950 預設解碼，在讀檔階段失敗；修正為明確 UTF-8，沒有資料操作，未列作產品失敗。

下一步仍是現有 exact C2 manifest 待明確批准；獲批後，必須先做 fresh identity／provenance，任何 drift 都停止依賴動作，不猜值還原。只有實際73 before／after成功證據才能支持該 migration window。其他 R1 asset、cross-Creator、legacy API／併發／score／UI、GATE14 等缺口，以及 D15、具名 advisor／裝置／hosted、正式 staff、audit ZIP blocker 保留。

Rollback 只涵蓋本機 exact-before 文件。未做 DB down／reset、舊 binary redeployment 或資料還原；事故 OPEN／未還原，舊 shaped 鑑證用途不變。release HOLD，provider disabled，未 commit／push／merge／deploy。
''', encoding='utf-8', newline='\n')
    tasks = rows(V / 'implementation_backlog.csv')
    for row in tasks:
        if row['task_id'] not in ['D02', 'D19']: continue
        row['newResult'] += '; local migration preservation scope reconciled: raw72/protected43/shaped36 match, UC-R04 current full acceptance still missing'
        row['testStatus'] += ' File-only provenance and48 retained native assertions inspected; no new suite or engine.'
        row['runtimeStatus'] += ' Existing pending C2 includes forward73 nonempty-data comparison before client/setup; static only, not executed. No new target requested or approved.'
        row['evidence'] += ';D19-migration-preservation-20261026/delivery.json;D19-migration-preservation-20261026/migration-provenance.json'
    put_csv(V / 'implementation_backlog.csv', tasks)
    with (V / 'adfocate-task-ledger.md').open('a', encoding='utf-8', newline='\n') as f:
        f.write('\n\n### D02/D19 nonempty migration preservation evidence review — 2026-10-26\n\nCode:788 application records/73 SQL/C2 unchanged. Test: file-only raw72/protected LF43/shaped LF36 match;48 existing native assertions retained, no new suite. Deployment:not deployed; no commit/push/merge. Runtime:no target/client/engine/setup or data changes. UC-R04 full case remains unverified; pending frozen C2 already includes original70-family/nine financial comparisons immediately after forward73 and before SDK/setup. No new target requested or authorized. Old shaped witness only URL/status; binary cohort0. Incident OPEN/HOLD/provider disabled. Evidence and exact-before rollback: D19-migration-preservation-20261026/delivery.json.\n')
    main = read(V / 'adfocate-delivery.json'); main['updatedAt'] = stamp
    main['D19MigrationPreservationReview'] = delivery
    main['currentRecordAuthority'].update(currentSummary=rel(P / 'delivery.json'), currentCaseCoverage=rel(P / 'case-coverage.json'), checker=rel(P / 'verify-preservation.py'), currentSupplementGates=rel(P / 'verification-summary.json'))
    main['caseResults'] = cases; main['caseCoverageSummary']['details'] = rel(P / 'case-coverage.json')
    main['caseCoverageSummary']['migrationPreservationReview'] = rel(P / 'review.json')
    main['runtimeStatus'] = delivery['runtime']; main['rollback'] = rel(P / 'rollback.json')
    main['nextTask'] = remaining['nextTask']
    main['remainingRisks'] = remaining['blockers'] + [g['id'] + ': ' + g.get('status', 'MISSING_ACCEPTANCE') for g in remaining['remainingCaseGroups'] if not g.get('status', '').startswith('RESOLVED')]
    main['verificationLimit'] = 'Current788 source unchanged; native2129 full and separate memory7 retained. New work is file-only migration evidence reconciliation, not current nonempty73/Auth/RLS/browser acceptance. Historical data/cohort and pending runner assertions cannot prove runtime. WholeR1 not verified.'
    main['changedFiles'] = sorted(set(main['changedFiles'] + delivery['changedThisTurn']))
    main['evidenceIntegrity'].update(taskSubset='docs/verification/D19-migration-preservation-integrity.json', checker=rel(P / 'verify-preservation.py'))
    main['finalDeliveryReview'] = {'status': delivery['status'], 'machineReadable': rel(P / 'delivery.json'), 'report': rel(P / 'delivery.md'), 'taskCount': 20, 'auditCases': 107, 'findings': 28, 'wholeCurrentR1Verified': False, 'originalIncidentOpen': True, 'releaseHold': True, 'providerEnabled': False, 'canDeploy': False, 'canEnablePilot': False, 'retainedLegacyMemoryEvidence': 'D19-legacy-sql-memory-20261026/delivery.json', 'currentEvidence': rel(P / 'delivery.json')}
    for task in main['taskResults']:
        if task['task'] not in ['D02', 'D19']: continue
        task.setdefault('followupResults', []).append({'id': 'MIGRATION_PRESERVATION_REVIEW_20261026', 'newResult': {key: delivery[key] for key in ['code', 'test', 'runtime', 'deployment']}, 'evidence': rel(P / 'delivery.json'), 'wholeCurrentCaseVerified': False})
        task['evidence'].append(rel(P / 'delivery.json'))
    put(V / 'adfocate-delivery.json', main)
    print(json.dumps({'status': 'PREPARED_LOCAL_MIGRATION_REVIEW_NOT_SEALED', 'sourceUnchanged': 788, 'caseUpdated': 'UC-R04', 'actualTargetCalls': 0, 'newTargetsRequested': 0}))
elif sys.argv[1] == 'seal':
    assert (P / 'verification-summary.json').exists()
    shutil.copyfile(Path(__file__), P / 'prepare-delivery.py')
    subset = V / 'D19-migration-preservation-integrity.json'
    if not subset.exists(): put(subset, {})
    all_files = sorted(p for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json')
    main = read(V / 'adfocate-delivery.json'); main['evidenceIntegrity']['records'] = len(all_files); put(V / 'adfocate-delivery.json', main)
    changed = [R / item['path'] for item in checkpoint['files'] if not item['path'].endswith('evidence-integrity.json') and sha(R / item['path']) != item['sha256']]
    selected = sorted(set(changed + [p for p in P.rglob('*') if p.is_file()]))
    def entries(files): return [{'path': rel(p), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in files]
    put(subset, {'at': stamp, 'codeFingerprint': SOURCE, 'method': 'Exact raw hashes of this file-only migration review and changed metadata; exclude this subset/root seal. Previous2171 records preserved via exact before images.', 'files': entries(selected)})
    put(V / 'evidence-integrity.json', {'createdAt': stamp, 'codeFingerprint': SOURCE, 'method': 'Exact raw SHA256 for every verification file; exclude only this root seal. All prior snapshots, artifacts and seals retained.', 'files': entries(all_files)})
    print(json.dumps({'status': 'SEALED_LOCAL_MIGRATION_SCOPE_REVIEW', 'records': len(all_files), 'subset': len(selected), 'actualTargetCalls': 0}))
else: raise SystemExit('Use prepare or seal')
