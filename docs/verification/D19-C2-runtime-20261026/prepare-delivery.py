from pathlib import Path
import csv, datetime, difflib, hashlib, io, json, shutil, subprocess, sys

R = Path.cwd(); V = R / 'docs/verification'; P = V / 'D19-C2-runtime-20261026'; Q = V / 'D19-C2-transport-preparation-20261026'
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p): return Path(p).relative_to(R).as_posix()
def ref(p): return {'path':rel(p),'sha256':sha(p)}
def put(p,j): Path(p).write_text(json.dumps(j,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
def rows(p):
    with Path(p).open(encoding='utf-8-sig',newline='') as f: return list(csv.DictReader(f))
def put_rows(p,data):
    s=io.StringIO(newline='');w=csv.DictWriter(s,fieldnames=list(data[0]),lineterminator='\n');w.writeheader();w.writerows(data);Path(p).write_text(s.getvalue(),encoding='utf-8',newline='\n')
def counts(tests):
    a=list(tests);return {'passed':sum(x['status']=='passed' for x in a),'failed':sum(x['status']=='failed' for x in a),'skipped':sum(x['status']in ['pending','skipped','todo'] for x in a),'total':len(a)}
def short_name(f): return f['name'].replace('\\','/').split('/adfocate-r1-20261023/')[-1]
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();source=read(V/'code-fingerprint.json');fp=source['fingerprint']
assert fp=='ead55a808470f90d72290905db90933cb4a6df48eaba519d4587339a4659b71d' and len(source['files'])==789
for f in source['files']: assert hashlib.sha256((R/f['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==f['sha256'],f['path']
checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for x in before.values():assert sha(R/x['before'])==x['sha256']
mode=sys.argv[1]
if mode=='prepare':
    assert not (P/'delivery.json').exists(), 'One-shot current delivery; preserve prior checkpoints'
    full=read(P/'transport-full-host-results.json');assert full['success'] and full['numFailedTests']==0
    raw=read(P/'transport-full-results.json');assert not raw['success'] and raw['numFailedTests']==13
    full_counts={'passed':full['numPassedTests'],'failed':full['numFailedTests'],'skipped':full['numPendingTests'],'files':len(full['testResults'])}
    assert full_counts=={'passed':2133,'failed':0,'skipped':363,'files':293}
    protected=read(V/'D19-application-runtime-preparation-20261025/gates.json')['protectedPaths']
    groups={
      'originalAudit16':counts(t for f in full['testResults'] if short_name(f).startswith('src/audit-tests/') for t in f['assertionResults']),
      'protected194':counts(t for f in full['testResults'] if short_name(f)in protected for t in f['assertionResults']),
      'supplement26':counts(t for f in full['testResults'] if short_name(f)=='server/test/application-supplement.test.ts' for t in f['assertionResults']),
      'transport4':counts(t for f in full['testResults'] if short_name(f)=='server/test/audit-docker-output-capture.test.ts' for t in f['assertionResults'])}
    for name,n in [('originalAudit16',16),('protected194',194),('supplement26',26),('transport4',4)]:assert groups[name]=={'passed':n,'failed':0,'skipped':0,'total':n}
    labels=['transport-green','transport-focused','transport-lint','transport-review','transport-host-boundaries','transport-full-host','transport-build','transport-lint-full','transport-schema-manifest']
    commands={}
    for label in labels:
        c=read(P/f'{label}-command.json');assert c['exit']==0 and c.get('sourceUnchangedAfter',True)
        commands[label]={'receipt':ref(P/f'{label}-command.json'),'resource':ref(P/f'{label}-resource.json'),'log':ref(P/f'{label}.log'),'command':c['command'],'node':c['node'],'sourceFingerprint':fp,'scope':'Local/offline, integration disabled; no C2 writer, Docker, physical DB or provider requested'}
    red=read(P/'transport-red-results.json');assert (red['numPassedTests'],red['numFailedTests'])==(2,2)
    failures=[];host={t['fullName']:t for f in full['testResults'] for t in f['assertionResults']}
    for f in raw['testResults']:
        for t in f['assertionResults']:
            if t['status']!='failed':continue
            assert host[t['fullName']]['status']=='passed'
            name=short_name(f)
            cause='Runner omitted explicit installed npm path for cached Node22' if name=='scripts/release/cli.test.ts' else 'Sandbox atomic rename EPERM' if name=='scripts/release/manifest.test.ts' else 'Sandbox denied test-owned loopback connection; dependent stream/abort assertions also failed'
            failures.append({'file':name,'test':t['fullName'],'initialStatus':'failed','classification':cause,'sourceOrAssertionChanged':False,'finalHostStatus':'passed'})
    put(P/'failure-reconciliation.json',{'at':stamp,'initial':ref(P/'transport-full-command.json'),'initialReport':ref(P/'transport-full-results.json'),'initialCounts':{'passed':2120,'failed':13,'skipped':363,'files':293},'failures':failures,'focusedHost':ref(P/'transport-host-boundaries-results.json'),'focusedHostPassed':32,'finalHost':ref(P/'transport-full-host-results.json'),'finalCounts':full_counts,'fixScope':'Local runner explicit installed npm_execpath; host-local test execution for loopback/temp rename. No product/test assertion change. Original failure retained.','notAnAutomaticApprovalReviewRejection':True})
    put(P/'gates.json',{'at':stamp,'sourceFingerprint':fp,'sourceRecords':789,'full':full_counts,**groups,'protectedPaths':protected,'commands':commands,'red':{'passed':2,'failed':2,'result':ref(P/'transport-red-results.json'),'command':ref(P/'transport-red-command.json'),'reason':'Actual old Docker capture helper loses complete2MiB and multibyte output with ENOBUFS; bounded-overflow and nonzero-child cases already pass.'},'green':{'passed':4,'failed':0,'result':ref(P/'transport-green-results.json')},'focused':{'passed':33,'failed':0,'result':ref(P/'transport-focused-results.json')},'retainedInitialFull':ref(P/'failure-reconciliation.json'),'currentNode24Full':'NOT_RUN','standaloneEarlierAssistant8AndMemory7':'Retained separately at their recorded source; not added to current native counts or rerun','integrationSkippedNotPass':363,'actualApplicationRuntime':'NOT_RUN_NEW_SOURCE_UNAPPROVED','warnings':'Four existing React hook warnings (0 errors) and the existing _site.smoke.test.tsx no-Route warning remain. Inspect full lint/build/review logs; warnings are not acceptance evidence.'})
    cases=rows(V/'audit_case_coverage.csv');oldcases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert cases==oldcases
    changed_cases=['UC-A06','UC-A10','UC-C25']
    for row in cases:
        if row['case_id']not in changed_cases:continue
        row['newResult']='APPROVED_E8_C2_STOPPED_PRECLAIM; LOCAL_TRANSPORT_FIX_PASS; NEW_SOURCE_RUNTIME_NOT_VERIFIED'
        row['codeStatus']+=' Bounded8MiB capture repair in the existing owner transport; business/RPC/UI/SQL sources unchanged.'
        row['testStatus']='Current Node22 full2133/0/363,293files; original audit16/protected194/supplement26/transport4 pass. Targeted33 pass, host-boundary32 pass, build/lint/schema-manifest pass. Initial full2120/13/363 and TDD2 RED retained with named dispositions.'
        row['runtimeStatus']='Original C2 was explicitly approved at e8 and attempted: default pipe identity denial, then full identity pass and ENOBUFS in first raw catalog provenance read before claim/migration/SDK/fixture. Independent identity-gated readonly checks preserve old70 families/catalog/state. Application API and3 UI scenarios remain NOT_RUN. New ead55 source runtime is not approved; no third writer invocation.'
        row['newEvidence']+=';D19-C2-runtime-20261026/delivery.json;D19-C2-runtime-20261026/gates.json;D19-C2-runtime-20261026/runtime-reconciliation.json;D19-C2-runtime-20261026/post-provenance-failure.json;D19-C2-transport-continuation-runtime-manifest.json'
        row['limitations']='All original behavior expectations remain required; no whole-case PASS. Read-only financial preservation is not application/pending-reward E2E neutrality. Old696e/pristine evidence retains its original source. D15/advisor owner/device/hosted/formal staff blockers, incident OPEN,release HOLD and provider disabled remain. New-source runtime needs its own exact digest approval; no production write, cleanup or deployment.'
    put_rows(V/'audit_case_coverage.csv',cases)
    original_columns=['case_id','title','primary_task','secondary_tasks','phase','original_audit_result','original_environment','expected','implementation_result','evidence_required','release_note']
    assert len(cases)==len(oldcases)==107
    for a,b in zip(cases,oldcases):assert all(a[k]==b[k]for k in original_columns)
    put(P/'case-coverage.json',{'at':stamp,'sourceFingerprint':fp,'auditCases':107,'originalAuditFieldsPreserved':True,'changedNewEvidenceCases':changed_cases,'wholeCurrentCasesAccepted':[],'D15RowsUnchanged':['UC-C18','UC-A51'],'groups':groups,'cases':cases,'remaining':ref(P/'remaining-acceptance.json')})
    next_task=read(P/'remaining-acceptance.json')['nextTask']
    manifest=V/'D19-C2-transport-continuation-runtime-manifest.json'
    delivery={'at':stamp,'status':'PASS_LOCAL_TRANSPORT_REPAIR_APPROVED_E8_RUNTIME_STOPPED_PRECLAIM_NEW_RUNTIME_UNAPPROVED','task':'D19','sourceFingerprint':fp,'sourceRecords':789,'head':'7cfa3dc84c821719a4dff754229a591c81786c53','code':'Existing Docker owner transport gains a bounded8MiB output buffer. Four native real-child regressions; all other787 prior sources unchanged, including73 migrations and all business/UI/identity/expiry assertions.','test':full_counts,'protectedGroups':groups,'gates':ref(P/'gates.json'),'runtime':'Approved original e8 C2 attempted twice and stopped before claim/migration/SDK/Auth/fixture. Full physical identity and subsequent read-only70-family/eight-section catalog/state preservation proven at recorded times. Current ead55 source has no application runtime approval or execution.','runtimeReconciliation':ref(P/'runtime-reconciliation.json'),'originalC2Approval':ref(P/'owner-approval.json'),'originalC2AuthorizationStillTrue':ref(V/'D19-application-runtime-preparation-20261025/runtime-authorization.json'),'proposedRuntimeManifest':ref(manifest),'proposedRuntimeAuthorization':ref(Q/'runtime-authorization.json'),'proposedRuntimeApproved':False,'localArchivesExecuted':False,'currentSourceWriterAttempts':0,'applicationApiScenariosExecuted':0,'applicationBrowserScenariosExecuted':0,'newAuthSubjectsCreated':0,'newDomainFixturesCreated':0,'migrationWrites':0,'dockerLifecycleActions':0,'productionOrFormalMembershipWrites':0,'providerCalls':0,'schema':ref(P/'schema-diff.json'),'financialReadonlyPreservation':ref(P/'financial-preservation.json'),'pendingRewardBusinessNeutralityThisTurn':'NOT_EXERCISED; read-only window only, prior696e result remains source-bound','caseCoverage':ref(P/'case-coverage.json'),'remaining':ref(P/'remaining-acceptance.json'),'rollback':ref(P/'rollback.json'),'blockers':read(P/'remaining-acceptance.json')['blockers'],'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False,'deployment':'NOT_DEPLOYED','commit':None,'push':False,'merge':False,'nextTask':next_task,'changedThisTurn':['scripts/audit/local-targets.mjs','server/test/audit-docker-output-capture.test.ts','docs/verification/D19-C2-runtime-20261026/','docs/verification/D19-C2-transport-preparation-20261026/','docs/verification/D19-C2-transport-continuation-runtime-manifest.json','docs/verification/D19-C2-runtime-integrity.json','docs/verification/code-fingerprint.json','docs/verification/adfocate-delivery.json','docs/verification/audit_case_coverage.csv','docs/verification/implementation_backlog.csv','docs/verification/adfocate-task-ledger.md','docs/verification/evidence-integrity.json','docs/verification/D19-application-runtime-preparation-20261025/runtime-authorization.json']}
    put(P/'delivery.json',delivery)
    (P/'delivery.md').write_text(f'''# D19 C2：停止紀錄及 transport 修復

原 C2 **已獲明確批准並已嘗試**，原批准收據仍為 true。首次在 sandbox 的 Docker pipe 身份查證失敗；同 source 的 host 續跑通過完整身份查證，但在第一個 provenance catalog SELECT 因 `ENOBUFS` 停止，未到 claim、migration、SDK、Auth 或 fixture。兩次 terminal exit1 及 private log hash 均保留，不把它們當通過驗收。

唯讀查證當時：72 migrations、84 Auth subjects、6 workspaces、6 missions；新 RPC、history、workspace、claim、owned journal 均不存在。原70類 row hashes、八節 catalog、immutable seeds/service history 保持相同。19次完成的唯讀 SQL 加1次輸出失敗的唯讀 catalog SELECT，不涉及資料寫入。兩個完整9類財務 readback 相同，這只是唯讀查證期間保留證據，**不是 application／pending reward E2E neutrality**。

真正 catalog 為1,106,880 bytes，超過 Node 預設1,048,576 bytes。只在既有 Docker owner transport 加有限8 MiB capture；SQL、身份／權限檢查、expiry、business／UI及73個 migrations 不變。新增 native4項，執行實際 private helper 與真正本機子程序：完整2 MiB JSON、multibyte完整性、9 MiB超額拒絕、child exit7拒絕；不呼叫 Docker／DB。

| 本輪驗證 | 結果 |
| --- | --- |
| TDD 原 helper | 2 expected fail／2 pass；ENOBUFS重現 |
| 修復後4項 | 4 pass |
| focused transport／C2／manifest | 33 pass |
| 原完整 sandbox run | 2120 pass／13 fail／363 skip；完整保留 |
| host boundary 4 files | 32 pass |
| 最後 Node22 native full | 2133 pass／0 fail／363 skip，293 files |
| 原 audit16／protected194／C2 supplement26 | 全數通過；不降低原語義 |
| build／lint／schema manifest | exit0；既有 warning 見 logs |

首跑13項逐項對照 final host PASS：9項為 test-owned loopback 權限／其依賴 assertion，2項為 temp atomic rename EPERM，2項為 cached Node22 runner 缺 installed npm_execpath。只修 runner設定及在 host 執行本機測試，沒有改 assertions。原失敗不是 auto-review rejection。363項 skipped integration不當 PASS。先前 standalone assistant8及memory SQL7維持各自 source binding，不加入 native總數，今輪未重跑。

Source `{fp}`（789檔）；保留 HEAD `7cfa3dc84c821719a4dff754229a591c81786c53` 及原 dirty work。新 source **未獲 runtime批准／未啟動 writer**；application API、3項 Edge情境、forward73、6個新Auth／1workspace／4missions均未執行。原696e／pristine已通過範圍沒有重跑。

下一步只審批 `../D19-C2-transport-continuation-runtime-manifest.json`，digest `{sha(manifest)}`。沿用原5個C1資源、fixture IDs及caps；新增資源0。需批准的額外本機處理僅是精確封存3個未消耗 receipt/result檔案，現在尚未移動。批准後仍先完整核實身份及唯讀 provenance，任何不一致即停，不自動重播。

`remaining-acceptance.json` 列出 application、binary asset、完整 cross-Creator、legacy同意圖 replay、nonempty migration、GATE14及未跑角色／browser facets。D15教材、具名 advisor owner／裝置／hosted／manual AT、正式staff限制保留；107個 original欄位及UC-C18／A51原期望不變。事故OPEN／未還原、舊shaped鑑證專用、release HOLD、provider disabled。**未部署，無commit／push／merge，非R1 verified。**

精確命令、Node22版本、fresh RAM、terminal receipts及逐項失敗處置見 `gates.json`／`failure-reconciliation.json`。Schema見 `schema-diff.json`，選擇性本機rollback見 `rollback.json`；不執行資料、schema、角色或container還原／清理。
''',encoding='utf-8',newline='\n')
    (Q/'review.md').write_text(f'''# C2 transport continuation：待批准

待批 manifest：`../D19-C2-transport-continuation-runtime-manifest.json`\n\nSHA-256：`{sha(manifest)}`\n\nSource：`{fp}`（789檔）。原批准e8／788檔的C2收據保持true；兩次嘗試均在業務寫入前停止，沒有用其批准冒充新source批准。

修復只有既有 Docker輸出 capture 上限8 MiB，加4個本機真實子程序測試。完整 native2133／0／363、audit16、protected194、supplement26、build／lint／schema check通過；失敗首跑及未測scope另見 `../D19-C2-runtime-20261026/delivery.md`。

批准範圍保持原C2：同一C1的5個既有資源，新增／停止／重建／刪除資源0；完整身份／provenance通過後，單一forward73、6個生成Auth、1workspace、4missions、2組新fixture專用fault trigger/function精確建立及移除、新OperatorA的4次fixture欄位切換、申請API及3個Edge情境、完整舊資料／財務row比對。只啟停本輪自己的Vite／Edge child。所有原fixture UUIDs、caps及SQL不變。

另需批准精確封存3個**未消耗本機檔案**：同namespace的 `supplement-target-receipt.private.json`、`identity.json`、`result.json` 移到各自 `transport-failure-preserved` 子目錄。Manifest逐一綁定原hash及目的地；先確認claim/journal不存在、目的地不存在及hash相同。沒有target資料刪除、沒有清除nonce或重播已開始的業務操作。此刻3項移動均未執行。

批准後仍須fresh full identity及原72／70類／catalog／seed／財務provenance。8 MiB不足、任何diff／未知寫入／缺失回應均停止保留證據，沒有自動第三次runtime重試。原696e role8/core9/browser5、pristine RPC、legacy發放不重跑，不新增支付或pending發放。

可直接決定：**批准此exact digest/source的有限續跑**，或**保留待批並只做獨立本機工作**。這不批准任何incident關閉、還原、production／正式staff修改、release/pilot啟用、provider、付款或commit／push／merge／deploy。D15、advisor owner／device／hosted及staff blockers維持；事故OPEN、HOLD、provider disabled。
''',encoding='utf-8',newline='\n')
    tasks=rows(V/'implementation_backlog.csv')
    for row in tasks:
        if row['task_id']!='D19':continue
        row['newResult']+='; original C2 approved but stopped before claim; bounded capture repaired; revised-source runtime pending'
        row['codeStatus']+=' Existing Docker capture8MiB +4 native regressions; business/SQL unchanged.'
        row['testStatus']+=' Fresh Node22 full2133/0/363; audit16/protected194/supplement26/transport4 pass; initial13 failures retained and resolved at local host boundaries.'
        row['runtimeStatus']+=' Approved e8 C2 identity/provenance stop; subsequent identity-gated readonly old70/catalog/state preserved; no new migration/fixture/API/browser or current-source writer. New manifest unapproved.'
        row['evidence']+=';D19-C2-runtime-20261026/delivery.json;D19-C2-runtime-20261026/gates.json;D19-C2-runtime-20261026/runtime-reconciliation.json'
    put_rows(V/'implementation_backlog.csv',tasks)
    with (V/'adfocate-task-ledger.md').open('a',encoding='utf-8',newline='\n')as f:
        f.write('\n\n### D19 C2 preclaim stop and bounded capture repair - 2026-10-26\n\nCode: existing owner transport bounded8MiB plus4 native real-child regressions;787 other sources/SQL unchanged. Test:2 expected RED,4 GREEN,focused33,host-boundary32,full2133/0/363 at789-source candidate; original16/194 preserved;build/lint/schema pass. Initial full2120/13/363 retained with per-case host/npm-runner dispositions. Runtime: original e8 C2 truly approved and attempted; identity then provenance ENOBUFS stops before claim/migration/SDK/fixture;19 completed read-only SQL calls plus1 failed-capture read-only catalog attempt. Original70 family/eight-section catalog and9 financial readbacks preserved; not application/pending reward E2E acceptance. New-source runtime unapproved; no third writer/archive/cleanup/lifecycle. Deployment:not deployed,commit/push/merge none. Incident OPEN/unrestored,HOLD,provider disabled; D15/advisor/device/hosted/formal staff blockers retained. Evidence and selective rollback: D19-C2-runtime-20261026/delivery.json.\n')
    main=read(V/'adfocate-delivery.json');oldmain=read(R/before['docs/verification/adfocate-delivery.json']['before']);assert main['D15']==oldmain['D15']
    main.update(updatedAt=stamp,codeFingerprint=fp,codeStatus=delivery['code'],testStatus='Node22 full2133/0/363,293files; audit16/protected194/supplement26/transport4,focused33,host-boundary32 pass; build/lint/schema-manifest pass. Initial full13 failures retained and resolved without assertion changes. Earlier standalone assistant8/memory7 remain separate.',runtimeStatus=delivery['runtime'],r1Verification='NOT_VERIFIED_CURRENT_APPLICATION_RUNTIME_AND_ORIGINAL_CASE_FACETS_REMAIN',d19Status='APPROVED_E8_C2_PRECLAIM_STOP_LOCAL_CAPTURE_FIXED_NEW_SOURCE_RUNTIME_UNAPPROVED_RELEASE_HOLD',D19C2RuntimeTransport=delivery,caseResults=cases,rollback=rel(P/'rollback.json'),nextTask=next_task,verificationLimit='Current789 source local gates pass. Original C2 actually approved/attempted at e8 but stopped preclaim; readonly preservation is not business E2E. New ead55 runtime unapproved; full original107/R1 facets,363 skipped integration and external blockers remain.',deploymentStatus='not-deployed',commit=None)
    main['currentRecordAuthority'].update(currentLocalSource=fp,currentRuntimeSource=None,currentSummary=rel(P/'delivery.json'),currentGates=rel(P/'gates.json'),currentCaseCoverage=rel(P/'case-coverage.json'),checker=rel(P/'verify-delivery.py'),currentSupplementGates=rel(P/'gates.json'),historicalSections='Earlier sections retain their recorded timestamps/source/target bindings. Original e8 C2 approval is true; it stopped preclaim. This C2 transport record is the current authority; no historical runtime is relabelled current.')
    main['caseCoverageSummary'].update(details=rel(P/'case-coverage.json'),original16CurrentPass=True,original194CurrentPass=True,currentApplicationServerRuntimeExecuted=False,originalC2ApprovedAndAttempted=True,currentSourceRuntimeApproved=False,wholeCurrentR1Verified=False)
    main['currentCandidateVerificationScope']={'sourceFingerprint':fp,'sourceRecords':789,'full':full_counts,'originalAudit16':16,'protected194':194,'businessRuntimeVerified':False,'approvedPreviousC2Source':read(V/'D19-C2-application-runtime-manifest.json')['candidate']['fingerprint'],'currentRecord':rel(P/'delivery.json'),'limits':delivery['pendingRewardBusinessNeutralityThisTurn']}
    main['financialNeutrality']['currentC2ReadonlyPreservation']=ref(P/'financial-preservation.json');main['financialNeutrality']['wholeCurrentCandidateVerified']=False
    main['schema']['currentC2TransportDiff']=ref(P/'schema-diff.json');main['schema']['currentC2Forward73Applied']=False
    main['gates'].append({'name':'D19_C2_TRANSPORT_CURRENT_LOCAL','sourceFingerprint':fp,'evidence':rel(P/'gates.json'),'full':full_counts,'runtimeAcceptance':False})
    main['postFullSuiteVerification'].append({'id':'D19_C2_TRANSPORT_20261026','evidence':rel(P/'gates.json'),'sourceFingerprint':fp,'codeChangedAfterFinalFull':False,'onlyDeliveryMetadataFinalizedAfterward':True})
    main['approvalRequired']=['Original e8 C2 was explicitly approved and attempted; no repeat approval of that stopped old source is requested.','New ead55 transport-continuation manifest requires its final digest/source approval before the three exact local receipt/result archives or any changed-source migration/Auth/fixture/API/browser execution.','Existing D15/advisor owner/device/hosted/formal staff and release-owner restrictions remain. No release/pilot activation authorized.']
    main['remainingRisks']=delivery['blockers']+[g['id']+': '+g.get('status','MISSING')for g in read(P/'remaining-acceptance.json')['remainingCaseGroups']if not g.get('status','').startswith('RESOLVED')]
    main['changedFiles']=sorted(set(main['changedFiles']+delivery['changedThisTurn']))
    main['evidenceIntegrity'].update(codeFingerprint=fp,taskSubset='docs/verification/D19-C2-runtime-integrity.json',checker=rel(P/'verify-delivery.py'))
    main['finalDeliveryReview']={'status':delivery['status'],'machineReadable':rel(P/'delivery.json'),'report':rel(P/'delivery.md'),'taskCount':20,'auditCases':107,'findings':28,'wholeCurrentR1Verified':False,'originalIncidentOpen':True,'releaseHold':True,'providerEnabled':False,'canDeploy':False,'canEnablePilot':False,'currentEvidence':rel(P/'delivery.json')}
    for task in main['taskResults']:
        if task['task']!='D19':continue
        task.setdefault('followupResults',[]).append({'id':'C2_TRANSPORT_20261026','newResult':{'code':delivery['code'],'test':full_counts,'runtime':delivery['runtime'],'deployment':'NOT_DEPLOYED'},'evidence':rel(P/'delivery.json'),'wholeCurrentCaseVerified':False});task['evidence'].append(rel(P/'delivery.json'))
    put(V/'adfocate-delivery.json',main)
    a=(P/'before-source/scripts/audit/local-targets.mjs').read_text(encoding='utf-8').splitlines(True);b=(R/'scripts/audit/local-targets.mjs').read_text(encoding='utf-8').splitlines(True)
    patch=''.join(difflib.unified_diff(a,b,fromfile='before/scripts/audit/local-targets.mjs',tofile='after/scripts/audit/local-targets.mjs'))
    patch+=''.join(difflib.unified_diff([], (R/'server/test/audit-docker-output-capture.test.ts').read_text(encoding='utf-8').splitlines(True),fromfile='/dev/null',tofile='after/server/test/audit-docker-output-capture.test.ts'))
    (P/'changed-source.patch').write_text(patch,encoding='utf-8',newline='\n')
    shutil.copyfile(R/'.codex-tmp/D19-C2-transport-gates.py',P/'run-local-gates.py');shutil.copyfile(Path(__file__),P/'prepare-delivery.py')
    print(json.dumps({'status':'PREPARED_C2_STOP_AND_TRANSPORT_DELIVERY','full':full_counts,'groups':groups,'currentSource':fp,'newRuntimeApproved':False}))
elif mode=='seal':
    subset=V/'D19-C2-runtime-integrity.json'
    if not subset.exists():put(subset,{})
    paths=sorted(p for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json')
    main=read(V/'adfocate-delivery.json');main['evidenceIntegrity']['records']=len(paths);put(V/'adfocate-delivery.json',main)
    changed=[R/x['path']for x in checkpoint['files']if not x['path'].endswith('evidence-integrity.json')and sha(R/x['path'])!=x['sha256']]
    selected=sorted(set(changed+[p for directory in [P,Q]for p in directory.rglob('*')if p.is_file()]+[V/'D19-C2-transport-continuation-runtime-manifest.json']))
    entries=lambda a:[{'path':rel(p),'sha256':sha(p),'bytes':p.stat().st_size}for p in a]
    put(subset,{'at':stamp,'codeFingerprint':fp,'method':'Raw hashes of C2 stopped attempts, readonly proofs, repair/gates/preparation and changed metadata; root seal covers all verification files. Prior2249 evidence retained via originals or exact before copies.','files':entries(selected)})
    put(V/'evidence-integrity.json',{'createdAt':stamp,'codeFingerprint':fp,'method':'Exact raw SHA256 of every verification file, excluding only this root seal. Historical evidence/before images retained; current authority explicitly separates approved stopped e8 runtime and unapproved changed source.','files':entries(paths)})
    print(json.dumps({'status':'SEALED_CURRENT_C2_TRANSPORT_EVIDENCE','records':len(paths),'subset':len(selected)}))
else:raise SystemExit('Use prepare or seal')
