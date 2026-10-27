from pathlib import Path
import csv,datetime,hashlib,io,json,shutil,sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
FP='ead55a808470f90d72290905db90933cb4a6df48eaba519d4587339a4659b71d'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p):return Path(p).relative_to(R).as_posix()
def ref(p):return {'path':rel(p),'sha256':sha(p)}
def put(p,j):Path(p).write_text(json.dumps(j,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
def rows(p):
    with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
def put_rows(p,data):
    text=io.StringIO(newline='');w=csv.DictWriter(text,fieldnames=list(data[0]),lineterminator='\n');w.writeheader();w.writerows(data);Path(p).write_text(text.getvalue(),encoding='utf-8',newline='\n')
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for x in before.values():assert sha(R/x['before'])==x['sha256']
frozen=['code-fingerprint.json','D19-C2-transport-continuation-runtime-manifest.json','D19-C2-transport-preparation-20261026/runtime-authorization.json','D19-application-runtime-preparation-20261025/runtime-authorization.json']
for n in frozen:assert sha(V/n)==before['docs/verification/'+n]['sha256']
source=read(V/'code-fingerprint.json');assert source['fingerprint']==FP and len(source['files'])==789
for x in source['files']:assert hashlib.sha256((R/x['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==x['sha256'],x['path']
if sys.argv[1]=='prepare':
    assert not (P/'delivery.json').exists(),'One-shot delivery, preserve history'
    report=read(P/'boundary-final-native.json');trace=read(P/'boundary-final-readback.json')
    assert report['success']and(report['numPassedTests'],report['numFailedTests'],report['numPendingTests'])==(8,0,0)and len(trace['observations'])==8
    assert all(o['sdkCalls']==o['deniedExternalFetchAttempts']==0 and o['scriptedFinancialRowsUnchangedSinceLatestFixtureReadback']for o in trace['observations'])
    labels={'boundary-initial':0,'boundary-final':0,'boundary-lint':1,'boundary-type':2,'boundary-type-final':2,'boundary-lint-final':0,'boundary-type-complete':0}
    checks={}
    for label,code in labels.items():
        c=read(P/f'{label}-command.json');assert c['exit']==code and c['sourceFingerprint']==FP and c['sourceUnchangedAfter']
        checks[label]={'exit':code,'command':c['command'],'receipt':ref(P/f'{label}-command.json'),'log':ref(P/f'{label}.log'),'resource':ref(P/f'{label}-resource.json')}
    artifacts=[P/n for n in ['wallet-notifications.test.tsx','vitest.offline.mjs','tsconfig.offline.json']]
    put(P/'gates.json',{'at':stamp,'sourceFingerprint':FP,'sourceRecordsUnchanged':789,'standalone':{'passed':8,'failed':0,'skipped':0,'files':1},'checks':checks,'native':ref(P/'boundary-final-native.json'),'readbacks':ref(P/'boundary-final-readback.json'),'verificationArtifacts':[ref(p)for p in artifacts],'retainedNativeFull':{'passed':2133,'failed':0,'skipped':363,'files':293,'rerun':False,'sourceFingerprint':FP,'evidence':ref(V/'D19-C2-runtime-20261026/gates.json')},'countsMustRemainSeparate':True,'initialDiagnostics':'Initial8 assertions passed. Two verification-only lint errors fixed (unused placeholder parameter/prefer-const). First type config omitted generated file-route IDs; routeTree-only config then omitted the app router Register context. Final strict config retains every original root include plus the standalone test; no ts-ignore, any substitution, compiler relaxation or product change. Added direct-call traces and explicit scripted balance SELECT-fixture updates; identical8 behavior assertions rerun successfully. Final type-config-only include change required only type rerun; Vitest and lint do not read tsconfig.offline.json.','scope':trace['scope'],'notClaimed':['Physical Auth/RLS/DB persistence','Browser/device/hosted/AT','Actual notification producer delivery or click-through rendering of the target work item','Realtime socket correctness','Redemption replay/debit/code uniqueness','Pending reward financial neutrality or payment']})
    summaries=[{'test':o['test'],'http':[{k:d[k]for k in ['path','method','status','body','result']}for d in o['requests']],'scriptedQueries':o['queries'],'fixtureReadUpdates':o['fixtureReadUpdates'],'scriptedFinanceUnchangedAfterLatestFixtureReadback':o['scriptedFinancialRowsUnchangedSinceLatestFixtureReadback'],'actualSdkCalls':o['sdkCalls'],'actualProviderCalls':0,'deniedExternalFetchAttempts':o['deniedExternalFetchAttempts']}for o in trace['observations']]
    put(P/'readback-summary.json',{'at':stamp,'scope':trace['scope'],'observations':summaries,'important':'C14 deliberately changes only scripted SELECT fixtures49-to50 and stock2-to0; those changes are explicitly logged, not financial writes or actual neutrality evidence. The transport rejects every mutation except scripted notifications.read_at.','raw':ref(P/'boundary-final-readback.json')})
    remaining=read(V/'D19-C2-runtime-20261026/remaining-acceptance.json');remaining.update(at=stamp,previousReview=ref(V/'D19-C2-runtime-20261026/remaining-acceptance.json'),newPhysicalTargetCalls=0)
    for g in remaining['remainingCaseGroups']:
        if g['id']=='GATE14-APPLICABILITY':g.update(knownEvidence=g['knownEvidence']+' Current unchanged789 source now has8 standalone UI/query/apiFetch/actual Hono/workspace-middleware assertions for C13/C14/C36 with explicit scripted Auth/DB; foreign filter and duplicate read witnesses, wallet500 recovery, stock/shortfall/refetch controls pass.',status='ALL14_REQUIRED_NO_WAIVER; C13_C14_C36_ADDITIONAL_OFFLINE8_PASS; FULL_CASES_UNVERIFIED',pendingManifestCovers='Current pending f5 C2 is applications-only. No wallet/redemption/shortlist/content/gift/global-job scope; original696e is completed and not reused.',missing='Physical Auth/RLS/persisted-state and actual browser/work-item click-through/producer evidence remain. No replay/debit/code/settlement claim. Other GATE14 expectations retain their previous individual evidence gaps.',offlineEvidence=ref(P/'gates.json'))
    remaining['nextTask']='D19: the existing f5caccfd transport-continuation manifest/source approval is still pending; no replacement/reapproval of that unchanged proposal is needed because of this offline packet. Current source/SQL/C2 frozen. Continue authorized independent local facets; actual application/asset/Creator-isolation/legacy/financial/browser fixtures require their own existing or explicit bounded scope. Do not replay696e/pristine.'
    put(P/'remaining-acceptance.json',remaining)
    cases=rows(V/'audit_case_coverage.csv');oldcases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert cases==oldcases
    for row in cases:
        if row['case_id']in ['UC-C13','UC-C14','UC-C36']:
            row['newResult']='PARTIAL_CURRENT_OFFLINE_UI_API8_PASS; ORIGINAL_FULL_CASE_NOT_VERIFIED; ORIGINAL_EXPECTATION_REQUIRED_NO_WAIVER'
            row['testStatus']+=' Standalone wallet/notification8/0/0 with actual UI/query/apiFetch/Hono/workspace middleware and scripted Auth/DB; targeted lint and root-context strict type-check pass. Separate from retained native2133/0/363, not rerun.'
            row['runtimeStatus']='NO_PHYSICAL_RUNTIME_THIS_TURN. Offline actual UI/API reads, wallet500/refetch, points shortfall/stock refresh and recipient-filtered mark-read/replay plus submission hrefs pass with explicit scripted Auth/DB/Realtime. No actual SDK/Auth subject/SQL/container/browser/provider, redemption, producer notification or work-item click-through; not full RLS/persistence/neutrality acceptance.'
            row['newEvidence']+=';D19-wallet-notifications-offline-20261026/gates.json;D19-wallet-notifications-offline-20261026/readback-summary.json'
            row['limitations']+=' | New in-process witness is distinct from physical DB/RLS/browser and actual financial neutrality. C14 SELECT response fixtures are explicitly changed; no debit/code mutation. UC-C33 and full UC-C36 producer/target-work-item acceptance remain open.'
        if row['case_id']=='UC-A45':
            row['runtimeStatus']='Local empty/pending-list assertions are retained. Original e8 C2 was explicitly approved but stopped before claim/migration/SDK/fixtures. The unchanged revised-source f5 C2 is still awaiting approval; no application UI runtime completed. This is a status clarification, no new A45 acceptance credit.'
            row['newEvidence']+=';D19-C2-runtime-20261026/runtime-reconciliation.json'
    put_rows(V/'audit_case_coverage.csv',cases)
    put(P/'case-coverage.json',{'at':stamp,'sourceFingerprint':FP,'auditCases':107,'originalAuditFieldsPreserved':True,'changedEvidenceCases':['UC-C13','UC-C14','UC-C36'],'statusClarificationOnly':['UC-A45'],'wholeCurrentCasesAccepted':[],'D15RowsUnchanged':['UC-C18','UC-A51'],'cases':cases,'gates':ref(P/'gates.json'),'remaining':ref(P/'remaining-acceptance.json')})
    put(P/'rollback.json',{'at':stamp,'scope':'Local standalone verification and delivery metadata only; all789 app/SQL source records and C2 manifest/authorizations unchanged. No physical data/schema/resource action to reverse.','before':checkpoint['files'],'afterIntegrity':'docs/verification/D19-wallet-notifications-offline-integrity.json','instructions':['Verify exact after-hashes, preserve later/user work, then selectively restore metadata from these exact before images if requested. Never reset/clean the dirty worktree.','Keep all initial/final tests, lint/type diagnostics, source snapshots, actual old C2 approval and failed runtime evidence.','The source, C2 proposal and both authorization files did not change: do not overwrite or relabel them during rollback.','No target cleanup, role repair, data/schema rollback, container lifecycle, incident closure or release/pilot activation.'], 'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False})
    delivery={'at':stamp,'status':'PASS_STANDALONE_WALLET_NOTIFICATION_OFFLINE8_NOT_FULL_R1','tasks':['D19'],'sourceFingerprint':FP,'sourceRecordsUnchanged':789,'code':'Product/SQL/C2 source unchanged; standalone verification only. Actual wallet/redemption controls/notifications engines extended by evidence, no parallel product implementation.','test':{'standalonePassed':8,'failed':0,'skipped':0,'lintExit':0,'typeExit':0,'retainedNative2133NotRerun':True},'runtime':'Actual UI/query/apiFetch/Hono/workspace middleware in process; scripted Auth/DB/Realtime only. No physical target/client/SQL/provider/browser. Notification updates exist only in scripted memory; no real messages.','gates':ref(P/'gates.json'),'readbacks':ref(P/'readback-summary.json'),'caseCoverage':ref(P/'case-coverage.json'),'remaining':ref(P/'remaining-acceptance.json'),'rollback':ref(P/'rollback.json'),'c2Manifest':ref(V/'D19-C2-transport-continuation-runtime-manifest.json'),'c2ProposalUnchangedAndPending':True,'oldC2ApprovalStillTrue':True,'actualTargetCalls':0,'realSdkClients':0,'physicalSqlCalls':0,'authSubjectsCreated':0,'productionOrFormalStaffWrites':0,'actualProviderCalls':0,'pendingRewardNeutralityMeasured':False,'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False,'deployment':'NOT_DEPLOYED','commit':None,'push':False,'merge':False,'blockers':remaining['blockers'],'nextTask':remaining['nextTask'],'changedThisTurn':['docs/verification/D19-wallet-notifications-offline-20261026/','docs/verification/D19-wallet-notifications-offline-integrity.json','docs/verification/adfocate-delivery.json','docs/verification/audit_case_coverage.csv','docs/verification/implementation_backlog.csv','docs/verification/adfocate-task-ledger.md','docs/verification/evidence-integrity.json']}
    put(P/'delivery.json',delivery)
    (P/'delivery.md').write_text('''# D19 GATE14：錢包及通知離線補驗

新增 **8/8、exit0**，lint及嚴格TypeScript通過。App/SQL共789檔、C2 source及待批manifest均不變。上一輪native full2133/0/363（293files）保留，今輪未重跑；新8項不加入其總數。

| 案例 | 真正程式觀察；Auth/DB明確fake |
| --- | --- |
| UC-C13 | 400分、+250/-50交易及HK$47.25可用／HK$15待審分開顯示；其他Creator資料不顯示；500提示後explicit query refresh恢復；actual workspace middleware拒401／403 |
| UC-C14 | 49/50差1分，disabled按鈕有accessible description；缺貨0即禁用；scripted SELECT更新49→50及stock2→0後正確重算。沒有confirm、redeem RPC、扣分或發碼 |
| UC-C36 | 真正badge/list/hook/apiFetch/Hono，owned2項mark-read→0，更新數2；重複+foreign IDs回傳1再0，另一收件人不變；actual NotificationCard產生精確/my/submission href |

不是整案例或R1 PASS。Scripted Auth與creator-RLS邊界不是真實Auth/RLS；沒有新target、SDK、SQL、Auth subject、session、fixture、provider或browser。Realtime只有stub，/me為完整明示fixture。沒有真通知producer、click-through後實際work-item、付款／redemption replay、pending reward business neutrality。C14改動的是記憶體SELECT fixture，readback逐項記錄，不能冒作財務相等證據。

首跑8項已通過；驗證檔兩項lint已修。獨立type config先缺route IDs，再缺app router Register；最終保留root所有includes加本test，不降低compiler要求。原log、config/source snapshots保留；補direct HTTP trace後同8 assertions再通過，最後type include-only更改只重跑TypeScript。

107個原稽核欄位保留，C13/C14/C36只增加offline facets；A45只澄清舊e8 C2已批准且停於preclaim、新f5仍待批，沒有新驗收credit。D15教材、advisor owner／device／hosted／manual AT、正式staff限制維持。事故OPEN／未還原，舊shaped只供鑑證，release HOLD，provider disabled。未commit／push／merge／deploy，未部署。

所有commands、Node22、fresh RAM、terminal receipts、原始readback、範圍及限制見gates.json／readback-summary.json；rollback.json只有選擇性本機檔案／metadata復原，不涉及資料或資源。下一步仍是既有f5 C2批准，proposal與source沒有改動，勿重問同一批准或重跑pristine／696e。
''',encoding='utf-8',newline='\n')
    tasks=rows(V/'implementation_backlog.csv')
    for task in tasks:
        if task['task_id']=='D19':
            task['newResult']+='; standalone wallet/notifications8 pass; C13/C14/C36 partial only'
            task['testStatus']+=' Standalone8/0/0 plus lint/strict root-context type pass; native2133 retained, not rerun.'
            task['runtimeStatus']+=' In-process scripted Auth/DB; no SDK/SQL/target/provider/browser. C2 f5 unchanged/pending.'
            task['evidence']+=';D19-wallet-notifications-offline-20261026/delivery.json'
    put_rows(V/'implementation_backlog.csv',tasks)
    with (V/'adfocate-task-ledger.md').open('a',encoding='utf-8',newline='\n')as f:f.write('\n\n### D19 GATE14 wallet/notifications offline - 2026-10-26\n\nCode:all789 product/SQL/C2 sources unchanged. Test:standalone8/0/0,lint/strict type pass; original diagnostic logs retained. Native2133/0/363 not rerun or summed. Runtime:actual UI/query/apiFetch/Hono/workspace middleware with scripted Auth/DB/Realtime; no SDK/target/SQL/provider/browser/real notification/debit/code. C13/C14/C36 partial facets, A45 status clarified;107 originals preserved. Deployment:not deployed;no commit/push/merge. Incident OPEN,HOLD,provider disabled;D15/advisor/device/hosted/staff restrictions retained. Evidence/rollback:D19-wallet-notifications-offline-20261026/delivery.json.\n')
    main=read(V/'adfocate-delivery.json');main.update(updatedAt=stamp,D19WalletNotificationsOffline=delivery,runtimeStatus=delivery['runtime'],caseResults=cases,rollback=rel(P/'rollback.json'),nextTask=remaining['nextTask'])
    main['currentRecordAuthority'].update(currentSummary=rel(P/'delivery.json'),currentCaseCoverage=rel(P/'case-coverage.json'),checker=rel(P/'verify-delivery.py'),currentSupplementGates=rel(P/'gates.json'))
    main['testStatus']+=' Separate standalone wallet/notifications8/0/0 with lint/strict type pass; native2133 not rerun and counts remain separate.'
    main['caseCoverageSummary'].update(details=rel(P/'case-coverage.json'),walletNotificationsOfflineEvidence=rel(P/'gates.json'))
    main['remainingRisks']=remaining['blockers']+[g['id']+': '+g.get('status','MISSING')for g in remaining['remainingCaseGroups']if not g.get('status','').startswith('RESOLVED')]
    main['verificationLimit']='All789 product/SQL/C2 source hashes unchanged; retained native2133/0/363 plus separate wallet/notification8. Scripted Auth/DB/Realtime and /me fixture are explicit, not physical RLS/persistence/browser/producer/financial neutrality. Original107 full cases/R1 not verified. New-source C2 f5 remains unchanged/pending.'
    main['changedFiles']=sorted(set(main['changedFiles']+delivery['changedThisTurn']));main['evidenceIntegrity'].update(taskSubset='docs/verification/D19-wallet-notifications-offline-integrity.json',checker=rel(P/'verify-delivery.py'))
    main['finalDeliveryReview'].update(status=delivery['status'],machineReadable=rel(P/'delivery.json'),report=rel(P/'delivery.md'),currentEvidence=rel(P/'delivery.json'))
    for t in main['taskResults']:
        if t['task']=='D19':t.setdefault('followupResults',[]).append({'id':'WALLET_NOTIFICATIONS_OFFLINE_20261026','newResult':{k:delivery[k]for k in ['code','test','runtime','deployment']},'evidence':rel(P/'delivery.json'),'wholeCurrentCaseVerified':False});t['evidence'].append(rel(P/'delivery.json'))
    put(V/'adfocate-delivery.json',main);shutil.copyfile(R/'.codex-tmp/D19-wallet-notifications-offline-run.py',P/'run-offline-verification.py')
    print(json.dumps({'status':'PREPARED_OFFLINE8_DELIVERY','sourceUnchanged':789,'currentC2ProposalUnchanged':True,'physicalRuntime':False}))
elif sys.argv[1]=='seal':
    subset=V/'D19-wallet-notifications-offline-integrity.json'
    if not subset.exists():put(subset,{})
    all_files=sorted(p for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json')
    main=read(V/'adfocate-delivery.json');main['evidenceIntegrity']['records']=len(all_files);put(V/'adfocate-delivery.json',main)
    changed=[R/x['path']for x in checkpoint['files']if not x['path'].endswith('evidence-integrity.json')and sha(R/x['path'])!=x['sha256']]
    selected=sorted(set(changed+[p for p in P.rglob('*')if p.is_file()]))
    entries=lambda paths:[{'path':rel(p),'sha256':sha(p),'bytes':p.stat().st_size}for p in paths]
    put(subset,{'at':stamp,'codeFingerprint':FP,'method':'Raw hashes of standalone wallet/notification verification and changed metadata; prior2377 records retained through originals/exact before copies.','files':entries(selected)})
    put(V/'evidence-integrity.json',{'createdAt':stamp,'codeFingerprint':FP,'method':'Exact raw hashes of every verification file, excluding only this root seal; prior artifacts and approvals retained.','files':entries(all_files)})
    print(json.dumps({'status':'SEALED_OFFLINE_WALLET_NOTIFICATION_EVIDENCE','records':len(all_files),'subset':len(selected)}))
else:raise SystemExit('Use prepare or seal')
