# Supabase 清理確認逾時診斷（2026-11-02）

## 已確認事實

- 使用者明確說明：Codex 內出現可點擊確認卡，並已按「允許」。既有清理 SQL 批准持續有效；不再要求重複批准。
- 本機 Codex desktop log 在 2026-11-01T18:32:18.222Z、19:19:37.505Z、19:54:17.454Z、20:15:35.166Z 記錄 `mcpServer/elicitation/request` 的 `response={"action":"accept","content":{},"_meta":null}`。這只證明 Codex 嘗試向 app-server 送出接受回應；log 沒有證明 Supabase 收到回應，也無法把每筆回應可靠對應到每次 SQL 呼叫。
- Supabase `execute_sql` 四次回報 `expired / INVALID_ARGUMENT`，提示確認有效期兩分鐘。每次逾時後的獨立資料庫讀回均顯示清理未執行；不把接受卡片或工具逾時當作 SQL 成功。
- 2026-11-02T11:42:06.593627Z 再做唯讀讀回：本輪 Auth9，其中封鎖匿名化9、deleted creator9；sessions30、refresh tokens33、附於這些 sessions 的 AMR claims30、私人零獎勵 draft1；active staff／brand membership／scoped role 均0。這次是精確 `auth_pilot.run_id` 範圍的狀態查詢，未重算完整非試點資料指紋。
- SQL 仍為 `cleanup-sessions-and-draft.recovery.sql`，SHA256 `52fb72281b45070a56eba878c8f8e6e5b768b7c9e69538fdf840393826b5fe5e`。這份交易先核對九個 Auth ID、30 個 session ID、子列數、相依與私人草稿，再精確刪除；任何漂移會中止整筆交易。

## 判斷與處理

`content={}` 符合 Supabase 的 action-only confirmation 格式；不能據此判斷使用者點錯。造成逾時的確切環節（卡片顯示、回應傳輸、工具恢復或簽署狀態有效期）尚未定位。停止無差別重送同一 MCP 呼叫；不調整 `skip_elicitations`、放寬 app 權限或用本機資料庫憑證繞過確認。

完成本輪清理的替代途徑：在指定的 Supabase 專案 `mhkoayftiuojxlrkollf`，由使用者於 Dashboard SQL Editor 執行**完整且 hash 相符**的已審閱檔案。執行前核對專案與恢復點；SQL 自身的精確前置檢查會阻止資料漂移時的刪除。執行後由 Codex 獨立唯讀驗證 sessions／refresh tokens／AMR claims／draft 為0、Auth／creator parents 保留及權限仍停用，再核對非試點資料指紋並保存實際回執。若 SQL Editor 顯示任何錯誤，停止並原樣記錄，不能改成寬泛 DELETE。

Supabase MCP 參考：<https://supabase.com/docs/guides/ai-tools/mcp>；Supabase confirmation 實作：<https://github.com/supabase/mcp/blob/main/packages/mcp-server-supabase/src/tools/confirmation.ts>；OpenAI 故障排查：<https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt>。

本診斷沒有部署、沒有 Instagram／Google Drive 真實連接，沒有執行任何資料庫寫入。

## SQL Editor 使用者接手（2026-11-02 12:25 UTC）

- 使用者已在內建瀏覽器登入。實際 UI 核對是 `Remix-Adfocate`／`main PRODUCTION`，專案 URL `https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf/sql/new`；SQL Editor 的新查詢仍為空白，Save 停用，Run 未按。
- 內建瀏覽器禁止 `file:` 本機檔案 URL，並明示不可繞過；曾嘗試的只限 `127.0.0.1` 單檔唯讀傳送頁亦連線逾時，隨即停止本機傳送程序。沒有將 SQL 內容放入編輯器，也沒有執行。
- 因瀏覽器安全政策，改由使用者在本機開啟完整已審閱 SQL 檔，自行複製全部內容到已開的編輯器並按 Run；Codex 只在其後用 Supabase 唯讀連接器核對結果。不要求用戶再提供金鑰，也不改寫精確清理 SQL。
- 2026-11-02T12:25:30.093723Z 唯讀再查：Auth9、sessions30、refresh tokens33、附於剩餘 sessions 的 AMR claims30、draft1；清理仍未執行。此查詢未重算完整非試點指紋。

## 最終結果

其後使用者在指定 Supabase SQL Editor 回報執行無錯。`2026-11-02T14:42:05.610864Z` 獨立唯讀讀回確認精確本輪 sessions、refresh tokens、AMR claims、draft 均為0；Auth／identity parents 保留且測試權限停用。這解決了清理工作，**沒有**證明先前 MCP 確認逾時的根因已修復。詳見 `cleanup-completion-20261102T151423Z.json`。
