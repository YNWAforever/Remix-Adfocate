# P0 執行結果與新增 SQL 審閱

> **目前狀態（2026-11-03）：** 本文件是 P0 審閱與套用當時的歷史紀錄。其後九帳戶真實登入／權限測試及精確資料清理已完成；以[D1 收尾](../D1-CLOSEOUT-20261103.md)和[完成回執](cleanup-completion-20261102T151423Z.json)為準。下文「REAL_AUTH_PENDING」「尚未建立帳號」等字句只代表原紀錄時間，不是目前待執行事項。

日期：2026-11-01（香港時間）  
分支：`codex/kocmax-studio-stages-1-2`  
狀態：**SQL_APPLIED_AND_POSTCONDITIONS_PASSED / REAL_AUTH_PENDING**

執行續記：使用者批准後，新備份 `20261101T073819Z-4e90d939a7a144639faa6a720e0d1f6c` 已通過完整讀取及實際隔離還原，比對 94 張表／110 筆應用資料、86 條政策及 15 筆 migration 基線一致。[還原回執](checkpoint-restore.json) 保留範圍與限制。批准 SQL 已一次成功套用為 `20261101075946 / kocmax_auth_permission_boundary`，資料庫保存的 6,869 bytes 與批准 SHA 完全一致；政策變成 89 條，原應用資料指紋不變。[套用回執](application-receipt.json) 是目前執行狀態依據。以下 P0 準備與待審說明保留為歷史，不代表 SQL 仍待批准。

使用者的 continue 延續原 P0–P3 方案。P0 找到實際阻斷問題，已在同一分支修正程式並完成本機驗證；新增的資料庫規則仍是待審候選。沒有建立 Auth 帳號、共用資料庫測試資料、部署、Instagram／Drive 連接或索引變更。

## 已重現與修正

1. **跨工作區初始化誤建餘額。** 原 bootstrap 依請求 workspace 建立餘額，但既有 creator 的 workspace 不會隨 upsert 移動。只增加一次讀取仍不能消除刪除／首次登入並行空隙。
   - 本機路由改為：核實 Auth → 保留 workspace allowlist → 呼叫單一 service-only 初始化 RPC。
   - 新 RPC 在同一交易內處理首次 creator、鎖定 canonical creator、拒絕錯 workspace／deleted、建立兩個零餘額。
   - 保留既有資料、重試、電話主要身份、推薦及成功回應格式。沒有不安全的非交易 fallback。
2. **角色經品牌入口繞過任務寫入限制。** 本機重建已套用 SQL 後，finance_viewer 加上必要的 brand membership，能以 authenticated 直接修改一筆草稿。
   - 品牌 API 新增即時角色檢查，涵蓋建立、編輯、發佈、關閉及刪除，包括使用 service client 的生命週期操作。
   - 候選 SQL 增加三個 restrictive policies，補上直接 Data API 的 INSERT／UPDATE／DELETE 邊界。
   - 品牌專用帳號維持原編輯能力；員工須有相同 workspace 的 active workspace_admin。operator、reviewer、finance_viewer、被撤銷的員工身份不能退回較寬的品牌寫權限。
3. **接任務的隱含獎勵。** 實際 `private.join_mission` 會加 10 XP。這與本輪零 XP 限制不同，因此共用 DB 正向接任務保留 NOT_RUN；本機可驗證，不能改原有獎勵規則來使測試通過。

## 待批准的精確 SQL

執行檔是 [22-proposed-auth-boundary-apply.sql](22-proposed-auth-boundary-apply.sql)，由以下兩份來源組成單一交易：

- [20：品牌／員工寫入邊界](20-proposed-brand-staff-write-boundary.sql)：一個 private helper，三個 restrictive mission policies。
- [21：原子化初始化](21-proposed-atomic-bootstrap.sql)：一個 public RPC，只有 service_role 可執行；PUBLIC、anon、authenticated 均不可執行。

[SQL manifest](sql-review-manifest.json) 記錄精確 bytes、SHA-256 和來源 hash。候選包為 6,869 bytes，SHA-256：

`ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d`

SQL 不直接修改現有資料列、不替換原有 policy、不變動既有函式、索引、migration history、RLS 開關或角色成員。它新增兩個函式與三個 restrictive policies。lock timeout 為 2 秒，statement timeout 為 30 秒；碰撞／差異停止，不自動重播。

既有 API 仍在原正式版本運作。本分支的新版 bootstrap 依賴候選 21；它在尚未套用的資料庫上會回傳可重試的 503，不能稱目前已可進行真實登入驗收。

## 影響與相容性

