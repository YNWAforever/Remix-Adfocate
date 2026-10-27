# D19 B1：舊 shaped target 排除後續驗收

**B1 的本機排除措施已驗證；事故仍 OPEN／未還原，release HOLD。** 舊 `adfocate-r1-shaped-20261023` 只保留鑑證用途。沒有停止容器、資料還原／刪除／新建、正式資料或角色修改；B2 新 target／fixture／角色及 browser E2E 未批准。

## 改動與保護邊界

延伸既有 identity gate，沒有另建驗收或產品引擎：

- `scripts/run-integration-tests.mjs`：入口拒絕舊 project／API container／DB container／network；核對 metadata 後亦拒絕已辨識的舊 network attachment 或 named data-volume mount，改 project 名不能重用舊 volume。
- `scripts/audit/local-targets.mjs`：`verifiedTarget("shaped")` 在 Docker metadata／private key 讀取／SQL closure／SDK 或 fixture setup 前拒絕。既有 support／fresh／migration／schema／browser wrappers 沿用同一 guard。
- `server/test/acceptance-target-retirement.test.ts`：新增離線行為回歸。原 runner/pristine/global tests、16 稽核語義、194 既有契約及產品 API／UI／SQL 保留。

拒絕訊息明確標示 B1、forensics-only、acceptance/pristine setup refused 及 B2 另批。沒有可用的 env purpose bypass。鑑證用途保留既有 A exact-target READ ONLY helper／receipts；沒有新增一般 SDK／fixture 豁免。

這是 repo 入口的驗收用途排除，**不是實體 network quarantine 或 OS／firewall ACL**，也不宣稱能阻止任意 repo 外工具或所有資料副本。原 before-image 仍 UNKNOWN；接受非還原處置不等於已還原。

## 測試及證據

- 有效 RED：10 項 missing-exclusion failures、1 pass，當時兩個原工具檔與 before bytes 相同。此前一次 mock import error 及一次不完整 pristine double 均保留於 [test history](D19-B1-test-history.json)，沒有冒充有效 RED。
- GREEN：新增 11 項＋原 18 項 identity／pristine tests，共 29 pass／0 fail。
- 第一個 full attempt 在 600 秒 runner watchdog 到時中止，未取得完整測試結果；原 [timeout receipt](D19-B1-full-watchdog-receipt.json)／log 保留。調整的是本機 runner 上限，沒有改測試 assertions 或正式 evidence expiry；重跑使用另一 JSON output path，沒有把 timeout 改寫成 PASS。
- Sandbox 完整重跑曾有 **1982 pass／11 fail／363 skip**：[三檔失敗明細](D19-B1-sandbox-failures.json)保留 loopback EACCES、fetch／client-abort 症狀及 temp rename EPERM。正式工具審批後，同 source 三檔 [25/0 重驗](D19-B1-environment-recheck.json) 通過；再以該環境跑整個 suite。沒有改 assertions、產品程式或借此接觸任何業務 target。
- Full：`npm test -- --no-file-parallelism --reporter=json --outputFile=.codex-tmp/D19-B1-full-verified.json`，**1993 pass／0 fail／363 明確 gated skip／278 files**；原 16＋194 均通過。Skip 不代表 integration passed。[逐檔結果](D19-B1-full-results.json)
- `npm run type-check`、`npm run lint`、`npm run release:manifest:check`、`npm run build` 均 exit 0；各 receipt／logs 記錄 exact source fingerprint。
- 五個 [負向 CLI probes](D19-B1-cli-probes.json)：generic launcher、support、support --fresh、direct fresh、shared helper，均 exit 1 並返回 B1 拒絕；subprocess／fetch traps 記錄 attempted=0、executed=0。這是實際 Node 入口的離線負向檢查，沒有 Docker／DB／Auth／API client、fixture 或 E2E 驗收執行。

本輪源碼 fingerprint `d7cc43ad92ad96b0b7d424a1ce903a42a7e83edc0c57319e8d33ad2d4ed82ac5`（354 records），HEAD／branch 不變、無 commit。舊 fingerprint `9812cc7755dd6443f8fa4b39bc92e6c26536b54e15ba1c0cbc494815375dd5e1` 的 pristine 兩個 global cases 原封保留，沒有重跑。Role8／core9／Edge5 及 funded pending reward 旅程仍屬原 source/time/target 的歷史證據；本輪沒有重新量度 DB 財務向量，亦沒有任何財務寫入。

## 四層交付與覆蓋

[Delivery JSON](D19-B1-delivery.json)及 `adfocate-delivery.json` 已記錄 code／test／deployment／runtime 的 newResult。Deployment 為 **not-deployed**；沒有 commit／push／merge／deploy。

[Case coverage](D19-B1-case-coverage.json)：107 項原 case results／originalAuditResult 及所有 CSV 保留；B1 不把 guard assertions 當作 Creator／operator 旅程驗收。[Schema diff](D19-B1-schema-diff.json)：manifest／migration 原 bytes 不變，objects／RPC／grants／RLS／history 無改動，runtime catalog 未重查。

## 尚未完成及下一步

詳見[更新驗收清單](D19-B1-r1-checklist.json)，保留依賴及完成條件。下一項仍是 D19：先 review 並另批 B2 的 exact target／fixture／角色／browser scope，再做 identity／schema／baseline 與必要旅程，不能自動重用舊 shaped 或切另一 target。

尚未在當前 354-source candidate 的獲准可信新 target 上重驗：legacy CRM transaction／revision／idempotency，Creator 加入→交付→修稿→proof→operator 完成，Creator／operator／finance hard reload 的同一 pending reward／完整歷史，以及 funded financial neutrality／403／409／空白／stale／輸入保留。Pristine 兩個已通過全域 RPC cases不排程重跑。

仍有 D15 核准真實課程、具名 advisor owner／裝置／hosted、正式 staff membership／角色銜接 blockers。Staff 原 membership=0 仍是 scope 問題；既有 membership gate 與單 workspace PK 不變。真實 provider disabled、pending reward 不等於付款。**本輪不稱 R1 verified，不關閉事故或解除 HOLD。**

## 回退與完整性

[本輪 changes patch](D19-B1-changes.patch)及 exact before copies 可供 review；[rollback check](D19-B1-rollback.json)只做 reverse check，沒有 apply。移除 B1 會重開已明確退役的驗收路徑；任何後續回退須保留排除／HOLD 或另行 review 及批准，不能用 source rollback 當資料還原。

[變更清單](D19-B1-changed-files.json)、[完整性檢查](D19-B1-integrity.json)及 global evidence seal 核對 source、原證據、107 case、20 task、原 SQL／manifest、release evidence expiry 及允許的改動。原 incident／A／pristine 檔案不覆寫；錯誤／失敗紀錄保留。Review capsules 不授予執行其中 runtime 指令的權限。

文件核對指令：在目前 worktree 執行 `python docs/verification/D19-B1-check-records.py`；這只做本機 source／artifact／Git 檢查及重新封存，不連服務 target。原 A/decision 包中的「未批准 B1」是當時快照；最新批准以本輪 retirement/delivery 紀錄為準，沒有重寫歷史。
