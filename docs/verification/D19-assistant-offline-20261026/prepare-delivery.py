from pathlib import Path
import csv, datetime, hashlib, io, json, shutil, sys
R = Path.cwd(); V = R / 'docs/verification'; P = V / 'D19-assistant-offline-20261026'
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
for item in before.values(): assert sha(R / item['before']) == item['sha256']
for name in ['code-fingerprint.json','D19-C2-application-runtime-manifest.json','D19-application-runtime-preparation-20261025/runtime-authorization.json']:
    assert sha(V / name) == before['docs/verification/' + name]['sha256']
source = read(V / 'code-fingerprint.json'); assert source['fingerprint'] == SOURCE and len(source['files']) == 788
for item in source['files']: assert hashlib.sha256((R / item['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest() == item['sha256']
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
if sys.argv[1] == 'prepare':
    assert not (P / 'delivery.json').exists(), 'One-shot; never overwrite delivery history'
    for item in before.values(): assert sha(R / item['path']) == item['sha256'], item['path']
    main = read(V / 'adfocate-delivery.json')
    assert all(isinstance(t['evidence'],list) for t in main['taskResults'] if t['task'] in ['D16','D19'])
    test = read(P / 'boundary-path-fixed-command.json'); lint = read(P / 'boundary-lint-command.json'); types = read(P / 'boundary-type-command.json')
    assert test['exit'] == lint['exit'] == types['exit'] == 0
    native = read(P / 'boundary-path-fixed-native.json'); actual = read(P / 'boundary-path-fixed-readback.json')
    assert native['success'] is True and native['numPassedTests'] == 8 and native['numFailedTests'] == native['numPendingTests'] == 0
    assert len(actual['observations']) == 8
    shutil.copyfile(R / '.codex-tmp/D19-assistant-offline-run.py', P / 'run-offline-verification.py')
    summaries = [{'test': o['test'], 'httpMethods': [r['method'] for r in o['trace']['requests']], 'httpStatuses': [r['status'] for r in o['trace']['requests']], 'requests': o['trace']['requests'], 'mockProviderChatCalls': len(o['trace']['chats']), 'rpcDispatchNames': o['trace']['rpc'], 'historyQueries': o['trace']['history'], 'scriptedRequestEntries': o['scriptedEntries'], 'scriptedMessages': o['scriptedMessages'], 'actualProviderCalls': o['trace']['realProviderCalls'], 'deniedExternalFetchAttempts': o['trace']['deniedExternalFetch']} for o in actual['observations']]
    put(P / 'readback-summary.json', {'at': stamp, 'sourceFingerprint': SOURCE, 'verificationArtifactFingerprint': test['verificationArtifactFingerprint'], 'cases': summaries, 'fullTrace': ref(P / 'boundary-path-fixed-readback.json'), 'persistenceScope': 'Scripted process-memory store only; never physical/SQL persisted-state evidence or pending reward neutrality.', 'identity': actual['identity'], 'systemPromptOmittedFromPublicTrace': True})
    references = [P / n for n in ['boundary-initial-command.json','boundary-initial-native.json','boundary-initial.log','boundary-path-fixed-command.json','boundary-path-fixed-native.json','boundary-path-fixed.log','boundary-path-fixed-readback.json','boundary-lint-command.json','boundary-lint.log','boundary-type-command.json','boundary-type.log','tsconfig.offline.json']]
    references += [V / 'D19-application-runtime-preparation-20261025/supplement-full-final.json', V / 'D19-legacy-sql-memory-20261026/memory-readback-final-command.json']
    gates = {'at': stamp, 'sourceFingerprint': SOURCE, 'sourceFilesUnchanged': 788, 'verificationArtifactFingerprint': test['verificationArtifactFingerprint'], 'standaloneArtifacts': test['verificationArtifacts'], 'newStandalone': {'passed':8,'failed':0,'skipped':0,'files':1,'nativeReport':ref(P / 'boundary-path-fixed-native.json'),'command':test['command'],'node':test['node'],'vitest':read(R / 'node_modules/vitest/package.json')['version']}, 'lint': {'exit':0,'command':lint['command']}, 'type': {'exit':0,'command':types['command'],'configuration':types['additionalConfiguration']}, 'retainedNativeFull': {'passed':2129,'failed':0,'skipped':363,'files':292,'rerun':False}, 'retainedLegacyMemory': {'passed':7,'failed':0,'skipped':0,'rerun':False}, 'countsMustRemainSeparate':True, 'initialRun': {'exit':1,'caseAssertionsPassed':8,'suiteFailed':True,'classification':'Verification output-path failure, not a product behavior RED. Vitest transformed import.meta.url and writer attempted a nonexistent C:/docs path; no file written there. Fixed only reporter path/trace metadata and reran identical eight case assertions.', 'preserved':ref(P / 'boundary-initial-command.json')}, 'resourcePolicy':'Fresh physical and commit>=3GiB before each child; exact readings in receipts. No install, dotenv, provider or network credential/preload inheritance.', 'scope':'Actual UI/hook/apiFetch/Hono/RAG/tools plus scripted Auth/storage and injected provider. No actual SQL, Auth/RLS, independent-instance quota, browser/device or model-quality acceptance.', 'diagnostic':'One console-only inspection helper hit Windows CP950 UnicodeEncodeError while displaying a Vitest glyph; raw logs/receipts were unaffected and read with explicit UTF-8/ASCII JSON afterward.', 'references':[ref(p) for p in references]}
    put(P / 'gates.json', gates)
    previous = read(V / 'D19-migration-preservation-20261026/remaining-acceptance.json'); remaining = dict(previous)
    remaining['at'] = stamp; remaining['previousReview'] = ref(V / 'D19-migration-preservation-20261026/remaining-acceptance.json')
    remaining['nextTask'] = 'D19: existing exact C2 application runtime still awaits its pending explicit approval; no new source/manifest or extra target is required by these offline tests. Independently complete applicable GATE14 evidence review. Assistant8 strengthens UI/API/mock facets only; actual browser/Auth/RLS/shared-quota/model-quality boundaries and the other asset/Creator-isolation/legacy gaps remain explicit.'
    for group in remaining['remainingCaseGroups']:
        if group['id'] != 'ASSISTANT-LAYER-REVIEW': continue
        group.update(knownEvidence='Current source: standalone8/0/0 passes through actual Launcher/Panel/useAssistantChat/apiFetch/Hono route/RAG/tool dispatch, with scripted Auth/storage and injected mock provider; lint and isolated type-check pass. Explicit 429 UUID reuse, scoped chronological history, history503, unknown request GET and lost-save-response reconciliation are recorded. Original unit/embedded/C1 CORE7 witnesses retain their own bindings.', missing='Actual browser/device interaction, real current-target Auth/RLS/ownership/persistence and independent-instance quota. Scripted save/claim/replay is not DB atomicity. No cross-close/navigation/refresh draft or conversation restoration is proven. Mock answers/citations or unknown-tool denial are not a real model hallucination/quality or cost evaluation; provider stays disabled.', next='Retain current-source offline traces and unchanged C2. Do not execute assistant requests under applications-only C2 or completed696e authority. Any actual additional runtime must have explicit bounded session/request/fixture/provider scope; paid AI remains excluded.', status='CURRENT_OFFLINE_UI_API_BOUNDARY8_PASS; REAL_AND_MODEL_ACCEPTANCE_LIMITS_RETAINED', offlineEvidence=ref(P / 'gates.json'), readbacks=ref(P / 'readback-summary.json'), wholeCurrentCaseVerified=False, actualProviderEvaluation='NOT_RUN_DISABLED')
    put(P / 'remaining-acceptance.json', remaining)
    cases = rows(V / 'audit_case_coverage.csv')
    for row in cases:
        if row['case_id'] not in ['UC-C19','UC-Q04','UC-Q05']: continue
        row['newResult'] = 'PARTIAL_CURRENT_OFFLINE_UI_API_AND_HISTORICAL_EVIDENCE; CURRENT_FULL_CASE_NOT_VERIFIED'
        row['testStatus'] += ' | Standalone offline8/0/0 with actual UI/hook/apiFetch/Hono/RAG/tool code; scripted Auth/storage, injected mock provider. Lint and isolated type-check pass. Separate from retained full2129 and memory7.'
        row['runtimeStatus'] = 'NO_REAL_TARGET_OR_PROVIDER_ACCEPTANCE. Current offline process verifies open/close/focus, saved conversation history order,429 input+UUID retry,history503,unknown outcome GET,lost-save-response status reconciliation,and unsupported write-tool/default mission-assist denial. SDK/Auth/storage/provider mocks explicitly labelled; zero physical SQL/targets/provider calls.'
        row['newEvidence'] += ';D19-assistant-offline-20261026/gates.json;D19-assistant-offline-20261026/readback-summary.json;D19-assistant-offline-20261026/boundary-path-fixed-native.json'
        row['limitations'] += ' | Scripted store is not actual persistence/atomic quota/RLS. No browser/device, cross-close/navigation/refresh restoration, real model quality/hallucination/cost evaluation or pending financial neutrality. Original audit semantics and D15 blockers unchanged; no whole-case waiver.'
    put_csv(V / 'audit_case_coverage.csv', cases)
    put(P / 'case-coverage.json', {'at':stamp,'sourceFingerprint':SOURCE,'auditCases':107,'originalAuditFieldsPreserved':True,'changedNewEvidenceCases':['UC-C19','UC-Q04','UC-Q05'],'wholeCurrentCasesAccepted':[],'D15LegacyAndMigrationRowsUnchanged':['UC-C18','UC-A51','UC-A11','UC-R04'],'cases':cases,'gates':ref(P / 'gates.json'),'remaining':ref(P / 'remaining-acceptance.json')})
    put(P / 'rollback.json', {'at':stamp,'scope':'Local verification artifacts and metadata only. Application/runtime/SQL/C2 unchanged; no physical data/schema write to reverse.','before':checkpoint['files'],'afterIntegrity':'docs/verification/D19-assistant-offline-integrity.json','instructions':['Verify exact after-hashes and preserve later/user edits before selective metadata restoration from these exact before copies.','Preserve initial/final logs, source revisions, incidents and historical seals. Do not reset/clean dirty checkout.','Standalone test/config stays outside native full discovery and C2 runtime. No target/Auth/fixture cleanup, role repair, container lifecycle or database rollback is authorized.','Restoring an older result label does not prove acceptance or undo the campaign incident.'],'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False})
    delivery = {'at':stamp,'status':'PASS_OFFLINE_ASSISTANT_UI_API_BOUNDARY_NOT_FULL_R1_ACCEPTANCE','tasks':['D16','D19'],'sourceFingerprint':SOURCE,'sourceRecordsUnchanged':788,'code':'Application/SQL/C2 unchanged. Added standalone verification artifacts; existing assistant engines exercised.','test':'Standalone8/0/0 plus lint/type pass. Retained native2129/0/363 and legacy memory7/0/0 remain separate, not rerun. Initial evidence-writer failure retained; no product behavior repair.','runtime':'Actual React/Query/API/Hono/RAG/tool code in one offline process; scripted memory Auth/storage and mock provider only. No actual target/SDK/SQL/provider request.','standalonePassed':8,'gates':ref(P / 'gates.json'),'readbacks':ref(P / 'readback-summary.json'),'caseCoverage':ref(P / 'case-coverage.json'),'remaining':ref(P / 'remaining-acceptance.json'),'rollback':ref(P / 'rollback.json'),'c2Manifest':ref(V / 'D19-C2-application-runtime-manifest.json'),'priorDelivery':ref(V / 'D19-migration-preservation-20261026/delivery.json'),'c2SourceManifestApprovalUnchanged':True,'c2ApprovalPending':True,'actualTargetCalls':0,'actualSdkClients':0,'physicalSqlCalls':0,'productionWrites':0,'formalMembershipOrRoleWrites':0,'actualProviderCalls':0,'pendingNeutralityMeasured':False,'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False,'deployment':'NOT_DEPLOYED','commit':None,'push':False,'merge':False,'blockers':remaining['blockers'],'nextTask':remaining['nextTask'],'changedThisTurn':['docs/verification/D19-assistant-offline-20261026/','docs/verification/D19-assistant-offline-integrity.json','docs/verification/adfocate-delivery.json','docs/verification/audit_case_coverage.csv','docs/verification/implementation_backlog.csv','docs/verification/adfocate-task-ledger.md','docs/verification/evidence-integrity.json']}
    put(P / 'delivery.json', delivery)
    (P / 'delivery.md').write_text('''# D16／D19 assistant 離線邊界補驗 — 2026-10-26

本輪 standalone **8/8、exit0**，指定 lint 及獨立 TypeScript 檢查亦通過。沿用實際 Launcher／Panel／useAssistantChat／apiFetch／Hono route／RAG／tool dispatch；只將 Auth/session、DB transport 及 provider 換成明確 scripted mocks。App/runtime788 source、73 SQL 及待批 C2 manifest／批准檔案均不變。

| 情境 | 實際離線觀察 |
| --- | --- |
| 開啟／Shift-Tab focus trap／Escape 關閉／重開 | 焦點進入輸入框並回到 launcher；沒有 HTTP 或 provider request |
| 第二個問題 | saved conversation ID 經實際 helper/route 傳遞；history descending timestamp/turn-order limit20，還原成 chronological user/assistant 次序送到 mock provider |
| 429 後明確重試 | 保留輸入及同一 request UUID；429→200，只生成1次 |
| history503 | 已載入內容及新輸入保留；同 request 重試202，不自動重新生成。這不證明真實 DB lease／恢復時間 |
| provider unknown outcome | POST503→GET200 查同一 request；只呼叫 mock provider1次，沒有自動 POST |
| 保存回應遺失 | 首先顯示未確認保存並保留輸入；GET 查回 scripted saved 結果，移除未確認版本、只顯示1個答案；沒有第二次生成 |
| 不支援的 reward／role tool | 真正 dispatcher 回 unknown tool；只派送 request/claim/KB/save RPC，沒有財務或 access command。這不是 model quality 評估 |
| 未注入 provider 的 mission-assist | 503 assist_disabled、not_started；DB factory/provider call0 |

真實 provider spies 及外部 fetch guards 都記錄0次觸發；沒有 actual SDK client、SQL、Auth subjects、target 或資料修改。Provider 模式由測試 dependency injection 指定，dotenv及繼承 credentials/preloads 均停用。執行前先核對 in-process descriptor，沒有以 localhost 或測試名稱冒作隔離身份。

首輪八個 case assertions 通過，但 afterAll 的 import.meta.url 被 Vitest 轉換，writer 嘗試不存在的 C:/docs 路徑而失敗，整個 suite 仍是 exit1。只修正 reporter 路徑及公開 trace，保留首輪 source revision／log／JSON，重跑相同八項後取得 exit0；沒有將這次輸出錯誤當作產品 RED 或忽略 suite failure。

Native full **2129/0/363（292 files）** 與上一輪 legacy memory **7/0/0** 保留原 binding，今輪未重跑；不能把獨立8項加成新的 full-suite count。Commands、Node22／Vitest版本、fresh physical/commit RAM readings、terminal receipts、readbacks及 source hashes 在 gates.json／readback-summary.json。

可重現（worktree root；使用新的 label 保留 receipt）：

```powershell
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py test boundary-review-next
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py lint boundary-lint-next
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py type boundary-type-next
python docs/verification/D19-assistant-offline-20261026/verify-assistant.py
```

本輪只補 UC-C19／UC-Q04／UC-Q05 新層，107個原欄及 D15／上一輪 UC-A11、UC-R04 整行不變。Scripted store 不能代替真實 DB 原子性、RLS、跨 instance quota、browser／device、跨關閉／導覽／refresh 的草稿或對話還原，以及真實模型的來源／幻覺／成本評估；不是完整案例或 R1 verified。沒有測 pending reward 財務 neutrality。

C2 仍待原 exact manifest 批准，原696e批准不重問或重播。D15、具名 advisor owner／裝置／hosted、正式 staff、audit ZIP 及其他 R1 gaps 保留。事故 OPEN／未還原，舊 shaped 鑑證用途不變；release HOLD，真實 provider disabled，未 commit／push／merge／deploy。Rollback 只涉及 exact-before 本機文件，沒有物理資料／schema rollback。
''',encoding='utf-8',newline='\n')
    tasks = rows(V / 'implementation_backlog.csv')
    for row in tasks:
        if row['task_id'] not in ['D16','D19']: continue
        row['newResult'] += '; current offline assistant UI/API boundary8 pass; full current cases remain unverified'
        row['testStatus'] += ' Standalone8/0/0 plus lint and isolated type-check; counts separate from retained native2129 and legacy memory7.'
        row['runtimeStatus'] += ' Actual UI/API/route with scripted Auth/storage and mock provider; no real targets/SDK/SQL/provider. C2 unchanged/pending.'
        row['evidence'] += ';D19-assistant-offline-20261026/delivery.json;D19-assistant-offline-20261026/gates.json'
    put_csv(V / 'implementation_backlog.csv', tasks)
    with (V / 'adfocate-task-ledger.md').open('a',encoding='utf-8',newline='\n') as f:
        f.write('\n\n### D16/D19 assistant offline UI/API boundary — 2026-10-26\n\nCode:app/runtime788,SQL73,C2 unchanged; standalone test artifacts only. Test:8/0/0 plus lint/type pass, separate from retained full2129/0/363 and legacy memory7. Initial evidence-writer exit1 preserved. Deployment:not deployed; no commit/push/merge. Runtime:actual React/Query/apiFetch/Hono/RAG/tool code with scripted Auth/DB and injected mock provider; no real SDK/SQL/targets/provider. UC-C19/Q04/Q05 remain partial; no real model-quality/DB-atomicity/RLS/browser/quota acceptance. Incident OPEN/HOLD/provider disabled. Exact-before rollback and evidence: D19-assistant-offline-20261026/delivery.json.\n')
    main['updatedAt'] = stamp; main['D19AssistantOfflineVerification'] = delivery
    main['currentRecordAuthority'].update(currentSummary=rel(P / 'delivery.json'),currentCaseCoverage=rel(P / 'case-coverage.json'),checker=rel(P / 'verify-assistant.py'),currentSupplementGates=rel(P / 'gates.json'))
    main['caseResults'] = cases; main['caseCoverageSummary'].update(details=rel(P / 'case-coverage.json'),assistantOfflineEvidence=rel(P / 'gates.json'))
    main['testStatus'] += ' Separate assistant offline8/0/0 plus lint/type pass; no native full or legacy memory rerun.'
    main['runtimeStatus'] = delivery['runtime']; main['rollback'] = rel(P / 'rollback.json'); main['nextTask'] = remaining['nextTask']
    main['remainingRisks'] = remaining['blockers'] + [g['id']+': '+g.get('status','MISSING_ACCEPTANCE') for g in remaining['remainingCaseGroups'] if not g.get('status','').startswith('RESOLVED')]
    main['verificationLimit'] = 'Current788 source unchanged; retained native2129 and legacy memory7 plus separate offline assistant8. Scripted storage is not actual DB persistence, RLS, shared quota, browser/device or provider evaluation. C2 runtime remains pending. WholeR1 not verified.'
    main['changedFiles'] = sorted(set(main['changedFiles']+delivery['changedThisTurn']))
    main['evidenceIntegrity'].update(taskSubset='docs/verification/D19-assistant-offline-integrity.json',checker=rel(P / 'verify-assistant.py'))
    main['finalDeliveryReview'] = {'status':delivery['status'],'machineReadable':rel(P / 'delivery.json'),'report':rel(P / 'delivery.md'),'taskCount':20,'auditCases':107,'findings':28,'wholeCurrentR1Verified':False,'originalIncidentOpen':True,'releaseHold':True,'providerEnabled':False,'canDeploy':False,'canEnablePilot':False,'currentEvidence':rel(P / 'delivery.json')}
    for task in main['taskResults']:
        if task['task'] not in ['D16','D19']: continue
        task.setdefault('followupResults',[]).append({'id':'ASSISTANT_OFFLINE_20261026','newResult':{key:delivery[key] for key in ['code','test','runtime','deployment']},'evidence':rel(P / 'delivery.json'),'wholeCurrentCaseVerified':False})
        task['evidence'].append(rel(P / 'delivery.json'))
    put(V / 'adfocate-delivery.json',main)
    print(json.dumps({'status':'PREPARED_ASSISTANT_OFFLINE_DELIVERY_NOT_SEALED','standalonePassed':8,'sourceUnchanged':788,'actualTargetCalls':0}))
elif sys.argv[1] == 'seal':
    assert (P / 'verification-summary.json').exists()
    shutil.copyfile(Path(__file__), P / 'prepare-delivery.py')
    subset = V / 'D19-assistant-offline-integrity.json'
    if not subset.exists(): put(subset,{})
    all_files = sorted(p for p in V.rglob('*') if p.is_file() and p != V / 'evidence-integrity.json')
    main = read(V / 'adfocate-delivery.json'); main['evidenceIntegrity']['records'] = len(all_files); put(V / 'adfocate-delivery.json',main)
    changed = [R / item['path'] for item in checkpoint['files'] if not item['path'].endswith('evidence-integrity.json') and sha(R / item['path']) != item['sha256']]
    selected = sorted(set(changed+[p for p in P.rglob('*') if p.is_file()]))
    def entries(files): return [{'path':rel(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
    put(subset,{'at':stamp,'codeFingerprint':SOURCE,'method':'Raw hashes of current standalone assistant verification and changed metadata; exclude this subset/root seal. Prior2196 records retained via exact before images.','files':entries(selected)})
    put(V / 'evidence-integrity.json',{'createdAt':stamp,'codeFingerprint':SOURCE,'method':'Exact raw SHA256 of every verification file; exclude only this root seal. Historical artifacts, logs, source revisions and before images retained.','files':entries(all_files)})
    print(json.dumps({'status':'SEALED_OFFLINE_ASSISTANT_EVIDENCE','records':len(all_files),'subset':len(selected),'actualTargetCalls':0}))
else: raise SystemExit('Use prepare or seal')
