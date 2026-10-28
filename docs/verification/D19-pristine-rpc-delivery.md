# D19 pristine 全域 RPC 補驗

本輪有限目標已驗證：兩個原 global RPC cases 通過；發布／pilot 仍 HOLD，不能稱當前整份 R1 verified。原3筆既有隔離campaign事故維持OPEN／未還原，未猜值、未操作舊target SQL或正式資料。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`，branch `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`。Source fingerprint `9812cc7755dd6443f8fa4b39bc92e6c26536b54e15ba1c0cbc494815375dd5e1`／353 records。7個[測試／工具檔](D19-pristine-rpc-changed-files.json)差異，產品API／UI／SQL／E2E共586個既有檔案bytes相同；原campaigns-s2驗收檔不變。沒有commit／push／merge／deploy。

新project `adfocate-d19-pristine-20261024-5e2fa581`：新volume、fresh credentials、5個固定image容器；API127.0.0.1:56631／DB56632，專用bridge／no masquerade。不是用localhost名稱當身份。Metadata gate早於啟動health／應用setup／SDK；live container／image／project／network／volume與實際port mapping再核實，才讀零資料baseline及執行原migration。見[prestart](D19-pristine-rpc-prestart-identity.json)、[runtime gate](D19-pristine-rpc-runtime-identity-before-setup.json)、[baseline](D19-pristine-rpc-pristine-baseline.json)、[目前attestation](D19-pristine-rpc-current-attestation.json)。

兩個原cases：**2pass／0fail／3個其他case篩出**。`close_due_campaigns()` 首次回傳1、第二次0；逾期active變closed、future active與past draft保持原狀。`snapshot_campaign_leaderboards()`回傳1；排名row回讀與live rank一致。3次真實HTTP RPC前後的10個財務table row hashes、balances、可提現額、budget／ledger／pending rewards／contracts及creator XP相同。沒有結算／付款。見[逐case與commands](D19-pristine-rpc-test-results.json)、[持久化及neutrality](D19-pristine-rpc-rpc-persistence-neutrality.json)。

本輪full offline **1982pass／363 gated skip／0fail／277 files**，原16＋194全綠；targeted34pass，type／lint／manifest／build exit0。Skip不是pass；先前439 support＋proof3保留在原時間／source，不把兩輪合稱新441 full-support run。未重跑整段legacy／active／proof／pending reward角色與browser旅程，原core9／role8／Edge5維持歷史source binding。

新庫實際replay原72 migrations，42 manifest hashes核對；沒有reset/db push、migration history偽標或舊checksum變更。直接vendor container的default ACL與明確auto_expose=false CLI profile不同，原migration assertion曾拒絕；只在新庫對齊default privilege及既有legacy ACL後續跑。另補回profile調整影響的7個creator＋1個notification欄位grant，移除1個assistant多餘execute grant。這些後續配置不改兩global RPC／service-role campaign-submission grants；原case的財務與persisted state再次回讀相同，沒有宣稱額外profile／notification／assistant runtime驗收。

[Raw schema diff](D19-pristine-rpc-schema-diff.json)完整保留。20個function raw MD5差異可只把新body CRLF轉LF精確重現舊hash（Windows Python text stdin與Node輸入差異）；另外9個function ACL表示含PUBLIC已覆蓋的冗餘API-role grant，effective execution相同。[Resolution](D19-pristine-rpc-catalog-diff-resolution.json)確認semantic catalog parity；沒有把raw catalog稱逐byte相同。

首次網絡拒絕2fail、第二次新PostgREST JWK不匹配2fail及全部provisioning中斷均保留[執行證據](D19-pristine-rpc-execution-capsule.json)。前兩輪沒有global RPC；第一輪未產生Auth／campaign／submission／snapshot；第二輪只刪除journal成功建立的一個exact新Auth ID後核實零資料，再重試。沒有按email／名稱清理。最終4個campaign、1個creator/Auth、1筆snapshot及本輪3個workspace exact IDs [保留](D19-pristine-rpc-fixture-retention.json)；5個新容器已[停止](D19-pristine-rpc-target-stopped.json)，新volume/network保留。

20 tasks／107 audit cases／28 findings／12 product cases及1645原CSV欄位保留。只更新UC-S04 mutable followup；106 cases及19 tasks原結果不變。[Coverage](D19-pristine-rpc-case-coverage.json)不是107個UI PASS。原originalAuditResult不覆寫。D15核准內容、具名advisor owner／裝置／hosted、正式staff銜接仍blocked；真實provider disabled。正式登入成功／membership=0的scope限制沒有移除或補grant。

[Rollback](D19-pristine-rpc-rollback-checks.json)僅check：新patch可reverse，舊patch需依當前hunks覆核；沒有套用。Source rollback不能還原原3筆campaign，亦不可因此取消共享target的global guard。原事故owner處置及既有外部gates為下一項D19；新global-case target blocker已解除。

[adfocate-delivery.json](adfocate-delivery.json)、[machine report](D19-pristine-rpc-delivery.json)、[integrity](D19-pristine-rpc-integrity.json)均保持canDeploy／canEnablePilot=false。未部署。
