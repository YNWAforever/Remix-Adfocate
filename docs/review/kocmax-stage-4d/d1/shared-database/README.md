# 現有 Remix-Adfocate 資料庫：SQL 審閱包

**狀態：只準備；未套用。** 指定目標為 `mhkoayftiuojxlrkollf`，沿用 `codex/kocmax-studio-stages-1-2`。本輪沒有修改正式資料庫、migration history、Auth 帳號、雲端設定或既有 migration 原檔；沒有部署或建立 Instagram／Google Drive 連接。先前 D1 的工作仍保留，產品資料庫拒絕規則仍開啟。

## 審閱入口

| 檔案 | 用途與預設結果 |
| --- | --- |
| [10-forward-proposed.sql](10-forward-proposed.sql) | 完整單一交易提案，含批准參考、結構／權限／資料檢查、變更和後置驗證；最後固定 `ROLLBACK`。不會自行提交。 |
| [packet-manifest.json](packet-manifest.json) | 目標、分支、HEAD、原檔與導出 SQL 的 SHA-256；任何改動後均須重新組裝和測試。 |
| [12-baseline-acl.sql](12-baseline-acl.sql)、[acl-review.md](acl-review.md) | 現有表的權限補丁、保留的編輯欄位及限制；須連同完整包審閱。 |
| [13-portfolio-compatibility.sql](13-portfolio-compatibility.sql) | 保留舊有作品集精選操作及三項上限；把原本相同的鎖定算式直接放回觸發器，沒有擴權。 |
| [30-fixture-transaction.sql](30-fixture-transaction.sql)、[fixtures-plan.json](fixtures-plan.json) | 固定測試 ID、四個待綁定 Auth 身份、最多 20 筆測試資料、私人 Brief 與權限反例；一律回滾。 |
| [provider-test-cases.json](provider-test-cases.json) | 未連接／撤銷／部分資料、Drive 權限不明／無法下載／刪除等離線測試輸入；沒有真實 token 或外部檔案。 |
| [rollback-plan.md](rollback-plan.md) | 未提交時的精確回滾、提交後的停止及前向修補原則；不以刪表撤銷近期修正。 |
| [verification.md](verification.md) | 實際執行的本機檢查及尚未驗收項目。 |

`sql/` 是來源參考，`derived-sql/` 是完整包的組裝材料。**兩者都不可逐檔向現有資料庫執行。** 唯一完整提案為 `10-forward-proposed.sql`；本文件不是執行授權。

## 為甚麼不只加兩個平台的表

2026-10-31 唯讀比對顯示：現有資料庫有 39 張應用表，但只有 14 筆 migration history；多個基礎功能已存在，不能按檔案數差額推算待執行數目。Studio 依賴新版任務、審批、獎勵及助理資料結構，而這些結構尚未在指定資料庫出現。只套用最後五個 Studio／整合檔案會缺依賴。

完整提案採用分支 release manifest 的 **62 個後期來源檔**，保留近期修正及可呼叫介面；這是審閱範圍，不表示確認有 62 個「未執行更新」。較小的 54 檔依賴分析只作比較，見 [dependency-analysis.md](dependency-analysis.md)。原有 30 個基礎來源不整批重播，也不重建現有用戶、等級、餘額或內容種子。

## 精確變更範圍

| 範圍 | 提案內容 | 共用資料庫影響 |
| --- | --- | --- |
| 一項基礎修正 | 從 `0017_social_verification.sql` 抽取最終 `public.apply_mission(uuid)`；現有版本仍是較早的 0010 函式 | 恢復原分支的等級／社交驗證條件；保留函式簽名、擁有人及既有 ACL。 |
| 作品集相容補丁 | 保留 `private.enforce_creator_portfolio_highlight_limit()` 的呼叫者權限，內嵌原本 UUID 鎖定算式 | 本機實測原完整包會讓舊版直接精選作品操作遇到 private schema 權限錯誤。補丁保留原鎖定鍵及三項上限，不重新開放 private schema 或提升函式權限。 |
| 62 個來源檔 | 任務工作流程、發佈證明、獎勵合約、CRM／助理／學院／角色／同意紀錄，以及 Studio 和整合儲存 | 新增 55 張應用表；也新增／替換共用函式、觸發器、欄位、索引、限制及 RLS。不是只對一個 workspace 生效。 |
| 新表權限補丁 | 每次 `CREATE TABLE` 後立即移除新表繼承的寬鬆 API 權限，再保留來源檔的明確授權 | 避免預設權限讓新表意外可寫；不為此改寫全資料庫的預設表權限。 |
| 既有表權限 | 依 [acl-review.md](acl-review.md) 收窄具體表及欄位 | 舊的整表權限會蓋過逐欄撤權；此調整會影響既有 API 呼叫，須做真實角色回歸。 |
| 檔案庫設定 | `mission-draft-assets`、`mission-publication-proof-assets`，私人、各 20 MiB 檔案上限 | 只建立設定，不上傳檔案。兩個名稱目前不存在；若執行前出現即停止。原頭像政策保留。 |
| 來源中的預設函式權限 | 原第一個更新包含全域／private schema 的預設 EXECUTE 收窄及 private schema USAGE 調整 | 須明確審閱，不能說功能開關會隔離這些影響；不自動還原寬鬆預設權限。 |
| 資料更新 | 兩個檔案庫的建立／最終 MIME 設定；證明附件回填作用於同交易剛建立的空表 | 55 張新應用表在變更結束時必須仍為空；不呼叫任務轉換、試點啟用、角色分配、發獎或結算函式。 |

