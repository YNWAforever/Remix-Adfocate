# R2 指定 UI 與 F27 parent 表單交付 — 2026-10-24

UC-C15／C16／C17／A45／A49 與指定 F27 parent Metadata(JSON) 表單已完成本機修復及驗證。沒有部署，也沒有把本輪結果提升為全 R2／正式環境驗收。機讀入口：[R2-ui-delivery.json](R2-ui-delivery.json)；[主交付紀錄](adfocate-delivery.json)。

## 來源與授權

沿用 `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，origin `YNWAforever/Remix-Adfocate`。沒有 reset、commit、push、merge 或 deploy。15 個 source/test/harness 檔案，342 個來源 records，fingerprint `8725bc0031451e8ece2eb41102f8aafc2e6cd4fe697f51cabf495221d42d4be0`。完整變更與 task-only rollback patch 見 [changed files](R2-ui-changed-files.json)、[patch](R2-ui-changes.patch)。

本輪沿用已授權 disposable target，重做 container／image／network／loopback mapping／project／owner identity gate 後才建立 client 或 setup。只建立 4 個新 Auth actors、2 個 workspace、3 個合成 parent tracks；只替新的 fixture operator 建立 1 個 workspace grant 及 1 個 platform grant。沒有修改正式或原有 staff 的 membership／角色。Exact IDs 保留於 [fixture](R2-ui-fixture.json)；[唯讀 retention](R2-ui-fixture-retention.json) 確認 lesson units=0，schema history=72。沒有 seed/reset／cleanup。

## 四層結果

| 層次 | 結果 |
| --- | --- |
| Code | 延伸六個既有 routes、RequestFeedback 及 AcademyEditor；加入業務欄位與 metadata 三方合併 helper，沒有平行 workflow／proof／reward／AI 引擎 |
| Test | 1950 passed／363 明確環境 gate skipped／0 failed／274 files；原 16＋194 契約綠；本輪新增 19 assertions；八項真實本機 Edge；五個 static gates 通過 |
| Deployment | **未部署**；沒有 CI／hosted／正式環境驗證 |
| Runtime | 真實本機 Auth／API／RLS／DB 的 scoped empty reads、資格列表、parent 儲存／hard reload／真正 409 通過；空列表及 503 mocks 的邊界如下 |

## 逐項驗收

| 項目 | 修正及持久化／UI 證據 | Mock 邊界 |
| --- | --- | --- |
| UC-C15 | 真實空兌換記錄與返回入口；失敗可 Retry；403 後隱藏舊 code／快取資料 | 503 fault 為 transport mock；撤銷後快取隱藏以 component/query-boundary test 驗證 |
| UC-C16 | 真實沒有 active challenge；失敗不能冒充空白，恢復後重新讀取 | 503 為明示 transport mock |
| UC-C17 | 真實可讀／準備中 parent 與鎖定資格；unit 覆蓋 L3 門檻，browser 使用真實 Creator 狀態；沒有課程時顯示清楚空白 | 空 Academy bundle 與 503 是明示 transport mock；保留舊 global rows，不刪資料製造空庫 |
| UC-A45 | 真實空申請、可恢復錯誤；stale 資料有提示並禁止接受／拒絕 | 503 與 stale decision component 的網絡邊界為明示 doubles；沒有做真實申請決策 |
| UC-A49 | 真實空 workspace challenge 與新增入口；內容空白保留 New content；filter 在失敗／恢復後保留 | 既有 global content=9，內容空列表用明示 transport mock；恢復後真實 API 讀取；沒有 publish／settle |
| F27 | parent raw JSON 改成課程／playbook／resource 的有標籤欄位；保留中文／英文、未知 keys 與未存輸入。真實儲存／hard reload，以及 server concurrent update→409→compare→明確確認→重送→reload 均通過 | 首次 PATCH503 為明示 transport mock；成功寫入及 409 都是真實 API／DB；合成 parent 無課堂單元，不能當核准教材 |

逐項結果見 `R2-ui-UC-*.json`、`R2-ui-F27-roundtrip.json`、`R2-ui-F27-conflict.json` 及 [browser summary](R2-ui-browser-summary.json)。原 107 cases／28 findings 的原始結果與 supplied CSV 1645 個原欄位保留，只更新新結果；舊 D19／D20／最終覆核檔案保持歷史版本，不回填成新驗證。F27 是指定 parent 表單範圍的 closure，不能推論全產品所有管理欄位都完成業務化。

## 測試及根因

先取得 confirmed RED：4 passed／11 failed，再最小修正。初次測試文案、Testing Library `exact` options、過期 JSON textarea 斷言與等待 query notifications 的 harness 問題分開記錄；沒有改動原 16／194 的斷言。第一次 browser 5 pass／2 fail 是 selector 文案與 background recovery 後 Retry locator detached；改用正確返回入口及正常鍵盤恢復，沒有 force click 或移除持久化斷言。最後八項全部通過，無 skipped／retry。完整歷史見 [test history](R2-ui-test-history.json)。

主要實際命令（Node 22.23.4；offline suite 的 RUN_INTEGRATION／RUN_AUDIT_INTEGRATION=0、DB/provider keys 空白）：

```powershell
npm exec --offline --yes --package=node@22 -- node node_modules/vitest/vitest.mjs run src/routes/-r2-support-ui.test.tsx src/components/admin/AcademyMetadataForm.test.tsx --maxWorkers=1 --minWorkers=1 --no-file-parallelism
npm exec --offline --yes --package=node@22 -- node scripts/audit/run-r2-support-browser.mjs
npm exec --offline --yes --package=node@22 -- node scripts/audit/run-r2-support-browser.mjs --resume
npm exec --offline --yes --package=node@22 -- node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

