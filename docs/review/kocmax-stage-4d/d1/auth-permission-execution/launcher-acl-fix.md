# 本機 Auth 試點啟動工具權限修正

2026-11-01；沿用 `codex/kocmax-studio-stages-1-2`，HEAD 未改。

使用者回報 `open-auth-pilot.ps1` 的 `Set-Acl` 要求 `SeSecurityPrivilege`，在安全輸入視窗前停止。實際使用一般、非管理員 Windows 帳戶重現：將新建安全描述元經 `Set-Acl` 重套至已保護的資料夾時，出現同一權限例外。原程式也會改寫已有內容但權限不符的資料夾，並漏檢不存在路徑的 junction 祖先。

修正：

- 新資料夾以 `FileSystemAclExtensions.Create` 同時建立受保護的權限。
- 符合要求的既有資料夾只核對權限，直接重用。
- 僅可修復目前使用者擁有的空資料夾，只寫入 DACL，不要求 SACL／稽核權限或改變擁有者。
- 已有內容但權限不符、擁有者不符、普通檔案與 reparse 路徑一律拒絕。
- 完成建立／修復後再次核對：目前使用者與 SYSTEM 各一條 FullControl 規則，可向私密子檔案繼承，資料夾本身不繼承其他存取權。

證據：

- `launcher-acl-tests.before.json`：7 個實際檔案系統案例中，4 通過、3 失敗；保留原始結果。
- `launcher-acl-tests.after.json`：最終腳本指紋，7 通過、0 失敗；`elevated:false`、零網絡、無金鑰輸入，合成路徑已清理。
- `node --test scripts/integrations/auth-pilot-worker.test.mjs`：20 通過、0 失敗。
- `open-auth-pilot.ps1 -ValidateOnly`：分支、目標及已批准 SQL 指紋核對通過。
- `launcher-recovery.json`：確認沒有執行中的助手或試點 listener；舊 run 只包含一個 `control.json`，沒有帳戶密碼或 worker journal。將整個資料夾在同一私密父目錄改名保留，移動前後控制檔 SHA-256 相同；未刪除檔案。
- `launcher-input-window.json`：直接啟動最終腳本後，實際視窗標題／window handle 已核實，停在 **v2** 安全輸入視窗。曾以隱藏背景方式啟動但未能核實視窗的程序已停止；保留該次未通過狀態的說明。

本次只修正本機試點啟動工具及新增驗證記錄。沒有重套 SQL、建立 Auth 帳戶、部署或連接 Instagram／Google Drive。九帳戶真實登入、跨帳戶權限及手機／桌面流程仍待本機金鑰輸入後執行。