逐句來源及影響見 [statement-inventory.json](statement-inventory.json)、[top-level-effects.json](top-level-effects.json)。本機前後差異見 [projected-schema-diff.json](projected-schema-diff.json)，它是空資料模型的結果，不能代表真實資料的相容性。

PostgreSQL 的整表權限與欄位權限要一起核對；RLS 也不能代替撤銷不必要的表權限。[Supabase 官方說明](https://supabase.com/docs/guides/api/securing-your-api)。部分結構更新會鎖表或驗證既有資料，因此設定短鎖等候並要求維護窗口。[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)。

## 測試資料與隔離界線

預備兩個新 workspace、三個創作者和一個操作員；使用四個由擁有人日後明確指定、彼此不同且沒有產品角色的專用 Auth 身份。SQL 不會建立 Auth 帳號、發邀請或借用現有顧客身份。

唯一任務是草稿狀態的「示例任務：香港茶飲短片 Brief」，預覽關閉、現金為零；10 分只是一個任務設定，不會入帳。來源明示香港／繁中、手動及「未驗證」，Brief 預設私人。連接、寫 Brief 或登入均不會產生積分、XP、現金或徽章。

固定 ID、預計行數、可寫表及禁止寫入範圍在 `fixtures-plan.json`。身份不完整、ID／slug 碰撞或資料不符即停止，沒有 upsert 或刪除後重試。所有測試寫入都在一條交易內回滾；這些資料不能跨連線供瀏覽器使用。持續的手機／桌面試點資料仍需獨立寫入清單及批准。

## 日後執行前仍須完成

1. 明確批准針對**共用資料庫**的範圍、SQL hash、維護時間及回復負責人；本次只批准準備。從可信控制平面確認實際專案 ID；在 SQL 裡填同一字串不是環境身分證據。
2. 確認備份及恢復安排。在同一目標重跑 `00-preflight.sql`、`02-extended-preflight.sql` 及 `01-data-preflight.sql`。本輪唯讀結構檢查及四項資料一致性布林檢查均通過，沒有回傳個人資料列；見 [唯讀結果](read-only-preflight-results.json)。任何新的漂移、false 或逾時都停止，不能自動修資料來通過。
3. 解決 migration history 記錄方式。這是帶有權限補丁的導出提案，不可冒充原有 62 個檔案的原樣執行，也不可修改現有 14 筆歷史。普通 release runner 及 manifest 保持原狀；提交型版本須有獨立的精確執行收據與登記方案。
4. 完成可丟棄環境的真實 PostgreSQL/Auth/Storage、既有旅程和還原驗收。本機 PGlite 沒有現有用戶資料、平台 DDL hooks、真實 JWT 或流量，不能證明現有部署與所有新 RPC 相容。
5. 若批准共用資料庫演練，用單一專用連線、遇錯即停；預設包仍以回滾結束。提交要另產生審閱版本，不可臨時把最後一行改為 `COMMIT`。
6. 實際瀏覽器試點、已登入的手機／桌面測試、真實 Instagram／Drive、外部 AI 及部署繼續各自關閉。現有 D1 仍未完整完成，D2 亦未獲准。

## 本機重現

以下程式只讀原始 SQL、寫審閱產物，並使用寫死的 `memory://`；不接受任何資料庫網址或平台密鑰。先組裝再排演，最後才更新驗證文件。

```text
node scripts/integrations/build-shared-db-review.mjs
node scripts/integrations/package-shared-db-review.mjs
node --test scripts/integrations/shared-db-sql.test.mjs
node scripts/integrations/rehearse-shared-db-packet.mjs
```

原始結構與定義快照只含唯讀 metadata；角色名稱可能被工具遮罩。它們是比對證據，並非可直接還原的完整資料庫備份。
