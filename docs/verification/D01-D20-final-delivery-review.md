# D01–D20 最終交付覆核 — 2026-10-24

交付紀錄覆核完成；可確認本機實作、離線測試及已封存的隔離環境證據。正式發布與 pilot enablement 仍是 **HOLD**，並未部署。D15 真實內容、正式 staff 銜接及真實 AI provider 限制全部保留，沒有以本次覆核替代 runtime 驗收。

機讀入口：[adfocate-delivery.json](adfocate-delivery.json) → `finalDeliveryReview`；[本輪明細](D01-D20-final-delivery-review.json)、[完整性檢查](final-review-integrity.json)、[變更清單](final-review-changed-files.json)、[測試計數更正表](final-review-test-accounting.json)。

## 候選與證據綁定

- Worktree：`C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；origin：`https://github.com/YNWAforever/Remix-Adfocate.git`。
- Branch：`codex/adfocate-r1-pilot-20261023`；HEAD／比較基線：`7cfa3dc84c821719a4dff754229a591c81786c53`。候選仍是未提交的 dirty diff，沒有新的 commit，也沒有 push、merge 或 deploy。
- 330 個 canonical-LF source records 全部吻合最新 D20 指紋 `544f5a717aa6550e1dad0acdb3c69041c8530f25f6dd1ed05ca43a847779aa7b`。本輪沒有產品程式、測試或 SQL 改動；沒有重新宣稱整個 commit 已驗收。
- 原有 746 個 evidence records 在改動文件前逐一核實；本輪只更正 N11 的新增結果及增加交付入口，其餘舊證據保留。前一版 delivery、seal 及 N11 所在 CSV 有逐 byte 副本，見本輪 JSON。
- Schema manifest 為 42 份 migration、587 個 distinct declared capabilities，digest `3e6809f9a51b1ac7ebb9f770160aab27f02523ebf69fc47f8fe38f44d05f6363`。584 個 effective capabilities 是 D19 兩個 owned targets 的歷史觀察；本輪沒有查庫。D20 及本輪沒有新 migration。
- 原 audit ZIP 的預期 SHA-256 `0a9d6b96c5e7e216489b80abd45c28731d8e378eeaa6316158340e780bc859e8` 保留。指定 Downloads 路徑本輪不存在，因此**沒有重新驗證 ZIP bytes**；既有 audit 匯入、原始結果與封存證據保持原樣，沒有搜尋其他位置或猜測附件。

## D01–D20 四層覆核

以下測試數來自各任務封存結果，並非本輪重新執行。所有任務均未部署；「真實本機」只指已核實 identity 的 disposable Auth／API／RLS／DB，不代表正式環境。

