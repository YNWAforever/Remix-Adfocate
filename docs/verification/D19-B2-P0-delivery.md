# D19 B2-P0 本機準備與離線驗證

本輪完成已批准的 P0。本機 full suite **2027 passed / 0 failed / 363 gated skipped / 286 files**；原16項 audit 回歸及194項契約保留，新增34項本機測試。type、lint、release manifest、build 均 exit0；lint 原有4 warnings。6份 acceptance/config source 的語法檢查通過，沒有執行 browser。

- Source fingerprint: `7943636116d39d489e0f0d1623784627ab0388650fb2e680c12c90eb1a2d1ac6`，777份 runtime/test/schema/config source。HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，branch `codex/adfocate-r1-pilot-20261023`；commit=null。
- [27個變更檔案](D19-B2-P0-changed-source.json)、[patch](D19-B2-P0-changes.patch)、[逐項測試及 logs](D19-B2-P0-gates.json)、[完整測試結果](D19-B2-P0-full-results.json)。
- [七項補缺](D19-B2-P0-findings.json)、[case coverage](D19-B2-P0-case-coverage.json)、[schema source diff](D19-B2-P0-schema-diff.json)、[rollback](D19-B2-P0-rollback.json)。原107案例、28 findings及原稽核結果保留。

產品修改只延伸既有 DraftEditor：409會保留輸入並顯示伺服器草稿，由作者明確選擇以最新 revision 儲存；網絡失敗可重試。其他修改集中於既有 target/factory/browser harness 的 B2 接線與驗收保護，沒有另建 workflow/proof/reward 引擎，沒有修改 migration。

本輪沒有實際 Docker、服務 target SQL/Auth/API、新 target/fixture、integration/browser E2E、舊 target secrets、正式資料/membership/角色、真正 provider/訊息/邀請/付款，亦沒有 commit/push/merge/deploy。既有 in-process memory/loopback 單元測試並非新 target 的 runtime 證據。

## 待審 runtime manifest

[Runtime manifest](D19-B2-runtime-manifest.json) SHA256: `71421cbe72f671a242a8bdc6031654c61b634d7d2aabf7ebd4b85325f95691f1`。授權 template 保持 `approved:false`；P0 不構成 runtime 授權。

1. 新 project `adfocate-d19-b2-20261025-b0db3134`；最多1 network、1新 DB volume、5個本機 cached pinned-image containers。web56800/API56821/DB56822僅127.0.0.1，proxy=none；storage僅256MiB tmpfs。實際 IDs/cache/port/mount 未查證，須於 runtime 先通過 prestart/live identity，然後才可 owner SQL、keys、client/setup；不得 fallback。
2. [Bootstrap profile](D19-B2-bootstrap-profile.json)：72份原 migration checksum不變，42份 protected manifest entries，9項相容設定只可在 matching catalog diff 下處理。獨立記 migration seed row/hash baseline。先於 evidence guard migration 之前建立5個精確 owned checkpoint rows，之後 forward replay；core 必須採納該 workspace/queue Creator/legacy mission/invalid submission，不重複建立、不停用 trigger/RLS。它不是原事故 before image。
3. 三 phase 上限 Auth=11/62/11，共84；workspace6、mission6、workflow4。core queue51包含已採納的1人，其餘新建50。70個 row families 的 parent selector及 caps、Auth side effects、私有 receipts、assistant mock、notifications均列在 manifest；沒有 blanket child-write/cleanup 權限。
4. **兩次既有 legacy 合成批准須另批**：各+500 points、+125合成 earnings、budget−125，ordinary approve XP+100。加入10+提交25+批准100才是累計135；legacy合計XP270，active join合計最多30。這些只適用新一次性 fixture；沒有真實支付。pending completion/cancel/reapproval 的 ledger、可提現額、budget、inventory及XP變化仍須為0，分開量度；新建 pending lifetime最多4、結束3 pending+1 cancelled。
5. Owner-only 暫時 fault function/trigger各1，名稱由core phase UUID固定，條件只限該 owned Creator；先記私有 exact definition，finally刪除並 catalog readback。沒有 business-data刪除或安全 trigger/RLS停用。
6. 現有3個實作命令依 role→core→browser 執行：`node scripts/audit/run-integration.mjs staff`、`node scripts/audit/run-integration.mjs pilot`、`node scripts/audit/run-pilot-browser.mjs`。先設 manifest 指定的 B2 env/獨立批准/target receipt；owner bootstrap另依 sealed profile操作。預期8+9+5個 base cases，另有真409、斷線/空白及歷史無效URL等義務，並不是額外已通過的 cases。所有 runtime 均 NOT_RUN。
7. 最後重讀全部phase inventories/journals、immutable migration seeds、Creator redacted projection與operator/finance ID/DB關聯/刷新歷史、legacy anchors及各 neutrality window；不能以toast或新fixture值代替持久化或還原。未批准清理；保留新資源/資料供review。

可供之後明確批准的文字（本輪未執行）：

> 批准 B2 runtime，僅限 source `7943636116d39d489e0f0d1623784627ab0388650fb2e680c12c90eb1a2d1ac6` 及 manifest SHA256 `71421cbe72f671a242a8bdc6031654c61b634d7d2aabf7ebd4b85325f95691f1` 所列的新一次性本機 target、fresh secrets/config、72-source forward bootstrap及精確 historical checkpoint、fixture caps、owner-only合成role/DDL、兩次既有legacy合成發放上限，以及role/core/browser驗收與唯讀持久化/neutrality查證。先通過身份、source、catalog、baseline及phase lineage gates；UNKNOWN即停止依賴寫入，不自動重seed或清理。不動舊 shaped/empty/pristine 或正式資料，不重跑兩個pristine全域RPC，不還原/刪除原三campaign，不停止舊容器、不關閉事故、不解除HOLD；provider disabled，不發真訊息/邀請/付款，不commit/push/merge/deploy。

## 未測／受阻與下一步

[R1剩餘驗收及依賴](D19-B2-P0-r1-checklist.json)：新 target實際 identity/bootstrap/catalog/seed baseline、8 role+9 core+5 browser完整交接、real409及歷史壞URL拒絕、pending持久化/finance neutrality/全phase inventory仍未跑，先等上述 exact runtime scope 審批。原兩項pristine全域RPC證據保持歷史source binding，沒有重跑。

D15 的4份真實核准課堂教材及 UC-C18/UC-A51、具名 advisor owner／裝置／manual AT／hosted 證據、正式staff membership/role銜接仍blocked。正式staff active membership0屬scope問題，未移除membership檢查。原三campaign事故仍 **OPEN、未還原**；B1舊shaped target僅鑑證用途，release **HOLD**、provider **disabled**。**未部署，不能稱整體R1 verified。**

Rollback只在目前檔案raw SHA仍等於本輪afterSha時按beforeCopy逐檔恢復，保留其他dirty work；來源回退不會還原資料或解除上述狀態。
