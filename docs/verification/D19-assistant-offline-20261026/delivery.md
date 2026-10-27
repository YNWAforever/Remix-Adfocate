# D16／D19 assistant 離線邊界補驗 — 2026-10-26

本輪 standalone **8/8、exit0**，指定 lint 及獨立 TypeScript 檢查亦通過。沿用實際 Launcher／Panel／useAssistantChat／apiFetch／Hono route／RAG／tool dispatch；只將 Auth/session、DB transport 及 provider 換成明確 scripted mocks。App/runtime788 source、73 SQL 及待批 C2 manifest／批准檔案均不變。

| 情境 | 實際離線觀察 |
| --- | --- |
| 開啟／Shift-Tab focus trap／Escape 關閉／重開 | 焦點進入輸入框並回到 launcher；沒有 HTTP 或 provider request |
| 第二個問題 | saved conversation ID 經實際 helper/route 傳遞；history descending timestamp/turn-order limit20，還原成 chronological user/assistant 次序送到 mock provider |
| 429 後明確重試 | 保留輸入及同一 request UUID；429→200，只生成1次 |
| history503 | 已載入內容及新輸入保留；同 request 重試202，不自動重新生成。這不證明真實 DB lease／恢復時間 |
| provider unknown outcome | POST503→GET200 查同一 request；只呼叫 mock provider1次，沒有自動 POST |
| 保存回應遺失 | 首先顯示未確認保存並保留輸入；GET 查回 scripted saved 結果，移除未確認版本、只顯示1個答案；沒有第二次生成 |
| 不支援的 reward／role tool | 真正 dispatcher 回 unknown tool；只派送 request/claim/KB/save RPC，沒有財務或 access command。這不是 model quality 評估 |
| 未注入 provider 的 mission-assist | 503 assist_disabled、not_started；DB factory/provider call0 |

真實 provider spies 及外部 fetch guards 都記錄0次觸發；沒有 actual SDK client、SQL、Auth subjects、target 或資料修改。Provider 模式由測試 dependency injection 指定，dotenv及繼承 credentials/preloads 均停用。執行前先核對 in-process descriptor，沒有以 localhost 或測試名稱冒作隔離身份。

首輪八個 case assertions 通過，但 afterAll 的 import.meta.url 被 Vitest 轉換，writer 嘗試不存在的 C:/docs 路徑而失敗，整個 suite 仍是 exit1。只修正 reporter 路徑及公開 trace，保留首輪 source revision／log／JSON，重跑相同八項後取得 exit0；沒有將這次輸出錯誤當作產品 RED 或忽略 suite failure。

Native full **2129/0/363（292 files）** 與上一輪 legacy memory **7/0/0** 保留原 binding，今輪未重跑；不能把獨立8項加成新的 full-suite count。Commands、Node22／Vitest版本、fresh physical/commit RAM readings、terminal receipts、readbacks及 source hashes 在 gates.json／readback-summary.json。

可重現（worktree root；使用新的 label 保留 receipt）：

```powershell
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py test boundary-review-next
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py lint boundary-lint-next
python docs/verification/D19-assistant-offline-20261026/run-offline-verification.py type boundary-type-next
python docs/verification/D19-assistant-offline-20261026/verify-assistant.py
```

重跑會新增 receipts 並改變 evidence inventory；本驗證器固定於本 checkpoint，需更新新一輪交付及封存後才可檢查新 inventory。此 fixture 的 QueryClient 明確設定 retry:false；沒有驗證實際 app root 的 retry 設定。

本輪只補 UC-C19／UC-Q04／UC-Q05 新層，107個原欄及 D15／上一輪 UC-A11、UC-R04 整行不變。Scripted store 不能代替真實 DB 原子性、RLS、跨 instance quota、browser／device、跨關閉／導覽／refresh 的草稿或對話還原，以及真實模型的來源／幻覺／成本評估；不是完整案例或 R1 verified。沒有測 pending reward 財務 neutrality。

C2 仍待原 exact manifest 批准，原696e批准不重問或重播。D15、具名 advisor owner／裝置／hosted、正式 staff、audit ZIP 及其他 R1 gaps 保留。事故 OPEN／未還原，舊 shaped 鑑證用途不變；release HOLD，真實 provider disabled，未 commit／push／merge／deploy。Rollback 只涉及 exact-before 本機文件，沒有物理資料／schema rollback。
