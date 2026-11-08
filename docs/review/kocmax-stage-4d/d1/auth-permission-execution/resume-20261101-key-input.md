# 九帳戶試點續接：本機 server key 輸入尚未完成

2026-11-01，沿用原分支與 HEAD，沒有部署或建立 Instagram／Drive 連接。

使用者回覆「已啟動」後，實際讀回 exec session `81186`：launcher 在安全輸入後以 `SERVER_KEY_REQUIRED` 停止，位置在建立 private run／啟動 worker 之前。沒有讀取或記錄使用者輸入的文字，也不能推斷輸入內容。沒有 `startup-status.json`、runtime receipt、新 worker journal 或本輪帳戶密碼。

## 已完成的獨立核對

實際 Supabase READ ONLY transaction 時間為 `2026-11-01T15:02:29.773095Z`：

- 目標為已批准的 Remix-Adfocate `mhkoayftiuojxlrkollf`。
- 原應用資料仍為 94 表／110 rows，opaque digest `ec4e20dce8d53c695122c2f3c1551abb`，與套用 SQL 後基線相同。
- migration 共 16 筆，已批准 migration 的 1 statement／6,869 bytes／SHA-256 精確相符；89 policies。
- 啟用中的非 internal Auth user triggers 為 0。
- 本輪九個預留 email 及兩個 workspace 的碰撞均為 0。
- 原 gate 已保存歷史副本，再以實際查詢結果原子更新；不以重設時間戳代替核對。

詳見 `readonly-observation-20261101T150229Z.json` 與 `launcher-key-input-failure.json`。沒有應用資料／Auth 寫入。

## 輸入流程修正

v3 在同一視窗檢查完整 server key 形狀。短輸入、公開 key、錯誤專案／role 的 legacy token 及格式錯誤會顯示提示並保留可編輯狀態，不再立即關閉整個工具。視窗指示使用指定專案現有 `service_role` 或 `sb_secret_` server key；不要建立／輪替金鑰或貼到對話。

格式檢查不是對真實金鑰有效性的認證；worker 與 Supabase 的後續核對仍然保留。金鑰仍只經本機記憶體及匿名 stdin pipe 傳遞。

- `launcher-key-tests.before.json`：原 7 個權限案例通過，7 個新增輸入檢查案例尚未實作而失敗。
- `launcher-key-tests.after.json`：14 通過、0 失敗，一般 Windows 使用者、合成輸入、零網絡；測試資料夾已清理。
- 實際 `-CheckInputForm` 點擊測試通過：無效合成輸入保留於同一表單，符合形狀的合成輸入可前進；在捕捉金鑰、建立 private run、啟動 worker 或網絡前返回。
- 最新實際 v3 視窗記錄於 `launcher-input-window.json`，exec session `40583`；舊 v2 視窗回執保存在 `launcher-input-window.v2.json`。

## 重複索引檢查

實際唯讀 catalog 核對：

| 索引 | 定義 | 狀態 | 約束／相依 |
| --- | --- | --- | --- |
| `creators_id_workspace_unique` | UNIQUE btree `(id, workspace_id)` | valid | 自身 unique constraint；8 個 FK 使用它 |
| `integration_creator_workspace_key` | UNIQUE btree `(id, workspace_id)` | valid | 自身 unique constraint；未找到引用此索引的相依 |

兩者的 key、opclass、collation、排序、predicate、expression、唯一性及 NULL 唯一性語意相同。兩個索引均保留，沒有執行 DROP。若後續需要移除第二個 unique constraint／其索引，應另行審閱遷移與 FK／依賴；不納入本輪登入試點的修改。

## 尚未驗收

九帳戶建立、真實登入、API／RLS、手機／桌面實際旅程及測試後資料清理仍為 NOT_RUN。本輪沒有建立要清理的遠端 fixtures；合成的本機測試目錄已清理。下一步是使用者在目前 v3 本機視窗完成現有 server key 輸入；原 SQL／九帳戶測試批准仍有效，不重問批准。
