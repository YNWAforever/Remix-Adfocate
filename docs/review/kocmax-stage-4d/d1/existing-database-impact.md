# 直接使用 Remix-Adfocate 現有資料庫：確認前影響評估

日期：2026-10-31 HKT。使用者指定 [Remix-Adfocate](https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf) 的現有資料庫，並要求先列出影響供確認。

**結論：可以把它列為後續受限試點的候選目標，但它不符合原 D1「獨立空白資料庫」的隔離條件。直接使用需要改寫執行及驗收範圍；目前未批准寫入。這次沒有套用 SQL migration、建立帳號、寫入測試資料、建立分支、授權 Instagram／Drive 或部署。**

## 已核實的現況

| 項目 | 這次唯讀結果 | 能證明／不能證明的事 |
| --- | --- | --- |
| 專案 | `mhkoayftiuojxlrkollf`；`Remix-Adfocate`；`ap-northeast-1`；ACTIVE_HEALTHY | 是現有產品資源；名稱與健康狀態不代表可丟棄 |
| 遠端 migration 記錄 | 14 筆，最後 `20260623155639 / 0022_notifications` | 不能單靠此記錄排除另有人工 SQL；已另外查相關物件 |
| 本分支 | 92 個 migration 檔案；release manifest 涵蓋 62 個後續項目 | **不是**「直接套用 78／62 個」的批准清單；歷史命名／版本不同，需逐項對齊 |
| Studio／integration 物件 | `public`、`private` 中未找到 `studio_*`、`integration_*` 資料表；相應 RPC 未找到 | 本分支的新資料流程尚未具備可直接使用的基礎 |
| 新版任務流程 | 未找到 `mission_workflows`、`mission_work_items` 等工作表 | Studio 轉存任務所依賴的新版流程需要先解決 |
| 既有任務物件 | `creators`、`workspaces`、`missions`、`mission_submissions`、`mission_shortlists` 存在且 RLS 開啟；`approve_submission(uuid,text,smallint)` 存在 | 只是結構與權限設定觀測，不是普通使用者 JWT/RLS 或整體旅程驗收 |
| 分支／Edge Functions | 分支清單、已部署 Edge Functions 清單均為空 | 不等於沒有 DB jobs、webhook、外部 hosting 排程或第三方憑證；這些未在此次檢查中驗證 |

查詢只讀 migration／系統目錄等結構 metadata，沒有查閱個人檔案、聊天內容、token、用戶清單或任務資料。以上是指定專案當時的結果，不推定其他環境也相同。

## 直接使用的具體影響

| 範圍 | 影響 | 執行前需要的措施 |
| --- | --- | --- |
| 功能與 schema | 不是單一 adapter 設定。新增 Studio 會改 `missions` 欄位並建立私人討論、來源、Brief、轉存及徽章；轉存依賴新版任務表。整合會改 `creators` 複合約束並增加來源、快照、同意與憑證儲存 | 對齊遠端結構、migration 歷史和本機依賴；形成逐項、帶 hash 的最小變更清單，不能直接跑全庫 push |
| 共用函式與觸發器 | D0 pilot migration 會移動／重包 `public.integration_command`，改 OAuth constraint，並在 `creators`、連接、來源／快照增加觸發器。這些是共用 DB 行為，即使前端旗標關閉仍已改動資料庫 | 對既有呼叫方做相容性檢查；審閱每個函式／觸發器的變更與回退方式。現有 DB 尚無前置物件，因此不能直接套用 D0 migration |
| 身份與私人資料 | 共用 Auth、Storage、API 和管理權限；新增 workspace 是邏輯分隔，並不是獨立系統。service role 不受一般 RLS 限制 | 專用測試身份、workspace、明確資料 ID、限制寫入的伺服器路徑；最小 DB 權限；普通 JWT 和直接 Data API 反例。不可沿用能任意操作全庫的測試腳本 |
| 任務、積分與副作用 | 原流程測試可能新增申請、審批、通知、徽章或帳本記錄；跑錯目標會污染真實成果。設定或排程亦可能涉及郵件、模型或社交掃描 | 測試資料與可見性明確標記、出口關閉、禁止真實兌換／品牌交付，保存精確寫入與清理清單。先確認沒有使用真實任務和真實獎勵 |
| 可用性與資源 | migration 的鎖、索引、回填及測試查詢可能與現有請求競爭；新增檔案／日誌佔用原配額 | 評估表規模／DDL 時間、限制查詢與批次、觀測原功能、安排必要維護窗口。此次未查表內容或做壓力測試，不估算無根據的停機時間 |
| 還原與刪除測試 | 無法把整個共享資料庫封鎖或還原，又保證現有產品完全不受影響。備份也包含其他用戶資料 | 禁止在此做全庫 restore、故障注入、廣泛 purge 或清空。完整備份還原／tombstone 演練仍需要另外的可丟棄環境；不能將其標為 D1 通過 |
| 費用 | 沒有新增分支的獨立運算費，但試點使用原專案 compute、storage、egress 等配額 | 仍需有限測試預算／用量界線；本次未確認超額餘額，不宣稱零新增成本。先前分支報價不是此方案的報價或已接受費用 |

## 建議改成「現有專案受限試點」

保留同一程式分支和現有功能，將可批准內容分開：

1. **資料庫對齊包**：逐項對照已部署結構與本機 migration；列出最小必要變更、既有呼叫方影響、前置條件、預期鎖／資料變更和回退。這次沒有提出或批准整批 migration 執行。
2. **最小寫入包**：明列測試 workspace／身份／任務／帳本及資料 ID、可讀寫的表和函式、禁止出口、清理負責人。只做可精確清理的正常流程；不使用真實創作者資料。
3. **受限驗收包**：手機／桌面可用性、指定角色、來源隱私、一次性入帳及權限反例；完整還原、跨環境隔離與破壞性測試保留未驗證，另行安排可丟棄目標。

原 D1 的資料庫 target gate 會拒絕這個已知現有產品專案。若選共享方案，應新增明確的受限模式與上述批准資料，**不可刪除 denylist、偽造 target receipt 或用普通環境旗標繞過限制**。

真實 Instagram／Drive、Picker token／SDK、外部 AI、正式部署、分支合併仍維持關閉。Instagram 的撤銷協定、callback ID 映射、authorize host 和指定帳號資格等門檻不因改用現有 DB 而解除。

## 目前可確認的決定

需要先決定是否接受上述「共用資源、受限驗收」取代獨立 D1；這個方向確認本身**不包含未列出的 migration、測試寫入或全庫還原授權**。精確 SQL 變更／資料寫入清單完成並審閱後才可執行。

本輪已進行的本機 D1 工作與測試留在同一分支；它們是準備與本機證據，不是這個現有資料庫的 runtime 驗收，也不是 D1 完成。
