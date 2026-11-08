# Stage 4D / D0：離線私隱與試點操作手冊

日期：2026-10-31 HKT。只適用於 `codex/kocmax-studio-stages-1-2` 的離線準備。本文件不是部署、真實 OAuth、遠端資料庫或外部 AI 的授權。

## D0 的執行界線

- 正式 runtime 不組裝 live provider；新增 OAuth 與 Picker server 路徑沒有 coordinator，回傳 `PILOT_APPROVAL_REQUIRED`。環境旗標或符合格式的 target receipt 不能打開它們。
- `createOfflineAdapters` 需要明確注入 fixture HTTP；未知 HTTP transport 預設標記 live，不能被 D0 service 接受。fixture 標記是受信任測試組裝的責任，不是對任意 JavaScript 函式的網路隔離證明。測試沒有使用真實帳號 token。
- `pilot-preflight.ts` 只比較環境、專案、origin、SHA、schema digest、creator/workspace 及 fixture 清單；沒有遠端 target 身份驗證或 live executor。`integrations-live-pilot.test.ts` 是關閉入口測試，不是實測平台通過。
- `pilot-maintenance.ts` 只接受 memory repository、固定 target 和 SHA，僅回傳 dry-run 計數。資料庫的維護／還原命令在本機 PostgreSQL 引擎驗證，沒有安裝排程。

## 權限與個人資料

| 項目 | 準備的限制 | 真實試點之前仍須完成 |
| --- | --- | --- |
| Instagram | `instagram_business_basic`、`instagram_business_manage_insights`；只讀自己的支援媒體；API v26.0；沒有發佈、留言、私訊工具 | 自有 Creator/Business 帳號、Meta app 存取級別、明確帳號 ID 類型、撤銷端點及 callback 協定核對 |
| Google | `drive.file` + `openid`；不要求 email/profile 或全 Drive 權限；逐工作區選檔 | 獨立 Cloud project/Web client、核准 HTTPS origin/callback、測試者名單和驗證所需項目 |
| Picker | 開啟時才取得 access token；server 核對 actor/generation；回應不快取；browser 不存 localStorage/query cache；關閉清空引用 | 官方 SDK 載入、CSP/script 規則、referrer 限制 API key、真實帳號／檔案驗證 |
| 文件 | Docs→text、UTF-8 text、文字 PDF；5 檔／5MiB／8,000 Unicode 字元；下載前後重查 metadata | 核准測試內容與處理／轉分享權證據；PDF worker 在目標 host 的封裝與資源驗證 |
| AI | provider 衍生內容使用本機確定性提綱；沒有批准外部模型處理 | D3 獨立批准處理者、地區、保留條款、指定內容及逐來源同意 |

`drive.file` 在 Google 層包含寫入能力；產品只提供內容讀取。Picker access token 有原本的 scope 和實際有效期，清空前端引用並不撤銷它，也不能把它稱為 60 秒唯讀 token。client secret、refresh token 及加密 key 不提供給 browser。

可讀、可下載、`ownedByMe=true` 及授權成功均不構成素材再利用權。Drive adapter 保留 `rights=unknown`；未有獨立可信權利依據時，不開啟模型及品牌分享。私人手動內容／合法已確認來源仍走原有用途檢查。不得為了完成示範把未知權利改為 owned。

香港／繁中覆蓋未證實時保持「未驗證」；缺值不補零。Instagram「近 30 日」是媒體挑選區間，lifetime 是該媒體指標期間，不加總 reach 當去重受眾。示例來源不因通過真實形狀的 adapter 而變成真實帳號或已核實任務。

## 授權、刷新與撤銷

1. 顯示實際 scope 和用途；取消不影響基本任務。Google 採 PKCE + nonce + 驗簽 ID token；Instagram 不捏造未確認的 PKCE 支援。state 綁 actor/workspace/provider/session/generation/return path，單次且最長 10 分鐘。
2. callback 僅保存加密 code；回傳短期一次性 ticket。完成綁定需同一 KOCmax 身份；跨 browser 明確確認身份。code/state/token 不寫到應用日誌、分析或錯誤追蹤；未來 host 的 access log 亦須完成實際遮蔽測試。
3. host 提供持久 keyring；舊 key ID 用於解密，新 key 用於重包。D0 僅用注入的合成 key；沒有建立真實秘密。兩個服務實例使用 SQL lease/CAS；外部刷新結果不明或寫回失敗時要求重新授權，不重播交換。
4. 本地先停止讀取，再嘗試 provider revoke。`pending`／`manual_action` 不能顯示為遠端成功。Google 同 subject/project 的撤銷協調不分享 token、檔案或其他工作區名稱；舊資料清除不可再次撤銷後來的新授權。
5. Meta `signed_request` 驗 HMAC-SHA256、時間及 receipt；只有明確核實的 app-scoped ID → 該 Instagram Login 產品帳號映射才可呼叫私有 dispatch。通用 Meta 文件不證明 ID 可直接相等。相同 receipt 只執行一次；舊 receipt 重播不能影響之後重新授權。
6. 刪除通知若涉及多帳號混合的舊歷史，回傳 `pending`，保留阻止讀取與處置證據；不能冒稱全部資料已清除。真正公開 deletion-status 頁、callback app 設定及端到端回執在 D1/D2 驗證後才可啟用。

## 保留、清除及還原

- 沿用未引用快照 30 日、撤銷未引用快照 24 小時、最小事件 90 日。私人成果依來源清除及帳號刪除處理；分享前重新檢查來源版本、用途及目的任務。
- 清除工作有 bounded batch、lease 和可重入操作，日誌只記去識別狀態／計數。人工處理的待撤銷帳號仍須保持停止。D0 加速時間測試不代表已等待 30／90 日。
- 帳號刪除先停整合，再沿用原匿名化。匯出不含原始憑證、OAuth secrets 或其他工作區的 grant 映射。
- tombstone 刻意不依賴已刪除主記錄。任何未來備份還原須將**整個目標**隔離，先匯入最新 tombstone，再 replay/reconcile，經普通使用者 JWT/RLS 正反例驗證後才允許服務。`restore_pending` 的 integration 命令檢查不會自行封鎖所有直接 SELECT 或 Studio reader；不能只靠該欄位宣布還原安全。
- 不承諾從所有備份立即抹除，也不能追回已獲准交付給任務接收者的副本。試點資料結束後的 7 日清理和最小證據 90 日期限須在 D1/D2 處置批准中指定。

## 後續批准與驗收

D1 需要確定隔離專案、callback/origin、持久 secrets、allowlist、監控、備份期限、取消及回退責任人；核對 Instagram 撤銷與帳號映射、PDF worker host 封裝，才可提出具體啟用差異供審閱。D2 使用兩位參與者、至少三個 app 身份／兩個工作區及原任務角色；Google Testing 期限、真實刷新、兩條 DB 連線、實機 Safari/Chrome 回流與 provider revoke 都必須實測。D3 模型另批。

主要依據：[Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Drive 下載與匯出](https://developers.google.com/workspace/drive/api/guides/manage-downloads)、[Instagram Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)、[Meta 通用刪除 callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback)。通用 callback 文件使用 app-scoped 用戶 ID，未核實的 Instagram 映射仍列為 gate。