| 任務 | Code | Test | Deployment | Runtime／剩餘限制 |
| --- | --- | --- | --- | --- |
| D01 | 保留稽核測試；修測試 clock | 原 16 驗收與 194 契約在 D20 全綠 | 未部署 | 正式 evidence expiry 未延長；原失敗紀錄保留 |
| D02 | forward schema 相容修復 | empty／shaped replay；最新 manifest 42 份 | 未部署 | D19 兩個 owned targets 通過；正式 schema／history 未核准處理 |
| D03 | staff、membership、workspace scope 與 session recovery | scope／race 契約及 D19 角色測試 | 未部署 | 正式 staff active membership=0 的既有 scope 限制仍在，不能靠重新登入或移除 gate 解決 |
| D04 | 空白、錯誤、409 與輸入恢復 | 原稽核及已選核心 UI 契約 | 未部署 | D19 核心交接；五項較廣支援 UI 仍 partial |
| D05 | legacy URL 及批准證據防護 | 無效 URL 拒絕、稽核修正與 real API | 未部署 | 無效 legacy URL 不能普通批准；D19 持久化驗證保留 |
| D06 | CRM review／note／audit transaction、revision、idempotency | forced-audit rollback、並發 replay | 未部署 | D19 真實 owned API 原子性證據保留 |
| D07 | 延伸既有 active／proof／reward 引擎 | D19 core 9、角色 8、Edge 5 | 未部署 | 角色刷新見同一 pending 與歷史；沒有新付款功能 |
| D08 | Creator 工作首頁與導航 | 124 targeted、1658 full、2 真實本機 browser | 未部署 | 任務當輪 persisted state；後續核心狀態由 D19 更新 |
| D09 | 任務 DTO、分類與資格一致 | 90 targeted、131 consumers、1686 full、41 integration、1 browser | 未部署 | 360／1280 CSS viewport 的真實本機交接；不代表實機 |
| D10 | queue 服務端分頁／搜尋／返回上下文 | 51 actors 的 25／25／1 分頁；D17 擴展量度 | 未部署 | 原排序／分頁契約保留，未作 production load 驗收 |
| D11 | HK 日曆到期標籤與精確 radar 連結 | 原 16＋194 及日期邊界契約 | 未部署 | 一個既有 HK 日期 fixture 已明列更正；斷言語義及正式 expiry 不變 |
| D12 | 交付要求表單、校驗及預覽 | 106 targeted、1702 full、6 real API、3 browser | 未部署 | unknown policy keys roundtrip、reload 及衝突恢復有證據 |
| D13 | 登入／onboarding／social／Passport projection | 126 targeted、1736 full、8 real API、4 Edge | 未部署 | 本機 Auth／Storage 真實；外部 PKCE UI exchange 為明示 transport mock |
| D14 | 公開承諾與未完成課程顯示 | 66 targeted、1756 full、6 real API、4 Edge | 未部署 | 簡化公開承諾仍需 release owner 確認；不能取代四堂真實課程 |
| D15 | versioned lesson units 與持久化進度 | 140 targeted、1762 full、12 real API／RLS、4 Edge；合成教材 | 未部署 | **BLOCKED_CONTENT_NOT_PROVIDED**；UC-C18／UC-A51 原四堂真實課程未通過；F27 parent Metadata(JSON) 仍 partial |
| D16 | 既有 assistant durable quota／reserve／claim／save／unknown | 契約及既有 real owned integration | 未部署 | 不自動重產 unknown outcome；真實付費 AI 未測；D20 live 前仍需 staff／context 綁定覆核 |
| D17 | bounded performance／a11y／outcome instrumentation | 1k／10k totals、300 API reads、24 UI interactions、5 頁 axe／鍵盤 | 未部署 | 無實機／Safari／native zoom／人工 AT／production p75 證明；不能聲稱總下載量或實際速度改善 |
| D18 | workspace／platform 能力分離與 audited grants | 216 targeted、1849 full、8 real API、4 Edge；D19 角色重驗 | 未部署 | 單 workspace PK 保留；無自動 global admin；正式 owner bootstrap／staff cutover 未執行 |
| D19 | 完整核心交接與 legacy ACL forward repair | 1867 full／363 skip；support 441＋proof 3、role 8、core 9、Edge 5 全部 non-skipped | 未部署 | **R1 verified local/disposable at D19 fingerprint**；formal pilot、hosted release、七日觀察未執行 |
| D20 | 嵌入 brief coach／審稿摘要；沿用既有 assistant | 88 targeted、1931 full／363 skip／272 files、24 mock 子案例、6 Edge mock、5 static gates | 未部署 | **OFFLINE MOCK ONLY；real provider disabled**；沒有更新真實 Auth／RLS／DB E2E，不能冒稱當前來源已重做 D19 runtime |

R0／R1 的本機證據完整保留；最後一次完整 R1 真實隔離交接是 D19 指紋 `e84abd4eded2a9c75443be128d00ebfb7aff7dc878db4263c7d48da34922b4e0`。當前 D20 指紋已通過離線完整測試，但沒有新一輪真實 DB／角色交接。R2 仍有明列 UI／品質／owner 驗收缺口；R3 真實內容及 provider 評估仍未開啟。不能把 D01–D20 全部標成正式 verified。

## Case coverage 與兩項紀錄修正

107 個 audit cases、28 findings、20 tasks、12 個新增產品 cases 均齊全； supplied CSV 的 1645 個原欄位與原 `originalAuditResult` 保留。`status`／`result` 原欄位不是本輪結果，應閱讀 `newResult` 與四層範圍。

| 107-case 群組 | 數量 | 證據範圍 |
| --- | ---: | --- |
| 本機契約通過、保留先前 runtime | 49 | D19 coverage 的歷史分類；D20 契約綠不代表重新跑該 UI |
| owned 核心／角色通過 | 38 | D19 真實核心／角色 scope |
| owned 支援 API／DB 通過 | 9 | D19 support integration；不能推論全 UI |
| 支援 API 部分通過、較廣 UI 未驗收 | 5 | UC-C15／C16／C17／A45／A49 |
| 真實內容受阻 | 2 | UC-C18／A51；原四堂真實教材語義不變 |
| 品質本機契約通過、人工／hosted 未驗收 | 3 | UC-Q01／Q02／Q03，D17 限制保留 |
| 正式部署與 schema 綁定受阻 | 1 | UC-R03；未部署，不能沿用舊正式 catalog 宣稱現況 |

