# SQL 準備包的驗證範圍

本次完成標準是可審閱的精確 SQL、測試資料及回滾方案；不是向共用資料庫套用、啟用 D1 或完成真實平台試點。

| 層級 | 實際結果 | 證據及限制 |
| --- | --- | --- |
| 原檔保留 | PASS | 62 個 manifest 來源的 LF 標準化 hash 及實體檔案 hash 均核對；原 release manifest 保留。原 92 個 migration 檔沒有改動。先前 D1 工作未覆蓋。 |
| SQL 解析工具 | PASS，3 tests | 引號、巢狀註解、dollar block、外層交易邊界、安裝函式與實際呼叫分開處理。 |
| 目標唯讀前置檢查 | PASS | `00` 結構指紋、`02` 欄位權限／擁有人／Storage／Auth hooks 等指紋一致；`01` 四個布林檢查通過。無資料修改，無個人資料列或密鑰回傳。見 `read-only-preflight-results.json`。 |
| 完整 SQL 變更內容 | PASS，僅記憶體 | 對觀察到的 39 張空表模型排演 62 個來源、基礎函式修正、55 張新表權限補丁、39 張既有表權限補丁、作品集相容修正及後置條件。來源 SQL 及產品程式未改。 |
| 錯誤及回滾 | PASS，僅記憶體 | 完整包缺少批准參考時，在寫入前拒絕；所有 DDL 後注入錯誤再回滾，模型的結構／函式／權限指紋與之前完全一致。 |
| 私人 Brief fixture | PASS，僅記憶體 | 主人可讀、同 workspace 同伴／跨 workspace／匿名不可讀；來源保持未驗證；沒有積分、現金、XP 或徽章；缺身份／批准參考和 ID 碰撞即拒絕。正常及反例均回滾。 |
| 既有旅程 | PASS，五組本機 SQL 角色案例 | 個人檔案／onboarding 的七個欄位、社交 handle CRUD、通知已讀、品牌任務編輯、精選作品 CRUD 與三項上限；同時檢查敏感欄位、跨用戶、任務狀態、活動／歷史直接寫入及兌換碼讀取被拒。詳見 `local-rehearsal.json`。 |
| 獨立審閱 | 接受，有明確限制 | Reviewer Euler，`01a1928e-d28d-7823-989f-d43ab271e4c5`，檢查 SQL 順序、回滾、權限、來源／導出 hash 及作品集修正；沒有 P1／P2 問題。只做靜態審閱，沒有獨立重跑測試或任何遠端操作。 |
| 現有用戶資料／部署版本相容 | NOT TESTED | 空模型不含真實用戶；未證明目前部署的所有呼叫方與新 SQL 相容。四個前置布林檢查也不能代替此項。 |
| 真實 Auth／兩連線競爭／Storage | NOT TESTED | 沒有建立或登入測試帳號，沒有兩連線鎖定／撤銷競爭、檔案上傳或平台事件觸發器驗收。 |
| 手機與桌面 | NOT TESTED 本次 SQL 包 | 之前本機畫面證據不能證明本次共用資料庫／JWT 整合；回滾型 fixture 不會跨連線供瀏覽器使用。 |
| 真實積分結算／徽章／兌換 | NOT TESTED | 本輪驗證「寫 Brief 不派獎」；沒有冒稱完成任務結算旅程，也沒有建立可兌換餘額。 |
| Google／Instagram／外部 AI | DISABLED | 測試輸入只在檔案；未使用 token、真實帳號、API 或遠端檔案。 |
| 資料庫套用／部署／history 登記 | NOT PERFORMED | 沒有任何遠端 DDL/DML、帳號、資源、程式部署或 history 寫入。 |

## 本機重現與來源

```text
node scripts/integrations/build-shared-db-review.mjs
node scripts/integrations/package-shared-db-review.mjs
node --test scripts/integrations/shared-db-sql.test.mjs
node scripts/integrations/rehearse-shared-db-packet.mjs
```

最終 SQL 內容 hash 為 `c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff`。完整檔案 hash 及測試工具 hash 在 `packet-manifest.json`；執行時間、同一 manifest 的 hash、案例結果在 `local-rehearsal.json`。之後任何檔案改動都須重新驗證，不把這份結果套用到不同版本。

PGlite 只使用寫死的 `memory://`，沒有資料庫網址或遠端 client；fetch 禁用並記錄零次嘗試。Auth claims、Storage 結構／函式是替身；`kb_chunks.embedding` 用文字代替，向量索引／`match_kb_chunks`、平台 `rls_auto_enable`／DDL event triggers、真實 owner／grantor 及其他 owner 的預設權限未重建。基礎函式的 API 權限及 schema 權限按觀察值重建；這是本機模型，不是真實 Supabase Auth 驗收。

本機排演使用完整包中雜湊一致的變更區段。實際目標／伺服器版本／擁有人指紋不能在這個替身通過，因此把遠端唯讀前置證據與本機寫入排演分開；沒有藉測試繞過正式 runtime 的產品資料庫拒絕規則。

`30-fixture-transaction.sql` 本身固定回滾；額外的本機旅程檢查只在記憶體中延後該回滾以加入角色案例，再一併撤回。這些額外社交 handle、通知及作品集資料不屬於獲准的共享資料庫寫入，也不是持續的瀏覽器 fixture。

## 排演中解決的問題

- 新表預設繼承寬鬆 API 權限，導致原來源的權限斷言失敗。已在每張新表建立後撤銷繼承權限，再保留來源明確授權，未修改原 migration。
- `CREATE TABLE IF NOT EXISTS` 的任務草稿冪等表原未納入新表清單；已修正導出器，最終是 55 張新表，與實際本機前後差異一致。
- 原完整更新收窄 private schema 後，直接精選作品會出現 `42501 permission denied for schema private`。`13-portfolio-compatibility.sql` 在保留 invoker／owner／ACL／search_path 下內嵌完全相同的鎖定算式；CRUD、跨用戶拒絕及第四項精選被拒已通過本機驗證。
- 早期模型未完整重建既有 schema／function ACL；最終排演已加入它們。早期 `declared-closure-diagnostic.json` 僅為診斷紀錄，不是最終驗證結果。

## 套用前仍未解決的操作決定

共用資料庫執行批准、維護窗口／備份恢復負責人、實際部署呼叫方確認、四個專用 Auth 身份、持續 fixture 的寫入／清理界線，以及導出 SQL 的獨立 history 登記方式均未獲執行批准。套用型版本須重新凍結、核對來源並審閱；目前 `10` 最後一行仍為 `ROLLBACK`。