最後 type-check、harness tsc、lint、release:manifest:check 及 Node22 build 均 exit0。Lint 是原有 4 warnings；route discovery／bundle warnings 保留。完整命令、exit、每個 assertion 與 logs 見 [gates](R2-ui-gate-exits.json)、[suite](R2-ui-suite-results.json)、`logs/R2-ui-*.log`。各檔案 skipped 直接按 persisted statuses 計數，沒有重犯舊 pending-only 計數問題。完整 suite 中 363 個 skipped 仍不是 PASS。

## Schema、neutrality 與限制

Manifest42、587 declared capabilities、digest `3e6809f9a51b1ac7ebb9f770160aab27f02523ebf69fc47f8fe38f44d05f6363` 與全部既有 SQL bytes 不變，沒有新 migration、RLS／ACL／RPC／history repair；詳見 [schema diff](R2-ui-schema-diff.json)。584 effective capabilities 是 D19 歷史完整 catalog，本輪沒有聲稱新做全 catalog 或正式 schema 驗收。

本輪 [raw neutrality](R2-ui-neutrality.json) 的兩位新 Creator 前後完全相同：points50、XP0、withdrawable0、ledger0、budget=null、inventory空。這是 R2 UI／metadata 的獨立觀察；D19 funded pending／cancel／reapproval 與 legacy issuance anchors 原證據保留，不能把本輪結果稱為新一輪完整 R1 E2E。既有 fixture factory 只在 workflow-runtime.jsonl append 一筆新 fixture event；舊 bytes 保留為 prefix，另存 [原始副本](R2-ui-prior-workflow-runtime.jsonl)。

仍然受阻／未測：D15 的四堂真實教材（UC-C18／A51）仍 BLOCKED_CONTENT_NOT_PROVIDED；正式 staff owner bootstrap／membership／cutover 未獲授權；真實 provider 維持 disabled，AI 真實品質／token／latency／cost 與 D16 staff/context durable request 覆核未做；實機、Safari、native zoom、人工 AT、hosted／field performance、F20 具名 advisor owners、正式 CI／deployment／current schema preflight／pilot enablement／七日觀察均未完成。沒有真實通知、邀請、對外發布、付款或付費 AI。

## Rollback 與下一步

僅 review `R2-ui-changes.patch` 的本輪 hunks 與新增檔案，reverse **check-only** 通過，沒有套用。保留以前的 dirty work、合成 parent rows、exact fixture IDs、grants、workflow／audit／reward history；沒有 down migration、reset／clean、broad delete 或回退至過大 staff／ACL 權限。若 rollback／forward repair 改來源，重新 fingerprint 並按影響跑 gates。Hosted rollback owner、compatible live SHA 與 restore drill 仍未建立／執行。

下一項為 **D17 剩餘 R2 品質及 advisor owner 驗收**，依實際裝置／runtime／授權處理；D15 的內容 blocker 獨立保留。`canDeploy=false`、`canEnablePilot=false`，protected evidence expiry 未延長，沒有請求或執行正式發布。


## 封存前補充：legacy metadata 相容性

首輪 1949／7-browser 結果保留在 R2-ui-initial-verified-*。最後自覆核補出 plain-string metadata baseline 的雙語409邊界：先6 pass／1 fail，再修正合併基線，metadata表單7項通過；真實本機另跑純字串→並行英文更新→409→比較確認→儲存／reload，八項browser全綠。新完整suite為1950 pass／363 skip／274 files，原16＋194保留；五個static gates按最後source重跑。沒有用首輪seal代替補修後證據。