1. **N11 ledger 補記**：原 `result=not-run` 保留；僅 `newResult`／`releaseScope` 更正為 D18／D19 owned 環境角色驗證通過、正式 staff 銜接未執行。依據包括同 session 撤銷 staff／membership／grant、member／偽造 metadata 無法提權、finance 寫入拒絕及沒有預設 global admin。D19 `role-funded-final` 8 項通過、78 次 HTTP observations；沒有把 D20 offline suite 內跳過的 integration 當通過。
2. **skipped 計數附錄**：D19／D20 總計與逐 assertion 狀態正確，但兩份舊報告各有 54 個檔案的 `skipped` 彙總欄位為 0。D20 exporter 只計 `pending`，漏了 Vitest 的 `skipped`。本輪逐 assertion 重算到 [accounting correction](final-review-test-accounting.json)，各為 363 skipped；舊 JSON／logs 全部凍結不改，總計 1867／1931 passed 不變。

28 findings 並非正式環境已全數解決。F20 的 local advisors 有角色／風險／驗證處置，但具名 owner 與 hosted acceptance 未完成；F27 的 parent track Metadata(JSON) 仍暴露。其他 finding 的正式部署／runtime 限制也未被本輪解除。D17 的 463 與 D18 的 471 advisor notices 是不同歷史觀察，不應混成同一次檢查。

## 測試命令、logs 與本輪檢查

最新 D20 原始命令、每項 assertion、static exit 與 mock browser 見 [gate exits](D20-gate-exits.json)、[test results](D20-test-results.json) 及 `logs/D20-*.log`。完整測試在明確停用 integration 的環境執行：

```powershell
$env:RUN_INTEGRATION = '0'
$env:RUN_AUDIT_INTEGRATION = '0'
npm exec --offline --yes --package=node@22 -- node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --no-file-parallelism --reporter=dot --reporter=json --outputFile=.codex-tmp/D20-full-suite.json
npm exec --offline --yes --package=node@22 -- node node_modules/vitest/vitest.mjs run server/lib/assistant src/components/assistant server/test/mission-assist.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism --reporter=json --outputFile=.codex-tmp/D20-targeted.json
npm exec --offline --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test -c playwright.assistant.config.ts
```

結果為 1931 passed／363 explicitly gated skipped／0 failed／272 files，targeted 88、mock Edge 6、static 5 全綠。272 是實際檔案數，不能把 Vitest 巢狀 suite 數當檔案數。原 7 份稽核檔案的 16 項驗收與 10 份既有檔案的 194 契約通過；其中 9 份與 baseline canonical bytes 相同，另 1 份只有先前明列的 HK fixture 時間修正，沒有削弱斷言。

D19 真實隔離環境命令及 logs 見 [D19 delivery](D19-delivery.json)：support runner 441＋proof preflight 3、`run-integration.mjs staff` 8、`run-integration.mjs pilot` 9、`run-pilot-browser.mjs` 5。這些 runner 需要在建立 client／setup 前重做完整 target identity gate；本輪沒有啟動它們，也沒有執行 broad seed／reset／cleanup。

本輪新跑 `release:manifest:check`、`git diff --check` 及 D20 task patch 的 reverse **check-only** 均 exit 0；並核對 330 source hashes、原 746 evidence hashes、435 個明確 evidence／log／patch 路徑與 1645 個 immutable CSV 欄位。機讀詳情與 manifest tool receipt 見 [integrity](final-review-integrity.json)、[local log](logs/final-review-local-checks.log)。因為產品來源未改、最新 source binding 全部吻合，沒有重跑八分鐘完整 suite，也沒有把資料帳目重算記成新產品測試。原 4 個 lint warnings 與 route discovery warning 仍在。

## 完整 E2E 與財務 neutrality 摘要

D19 真實 Creator 登入及 legacy 交付／reviewer 批准後，active 流程完成加入、交付、修稿、再交、發布 proof 修正／驗證、另一 operator 完成，再由 Creator／operator／finance 刷新讀回同一 persisted pending reward 與 15 筆歷史。Creator DTO 的內部 handoff ID 刻意為 null；operator／finance ID 及唯一 DB row、Creator 安全欄位共同核實持久化，沒有為測試公開內部 ID。

[原始 funded snapshots](D19-browser-neutrality.json) 的 pending 測量前後均為 XP145、points550、withdrawable125、point ledger1、cash ledger1、budget8875、budget ledger1、inventory3。取消／再批准另在 `workflow-runtime.jsonl` 保留一個 pending 與 cancelled 前身，原始財務 counters 相同。pending reward 不等於付款。

完整 legacy approval 本來會發放 500 points／135 XP／125 cash 並扣 125 budget；active join 原有 +10 XP。這些均在 pending 測量前保留為 raw anchors，**整段 legacy journey 不能稱為 neutrality**。本輪沒有清零、normalize、補寫 ledger 或查詢任何資料庫；D20 的零 mutation spies／mock UI 也沒有被當成新財務 E2E。

## 未測／受阻與下一步