- 原有品牌 workspace、owner-delete、欄位 grants、已發佈任務獎賞不可修改等條件全部保留。新 restrictive policies 與原條件取交集。
- 限制也適用於曾有 staff_users 身份、現在停用或沒有有效 workspace_admin 的品牌成員；不自行刪除 staff 列，也不自動升權來恢復品牌編輯。
- 本次共用 DB 的唯讀合計顯示：同時有 active brand membership 與 staff 身份的現有帳號為 **0**，因此目前觀測到會因新邊界失去品牌寫權限的既有帳號為 **0**。這是觀測時快照；套用前必須重新檢查。
- 唯讀確認 authenticated 不能直接 UPDATE creator 的 workspace_id、xp、level 或 status。此保護沒有被放寬。
- 原已套用 migration `20261031201901 / kocmax_studio_shared_review_c879b204` 仍存在；新 bootstrap RPC 及三項 policy 尚未存在。
- 原 92 份 migration、release manifest 和已批准套用 artifact 保留。批准後只能建立一個新的前向 migration／歷史記錄，不重播原包。
- 重複索引兩個都保留；此候選沒有索引 DDL。

## 已驗證的證據範圍

- 路由／登入元件／角色回歸：使用 mock transport；正常登入 UI、session cache、bootstrap RPC 契約、品牌寫入及 staff 邊界共 **68/68** 通過（5 檔）。TypeScript、針對性 lint 亦通過。[驗證回執](verification-receipt.json) 記錄最終來源 hash 與範圍。
- 精確 SQL 包在 disposable PGlite 投影中驗證：10 項品牌／角色檢查、6 項原子初始化檢查；注入第二個餘額失敗時，creator 和第一個餘額都不留下。
- 本機 baseline 確實重現 finance 可以更新一筆任務；套用候選後拒絕，品牌專用帳號和 workspace_admin 的正向編輯仍成功。
- 獨立審閱確認 canonical row lock、競爭首次 insert、刪除鎖定及 ACL 設計沒有發現阻斷問題。
- PGlite 使用 Auth claims／Storage 替身，沒有真實 JWT、兩條真實連線競態、Supabase HTTP、Storage 物件或 provider 驗收。不得把以上結果稱為 hosted acceptance。
- 手機／桌面的真實登入、跨 session 儲存重載、九帳號實測及清理均尚未執行。先前 mock 畫面仍是原證據，沒有被重新標成真實驗收。

本機 SQL 的最新結果：[local-policy-baseline.json](local-policy-baseline.json)。之後每次執行亦寫入獨立時間戳紀錄，不覆蓋已有的該次證據。

## 測試資料與清理準備

[fixture-manifest.prepared.json](fixture-manifest.prepared.json) 已準備本輪唯一 run ID、兩個 workspace 的精確新 UUID，以及九個專用合成帳號代號。Auth UUID 尚未由 Auth Admin 建立，所以欄位為 null，createdThisRun 全部 false。沒有密碼、token 或真實個人資料。

- 不因清單已存在就認定資料已建立；必須用成功回執逐一綁定實際 UUID。
- 未先通過兩份新 SQL、專案身份及當前 checkpoint 檢查，不能建立資料或登入。
- 九個普通登入最多產生九組 creator／零積分／零現金餘額。員工／品牌帳號也計入，U-X 先完成 Auth-only 反例才可 bootstrap。
- 舊 `30-fixture-transaction.sql` 仍然 ROLLBACK，不改成 COMMIT。
- 清理只使用本輪實際返回的 ID。先移除精確 Storage objects，再處理可刪內容；版本、workflow、角色審計及必要父列按原規則保留。最後撤權、匿名化／禁止登入及檢查過期憑證。
- 目前建立量為零，所以沒有 Auth／fixture 需要刪除；不能把「零建立」稱為已通過真實清理測試。

## 停止、失敗與回退

1. **尚未套用：** 現有共用 DB 沒有這兩份 SQL 的變更，沒有 DB down migration 要執行。分支程式及候選檔案保留待審。
2. **未提交交易：** 任一 preflight／DDL／postflight 失敗，在同一連線 ROLLBACK；先確認交易及 migration history 狀態再決定後續，不盲目重試。
3. **已提交：** 不自動刪掉 restrictive policies 或回復不安全的初始化；這會重開已確認的漏洞。優先修正前向差異，保留帳本、審計及當時資料。
4. **初始化函式未可用：** 新路由維持 503。不能偷偷回退多個獨立 upsert；若要使用另一版本程式，必須明確記錄版本並且不把它當作修正版驗收。
5. **測試資料：** 僅清理實際本輪所有權清單，遇不可變／外鍵保護則保留及停用，不整庫 restore、不 cascade、不停觸發器。
6. **備份：** 新 SQL 套用前重建當前可用 checkpoint。舊備份是原 migration 前快照，不代表現在完整還原點；沒有共用 DB 整庫 restore 授權。

需要決定的是這份**新增權限及原子初始化 SQL**。它不屬於先前已批准並套用的原 artifact，故保持未執行供使用者審閱；九帳號方案的既有範圍沒有被重問。