| 項目 | 仍缺少甚麼 | 下一步與邊界 |
| --- | --- | --- |
| D15／UC-C18／A51 | 四堂已核准真實教材；使用者已確認目前沒有 | 待提供核准 repo 內容／reference 後再續 D15 author→Creator→持久進度驗收；不能用兩堂合成教材結案 |
| 正式 staff 銜接 | exact 既有 staff／workspace 清單、具名 owner、最小 role grants／bootstrap 與 cutover 授權 | 沿用登入成功而 membership=0 的 scope 診斷；維持 membership gate 與 `brand_users.user_id` 單 workspace PK。本輪不修改正式角色／membership |
| R2 支援 UI／F27 | 五項 empty／application／campaign／Academy UI 的較廣驗收；parent Metadata(JSON) 業務化尚未完成 | 先界定需要啟用的產品範圍，再逐 case 驗證／修復；不能用支援 API 成功取代 UI |
| D17／F20 | native zoom／實機／Safari／人工 AT、hosted／field performance、具名 advisor owner、部分真實 outcome 來源 | 保留 unavailable，不能填造零或聲稱速度提升；依 owner 的實際部署範圍補驗收 |
| D20／R3 | 真實模型品質 ≥90% 的評估、真實 token／latency／cost、staff＋context 綁定的既有 D16 durable quota／request／crash／replay 覆核 | 真實 provider 及 UI live generation 維持 disabled；24 mock 結構／安全 cases 不是真模型品質分數；未獲單獨授權不啟用／呼叫付費 AI |
| 當前來源完整 runtime | D20 沒有重新跑完整 Auth／RLS／DB／legacy／active／角色／neutrality | 日後候選確定後，先 identity gate 再按變更影響更新必要 owned integration／E2E；不能把本次文件覆核稱為新 runtime |
| 正式 release／UC-R03 | reviewed commit、同版本 CI、exact hosted deployment、current read-only schema／history／grants／RLS preflight、release ticket／operator／rollback owner、fresh protected evidence | 準備材料已在 release-review-request.json；`canDeploy=false`／`canEnablePilot=false`。前一版 evidence expiry 不可延長；本輪不請求／執行發布 |
| pilot 運行 | 正式 enablement 與連續七日 observer／exit review | 待前述 gates 與當次授權齊備才執行，不能以 READY／成功 toast 替代持久化證據 |
| 外部／金流驗收 | 真通知／邀請／email／SMS、social metadata／publication、付款／提款 provider | 本次範圍以 mock／sandbox 或 NOT_RUN 明示，沒有真實訊息、付費 AI 或付款 |
| 原 audit ZIP | 本輪指定路徑沒有 archive bytes | 既有結果保留；如需重新獨立驗 SHA，需可讀的原 ZIP，不能聲稱本輪已重驗 |

沒有定義 D21。既有 `nextTask` 保留 **D15：BLOCKED_CONTENT_NOT_PROVIDED**；其餘下一步依獨立輸入與授權處理，不會自動改正式 staff、啟用 provider 或發布。

## Rollback 覆核

| 範圍 | 可 review 的回復／containment | 本輪是否執行 |
| --- | --- | --- |
| 本輪紀錄 | `final-review-prior-delivery.json`、`final-review-prior-new-product-acceptance-cases.csv` 與前一 seal 保留 exact bytes；如回復文件，只改本輪欄位並重建 seal | 沒有回復或刪除證據 |
| D20 app | provider／UI live flags 保持 off；`git apply --check --reverse --ignore-space-change docs/verification/D20-changes.patch` 通過 | **僅 check**，沒有套用 patch |
| D01–D19 app | 按依賴逐 task review 原 patch／before-images；重疊 hunks 要重新核對，不能假設所有舊 patch 可在當前工作樹直接反向套用 | 本輪沒有驗證所有舊 patch 的自動可逆性，也沒有 bulk revert／reset／clean |
| D18／D19 安全 | 保持 fail-closed；舊 server／廣泛 ACL rollback 會恢復過大權限，應優先 reviewed forward repair | 沒有退回 membership／role gate、恢復 broad grants 或修改正式資料 |
| SQL／資料／fixture | 保留 migration checksum／history、workflow／proof／reward／audit／ledger；只容許 reviewed forward repair。fixture 清理必須用本輪 exact retained IDs | 沒有 down／reset／blind db push／broad seed/delete，也沒有清理 retained fixtures |
| Hosted | 先 pin 真實上一版 compatible live SHA、具名 rollback owner、恢復演練及 current target，再處理當次正式授權 | **未部署、未做 hosted rollback／restore 演練**；owner／live SHA 尚未建立 |

任何程式 rollback／forward repair 後都需重新產生來源指紋、按影響重跑 gates，再重新綁定 release 證據。舊測試、PR／READY 或本次文檔 seal 不能代替新候選的正式驗證。
