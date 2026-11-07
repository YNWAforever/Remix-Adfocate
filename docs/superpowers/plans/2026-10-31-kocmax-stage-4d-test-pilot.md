# KOCmax Stage 4D：Instagram 與 Google Drive 測試試點計畫

日期：2026-10-31（香港時間）。狀態：**計畫待批准；未實作、未部署、未建立真實連接。**

**Goal：** 在隔離測試環境，用少量自有帳號驗證「選任務 → 讀取自己的證據 → 私人 Brief → 逐項確認轉存 → 原任務審批 → 測試積分／徽章」，同時證明撤銷、權限隔離、手機與桌面及既有功能沒有退步。

**Architecture：** 延用 Stage 4A–4C 的 owner/workspace、來源版本、generation、短期使用許可、原任務及帳本邊界；新增可替換的真實 provider adapters。真實資料、模擬資料、地區覆蓋及任務核實是不同狀態。外部 AI 用途獨立批准。

**Tech Stack：** 現有 React / TanStack Query / Hono / TypeScript / Supabase PostgreSQL；Google Drive v3 與 web Picker；Instagram Login API。新增 SDK、解析器及 Meta API 版本在離線實作階段核對並鎖定，這次不安裝套件。

**Spec：** [Stage 4 規格](../specs/2026-10-31-kocmax-stage-4-integrations.md)、[4A–4C 計畫與完成紀錄](2026-10-31-kocmax-stage-4-integrations.md)、[本機驗證](../../review/kocmax-stage-4/verification.md)、[私隱 runbook](../../review/kocmax-stage-4/privacy-runbook.md)。本文件新增 4D 範圍，不改寫舊驗收結果。

## 1. 基準與批准邊界

- 已核對分支 `codex/kocmax-studio-stages-1-2`，HEAD `3fcdda1`（private mock Instagram and Drive journeys）；寫本文件前 working tree 乾淨。
- 這次只交付計畫。現有批准涵蓋 4A–4C mock，**不等同 4D 真實試點批准**。本文件中的工作、帳號及環境都是提案。
- 後續離線實作留在同一分支。動工前重新核對 HEAD、未提交改動及上游差異；有新修正先列出影響，不自動覆蓋或合併。
- 不改 production、push、merge、部署（包括 preview）、建立遠端環境／OAuth app／金鑰、套用遠端 migration、授權真實帳號，直到使用者批准相應範圍。
- 不替換原登入、角色權限、任務、內容審批、發佈證明、完成核實、凍結 reward contract、獎勵交接及帳本。基本任務與手動來源不依賴連接。
- 連接、同步、聊天及重複匯入不發積分／XP；試點只使用隔離的測試帳本，沒有真實兌換、付款或品牌交付。
- 網頁、檔案與 provider 回應均屬不可信資料，不能決定工具、接收者、權限或同意。

### 建議的分段批准

| 範圍 | 批准後可做 | 仍不包含 |
| --- | --- | --- |
| D0 離線準備 | 同分支補 adapters、migration、UI、契約與本機測試，交付可審閱差異 | 遠端部署、OAuth 註冊或真實資料 |
| D1 指定試點環境 | 在核准的專案建立／配置測試環境、OAuth apps、秘密儲存、排程及測試 schema | 自動授權任何個人帳號、production |
| D2 指定帳號只讀試點 | 測試者確認指定 scopes；讀取獲選資料、私人整理、測試任務轉存與審批 | 外部 AI、發文、私訊、Drive 寫入、真實獎賞 |
| D3 可選 AI 試點 | 只向核准的模型／專案傳送已同意的指定測試資料 | 任意其他來源、模型訓練、全站知識庫或公開分享 |

可以一次批准多段，但部署目標、帳號名單、scopes、資料用途及費用上限須明確。未填妥的項目不靠推測執行；不要求現在提供密碼、token 或檔案內容。

## 2. 已完成與仍欠缺的差距

| 已有 4A–4C 基礎 | 4D 必須補齊 |
| --- | --- |
| 可注入的 mock providers、加密 envelope、一次性 state、generation 防止舊結果回寫 | 真實 authorization-code callbacks、provider token lifecycle、持久金鑰、多程序刷新鎖與遠端撤銷 |
| mock IG 指標與缺值處理；30 日／50 媒體／60 分鐘冷卻 | 真實 HTTP adapter、固定 API 版本、媒體類型與指標／period 矩陣、分頁與配額 |
| 模擬選檔及已提取文字；5 檔／5 MiB／8,000 Unicode 字元 | 真實 Google Picker、逐檔下載／匯出、實際 PDF 解析、ACL／版本重查 |
| 私人來源、用途同意、短期許可、原任務轉存、撤銷後遮蔽 | 真實 provider 的權限變更、跨 worker 競態及實際 Auth/JWT/PostgREST/RLS |
| 私人匯出、purge、保留期限指令 | 真正的排程、重試／告警、備份還原時的刪除紀錄重播 |
| 手機／桌面 mock UI 及回歸 | 真實 OS 瀏覽器 OAuth、取消／返回／多帳號／Picker，以及外部登入後的草稿恢復 |

目前 `runtime.ts` 只容許非 production 的 mock，金鑰在程序內隨機建立；`service.ts` 的刷新鎖亦是程序內 Map。前後端及 SQL 多處固定 `sampleOnly: true` / `sample_only: true`。**4D 需要明確增加 live-pilot 契約，不能只切換開關或把 true 改成 false。**

Stage 4 驗證紀錄是本機證據：完整回歸最後一項失敗經修正後針對重跑通過，另有原有略過測試；不稱為真實平台或遠端 RLS 已通過。本次沒有重跑程式測試，也沒有檢查私人平台控制台。知識圖譜清單在 15 秒內未回應，故用已有文件定位並讀取上述指定檔案；沒有對其他專案建立索引。

## 3. 官方要求對計畫的影響

以下於 2026-10-31 核對公開官方文件；Meta 文件透過內建瀏覽器閱讀。文件成立不等同指定 app 已取得權限。

1. **Instagram：** 採 Instagram Login，支援 Business／Creator 專業帳號。所需 scopes 為 `instagram_business_basic`、`instagram_business_manage_insights`；自有／管理且已加入 app 的帳號使用 Standard Access，外部客戶需符合 Advanced Access／App Review 要求。本試點先限前者；普通個人帳號保留手動任務路線。[官方 Insights](https://developers.facebook.com/documentation/instagram-platform/insights)、[Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/)
2. **IG 資料邊界：** 少量粉絲的帳號可能缺部分指標；空資料不等於零。Instagram Login 的普通互動指標不可冒稱包含 Facebook Login 專屬的廣告彙總資料。最新 changelog 的登入錯誤細分與 `media_url` 可缺失須納入 adapter；新 messaging／publishing／Unified Login 能力不擴入此試點。[Insights](https://developers.facebook.com/documentation/instagram-platform/insights)、[Changelog（頁面更新至 2026-10-28）](https://developers.facebook.com/documentation/instagram-platform/changelog)
3. **版本仍是入場門檻：** 現有 manifest 的 `liveApiVersion` 為 null。離線準備須核對官方 reference、選定 app 可用版本，逐項列出 endpoint、metric、媒體類型、期間與限制。未完成矩陣不可打開 IG live；不照抄官方頁面中不同登入模式的舊範例。
4. **Google：** 建議逐檔 `drive.file`，避免整個 Drive 的 restricted `drive.readonly`。`drive.file` 在 OAuth 層包含修改能力；我們僅開放讀取方法、關閉上傳／修改／刪除／分享工具，但不能把 token 說成平台層只讀。另提議 `openid` 僅用於核對穩定帳號 `sub`，不要求 email／profile／Gmail；這是須列入批准的身份用途。[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
5. **Picker：** KOCmax 是響應式 web app，手機與桌面都採 web Picker。它需要瀏覽器 access token；這是一般「token 不到前端」規則的受控例外。原生 desktop/mobile One Pick 是另一流程，不能把它的參數、scope 限制混用於 web 實作。[Picker 比較](https://developers.google.com/workspace/drive/picker/guides/overview)
6. **測試與撤銷：** Google External + Testing 採指定測試者名單（上限 100），本試點只用兩位；此 Drive 用途的測試授權／refresh token 存在 7 日到期限制，故安排跨第 7 日觀察。Google revoke 可撤回該使用者對同一專案各 client 的授權；跨工作區不能保證其他連接不受影響，須共同失效並重新取得同意。[測試者規則](https://support.google.com/cloud/answer/15549945?hl=en)、[Token 到期](https://developers.google.com/identity/protocols/oauth2)、[撤銷](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
7. **瀏覽器：** Google OAuth 不允許部分 embedded user-agent。內建瀏覽器繼續用作產品預覽及 UI 驗證；真實授權由測試者在支援的系統瀏覽器完成，不繞過限制或安全提示。[OAuth 錯誤與瀏覽器要求](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors)

## 4. 權限及資料用途

| 能力／資料 | 最小範圍與預設 | 明確禁止／另批 |
| --- | --- | --- |
| IG 成效雷達 | 兩個上述 scopes；自己的帳號及近 30 日最多 50 個媒體，依實際支援回傳指標 | 不讀私訊、留言內容、其他創作者、廣告帳戶；不發佈或管理互動 |
| Drive 靈感背包 | `drive.file` + `openid`；使用者在 Picker 選檔後，server 再確認本工作區的選取記錄 | 不掃描整個 Drive；不採 `drive`／`drive.readonly`／網域委派；不寫檔 |
| 保存私人來源／Brief | owner + workspace；可讀權、處理權、AI 同意及轉分享權分開 | 「可下載」及「擁有文件」都不自動代表擁有其中所有素材的再利用權 |
| 送往 AI | 預設關；批准處理者、地區、保留條款與指定內容後，才逐來源同意 | 不送整個帳號、其他討論串、秘密或未選來源；不承諾未核實的零保留／香港處理 |
| 轉存測試任務 | 預覽每段內容、來源、目的任務及可見角色；只複製獲准段落和必要出處 | 品牌／審稿／營運／財務不因此取得私人帳號、未選檔名、其他討論或 token |
| 帳號管理 | 顯示實授 scope、帳號、最後成功同步、失效與撤銷狀態；讀取開關關閉仍可撤銷／清除 | 不把本機刪除冒稱遠端撤銷成功；重新連接不復活舊同意 |

保存／分享時重新核對來源權限、版本和內容 hash；SQL 再核對 owner、generation、目的地及一次性許可。跨平台 ACL 與本地 commit 無法形成同一事務，故採使用前即時重查、60 秒許可及失敗即停止，公開說明殘餘時間差；不得聲稱能追回已送給模型或任務接收者的內容。

「只讀」指平台內容操作；已批准的 OAuth 換證、刷新及撤銷仍屬必要帳號管理。它們走獨立、有限的協定端點，不提供通用 HTTP／寫入工具給模型。

## 5. 剩餘實作工作包（批准 D0 後）

每包先補會失敗的邊界測試，再實作最小改動、跑該包與相依回歸、審查差異，最後作可獨立回退的本機 commit。新增路徑為建議落點；若已有等效實作，沿用而不重複。跨包依序為 W1 → W2 → W3/W4 → W5 → W6/W7 → W8。

### W1 — live-pilot 模式與資料契約

- 修改 `src/lib/integrations/types.ts`、`server/lib/integrations/{types,policy,runtime,service,repo}.ts`、`provider-manifest.json`；新增後續時間戳的 additive migrations，不重寫三份 4A–4C migration。
- 新增 server-only `live_pilot` 模式，綁核准的環境／資料庫專案／origin／creator allowlist；預設關閉。production 仍拒絕 mock，未明確列入的 production target 亦拒絕 live-pilot；不可只依 `NODE_ENV`（測試部署也可能是 production build）。
- 契約區分 mock/live 來源、取得方式、查核狀態、coverage、API 版本與來源世代；live 不會自動變成已核實任務。舊 mock 記錄仍保持 sample。
- 測試：擴充 `policy.test.ts`、`runtime.test.ts`、`server/test/integrations-schema.test.ts`；錯環境／錯 actor／錯 provider 拒絕，舊樣本不能偽裝 live；更新 release manifest 並保留既有 validators。

### W2 — 真實 OAuth、金鑰、刷新與撤銷

- 新增 `server/lib/integrations/{oauth,keyProvider,refreshLease,providerHttp}.ts` 及 `server/routes/integrationOAuth.ts`；修改 `credentials.ts`、`service.ts`、`runtime.ts`、`server/app.ts`。mock 的 allow/partial/deny callback 保持只供 mock。
- server 完成 code exchange；state 隨機、單次、10 分鐘、綁 session/creator/workspace/provider/generation/return path。採 provider 支援的 PKCE，並記錄不支援者的替代防護；Google ID token 驗簽、issuer/audience/expiry/nonce/subject。
- HTTPS callback 固定白名單、無第三方腳本、`no-store`、不記錄 URL 中的 code/state/token；外部瀏覽器返回須重新核對登入 actor。跨瀏覽器若沒有原 session，要求同一 KOCmax 身份登入後兌換一次性完成憑據，不能只憑回傳 URL 綁帳號。
- 將 AES-GCM envelope 接持久秘密儲存及 key ID 輪替；refresh lease／compare-and-swap 存 DB，涵蓋兩個 worker、失效及重啟。外部 token 已換新但 DB 保存失敗時進入待重新授權，不盲目重放 code exchange。
- 新增私有 provider-grant 識別／撤銷協調：Google 同 subject + project 的連接受影響時共同失效，但不向其他 workspace 暴露其名稱或內容。provider 已處理的舊撤銷不能被本地 generation「取消」；重連須等撤銷解決，或失效後重新確認。
- grant 協調只用於失效範圍；各 actor 的憑證、選檔及用途同意仍分開保存，不能因此共用 token、自動連接其他工作區或擴大可見範圍。
- provider deauthorization／deletion callback 依實際協定驗簽、防重播；一般成效不開 messaging webhook。未有可靠通知的情況，在每次使用前重查，配合批准的有限排程。
- 新測試 `oauth.test.ts`、`refreshLease.test.ts`、`providerHttp.test.ts`；擴充 `credentials.test.ts`、`server/test/integrations-privacy.test.ts`：取消、部分授權、重播、帳號掉換、跨 worker 刷新、遠端撤銷延遲及重連競態。

### W3 — Instagram live adapter

- 新增 `server/lib/integrations/providers/instagramLive.ts` 與測試；沿用 `instagram.ts` normalizer，與 legacy `server/lib/social/` 分開。
- 完成合法帳號識別、授權範圍讀回、provider-specific token exchange/refresh/revoke、自己的媒體分頁及 Insights。每個 lifecycle endpoint、token 到期規則及 API 版本記入 manifest，不把 Google 的 refresh 模式套到 IG。
- 核對候選 `reach`、`views`、`likes`、儲存次數的實際 API metric 名稱（例如 UI 的 saves 與 provider 的 saved）、media type、period、登入方式；不支援的組合不請求。首輪只覆蓋自己的 image／carousel／reel；不納入 Stories／Live／廣告彙總／人口統計。
- 30 日表示挑選期間；若 API 回傳 lifetime 指標，明確標 lifetime，不能稱為近 30 日新增表現或把 reach 相加當去重受眾。缺少 `media_url` 不阻斷證據，使用 permalink，不下載影片。
- 429 尊重 Retry-After，bounded backoff、取消、熔斷、分頁上限及 60 分鐘冷卻；顯示部分結果與最後成功同步。server 僅允許指定 provider hosts，分頁 URL 不可把 token 帶去任意域名。
- 測試缺值／真零／未授權／資料延遲／過期 token／不支援 metric／缺 media URL／UTC-HKT 日期邊界及 HTTP 故障；不得製造流量逼出真實限流。

### W4 — Google OAuth、Picker 與文件讀取 adapter

- 新增 `providers/googleDriveLive.ts`、`driveContent.ts` 及測試；修改 `server/routes/integrations.ts`、`src/components/integrations/DriveSourcePicker.tsx`、`src/lib/integrations/queries.ts`。
- 採官方 web Picker，設定核准 app/project/origin、MIME 篩選及多選上限；不啟用 upload view。Picker 回傳只作候選 file IDs，server 用該 actor 的 token 驗證，不信任前端的 owner、權利、版本或標題。
- 提供專用受 session/CSRF/origin 保護的 Picker token 通道；僅在使用者打開選檔時提供 access token，記憶體暫存，關閉清除引用；不進 localStorage、URL、query cache、分析事件、錯誤追蹤或 LLM。client secret、refresh token 永不出 server。
- token 仍有 `drive.file` 能力及 Google 真實到期時間，清除前端引用不是撤銷。以 CSP、第三方 script 限制、API key referrer 限制與短期 app session 降低風險；不宣稱能把 Google token 改成 60 秒唯讀 token。
- 認可的初版檔型為 Google Docs → plain text、UTF-8 text、含文字的 PDF；檢查 `canDownload`、trashed、版本及可讀性，再限流讀取。Google Docs 沒有普通 byte size 時也以串流實際 bytes 限制 5 MiB；每次最多 5 檔，摘要輸入最多 8,000 Unicode 字元並標示截斷。[下載／匯出規則](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- PDF parser 固定版本、資源上限、停用外部資源／腳本；加密、掃描、損壞 PDF 顯示不支援，保留手動貼文字。folders、shortcuts、Shared Drives、Sheets／Slides／Office、OCR 暫不支援，不靜默擴大權限。
- 檔案選取權綁本工作區。`drive.file` 可能包含以前已對該 app 授權的檔案，仍不可因 provider 讀得到便自動匯入另一討論或 workspace。
- 測試 Google 多帳號／Picker 與 server subject 不符／未選檔／第 6 檔／超限／共享權移除／版本變更／重新選取；下載及匯出前後 metadata 核對，不一致則丟棄內容重新取得。

### W5 — 私人證據、Brief 與原任務橋接

- 修改 `server/lib/integrations/evidence.ts`、`server/lib/studio/assistantContext.ts`、`server/routes/{studio,assistant}.ts`、`src/lib/studio/{types,policy}.ts` 及來源顯示元件。
- 在來源卡列出實際問題、平台、API 版本、觀測／抓取時間、期間、file/media ID 的安全引用、版本/hash、缺值與地域限制。香港／繁中覆蓋沒有證據就顯示「未驗證」。
- D2 先以可追溯的手動／確定性 Brief 驗證保存與轉存，清楚標註，不能稱為真實 AI 產生。D3 批准後才使用原 assistant 的正式模型路徑；未同意時 server 阻止整段 provider 衍生內容進入模型，包括歷史訊息及已保存 Brief。
- 保留每次用途重查、60 秒 permit、version/hash/destination 綁定與 SQL 落地檢查。撤銷前的 assistant 內容沿用現有保守遮蔽，保留 creator 輸入與撤銷後安全回覆；不趁此移除 `clock_timestamp()` 或 creator lock 修正。
- 擴充 `server/test/studio-integrations.test.ts`、`studio-integration-race.test.ts`、`server/lib/integrations/evidence.test.ts`；mock/live 混合、來源內提示注入、未同意 AI、改變目的任務、分享競態均必測。

### W6 — 實際私隱營運與還原

- 修改 `lifecycle.ts`、`repo.ts`、`server/routes/account.ts`，新增 `scripts/integrations/pilot-maintenance.ts` 及測試。只對批准的 target 執行；先提供 dry-run 計數和 target 驗證。
- 排程採具 lease 的單一工作、可重入批次、最少秘密權限；監控失敗、待撤銷及超期，不向日誌寫原文／檔名／token。provider revoke 先本地停用，再記錄 confirmed／pending／manual_action；最多 24 小時重試，超時保持停止並交代手動撤銷。
- 維持未引用快照 30 日、撤銷未引用快照 24 小時、最小事件 90 日；私人保存成果依 purge／帳號刪除處理。試點結束建議 7 日內清理全部試點來源與衍生內容，精簡證據亦於 90 日內刪除，納入 D1/D2 的處置批准。
- 刪除帳號先停整合，再走原匿名化；測試分頁匯出超過一頁、憑證不外洩、重試不重複。備份有實際期限與刪除 tombstone，還原後先重播刪除／撤銷再允許讀取；不得承諾立刻從所有備份抹除。
- 實際排程成功與加速時鐘測試分開記錄；跑一天不代表已等待 30／90 日。新增 maintenance/restore 測試，擴充 `integrations-privacy.test.ts`、`lifecycle.test.ts`。

### W7 — 手機與桌面體驗

- 更新 `src/components/integrations/{Connections,ConnectionCard,ConnectionConsent,DriveSourcePicker,IntegrationSourcePanel}.tsx`、`integrations.css`、`src/components/studio/StudioWorkspace.tsx`。
- 沿用「成效雷達／靈感背包」技能卡；即時指出「示例／試點真實資料／未連接／未驗證／需重新授權」。先顯示用途及 scope，再交平台確認；預設私人，AI 與轉存核取不預選。
- 返回原討論／選檔位置並保留草稿；新帳號或 workspace 切換時立即清空前一 actor 的私人顯示。撤銷頁說明 Google 可能影響同一帳號的其他工作區連接，不暴露其名稱。
- 320/390/430/768/1024/1440px 檢查無橫向溢位、內容不被鍵盤遮住、focus 回復、鍵盤／讀屏可操作及 reduced-motion。OAuth 另用實際 iOS Safari、Android Chrome、桌面 Chrome／Edge／Safari 驗證，記錄實際版本；viewport 模擬不代替真機。
- 擴充 `Connections.test.tsx`、`IntegrationSourcePanel.test.tsx`、`layout.test.tsx`、`queries.test.tsx`；保留 permission epoch、403 後 503 不復活 cache、草稿／返回路徑測試。

### W8 — 試點測試工具、回歸與交付

- 新增明確 opt-in 的 `server/test/integrations-live-pilot.test.ts` 與 `scripts/integrations/pilot-preflight.ts`；預設一般 unit test 不連遠端。target/project/origin/allowlist/fixture 清單與 source SHA 不一致立即停止。
- 使用普通測試者 JWT 做正反例；只以受控 service 身份設定 fixture，不能用 service-role 模擬所有用戶而宣稱 RLS 通過。真實 SQL 至少兩條連線驗證 lease、撤銷與保存競態。
- Stage 3 功能保留清單逐項核對：訪客首頁／加入／登入、創作者任務與創作／課程／錢包商店／個人設定／報告、品牌任務管理、營運審批／發佈證明／完成核實／獎勵交接、財務及支援。列出實際點過的路徑與變更流程；只讀頁面通過不算修改流程通過。
- 新增 `docs/review/kocmax-stage-4d/{verification,provider-capabilities,privacy-runbook}.md`、`acceptance.csv`、去識別截圖／trace 清單；保留 4A–4C 原結果，不用新 green 覆蓋舊限制。

## 6. 測試環境與帳號

建議只用 **兩位內部參與者、兩個工作區、至少三個 KOCmax 創作者身份**。平台帳號由合法擁有人管理及親自授權；不借用客戶帳號，不分享登入資料，不買粉／造互動。

| 測試身份 | 配置 | 驗證目的 |
| --- | --- | --- |
| 參與者 A／C1／W1 | 自有 IG Creator + Google A | 完整私人來源 → Brief → 任務流程 |
| 參與者 B／C2／W1 | 自有 IG Business + Google B；可選低粉絲帳號 | 同工作區不同 creator 隔離、部分／缺失數據 |
| 參與者 A 的隔離 app 測試身份 C3／W2 | 相同 Google A，分開授權；獨立 app session | 同 provider 帳號跨工作區選檔、cache、撤銷影響；不得共用 app actor |
| W1 品牌／審稿／營運／財務角色 | 獨立角色 fixture，權限沿用現有規則 | 只見獲准任務投影，不能讀私人來源；原完成核實與測試帳本 |
| 未列入名單／訪客／W2 staff | 獨立匿名或未授權 session | 403/404、IDOR、直接 RPC／API、越權用途 |
| 不支援 IG 個人帳號 | 自有帳號若有；否則只做契約案例並列未實測 | 不要求強制轉專業；基本任務仍可完成 |

Meta 採獨立測試 app，所有實測 IG 帳號必須符合 Standard Access 的自有／管理及 app 加入要求；不把「加為 tester」當作繞過外部客戶 App Review。Google 採獨立 Cloud project、Web OAuth client、External/Testing；只列 Google A/B，不改為對外發布以迴避 7 日限制。公開提供的 callback／刪除回應頁只暴露協定必要內容，產品頁仍需登入與 allowlist。

Drive fixtures（均為無客戶資料的測試內容）：自有繁中 Google Doc、自有 UTF-8 text、文字 PDF、B 分享給 A 的 view-only 文件（處理／轉分享權未知）、匯入前後撤權檔、版本更改檔、帳號可見但未選檔、不可下載／已入垃圾桶檔、超過 5 MiB／第 6 檔、損壞／加密／掃描 PDF、含假指令的文件、未支援 folder／shortcut。由檔案擁有人在批准的測試範圍準備；adapter 自己不寫入或改 sharing。

IG 優先用已有、自己擁有的近 30 日 image／reel／carousel。缺某媒體類型時據實標示缺口，不能拿 mock 當 live；不得為了測試自動發文或製造互動。若需新測試貼文，另列內容與發布範圍由擁有人確認。

## 7. 完整成功路徑與例外路徑

1. C1 登入 W1，直接選「為任務寫 Brief」任務卡；未連接仍能先寫問題及草稿。
2. 從技能卡理解 scopes／用途，自己完成 IG 與 Google 授權；取消其中一個不取消任務。
3. 讀取自己的受支援 IG 媒體；Picker 明確選一份自有繁中文件。檢查來源時間、期間、版本、缺值及地區覆蓋。
4. 逐來源確認處理權。D2 以人工／確定性內容形成有引用的私人 Brief；若 D3 已批准，另確認模型用途後生成，再由創作者審閱。
5. 保存私人 Brief；預覽要交給哪個測試任務、哪些段落／出處、哪些角色可見，逐項確認後轉存原任務流程。
6. 走原申請、內容審批、發佈證明及完成核實的適用狀態；Brief 完成不是任務完成。只能使用合法測試 fixture，不捏造真實發布證明。
7. 原凍結獎勵合約核實後一次性發放測試積分與合資格徽章；連接／重試／重新匯入／重複核實不增發。所有可兌換或付款出口在試點停用。
8. 撤銷／刪除來源：私人內容與後續使用立即受限；已明確交付的任務副本按原流程保留最小出處，向使用者說明不能召回。

必走例外：取消／部分授權、Google 到期、不同帳號返回、外部取消 sharing、來源在生成／保存／分享時被修改或撤銷、provider 429/5xx／超時、Picker 被擋、跨裝置重新登入、按撤銷後立即重連。每條都要保留原始草稿並顯示可完成的下一步。

## 8. 驗收門檻

下表是**尚未執行**的驗收定義。每個 ID 展開為可重現案例，記錄 PASS / FAIL / BLOCKED / NOT RUN、實際環境與證據類別（unit/mock、注入故障、live）。沒有證據不能填 PASS。

| ID | 必須成立的結果 | 必要證據 |
| --- | --- | --- |
| A01 環境 | code SHA、manifest、target、origin、provider app 及 allowlist 一致；其他環境全部拒絕 live | preflight + 去識別 egress 紀錄；零 production provider／DB 請求 |
| A02 OAuth | 取消不落 grant；state 過期／重播／錯 session、workspace、subject 拒絕；partial scope 不假裝完整解鎖 | 兩平台成功／拒絕實測；攻擊案例契約及 server 測試 |
| A03 憑證 | 服務重啟與 key rotation 後合法憑證可用；錯 key fail closed；兩 worker 同時 refresh 只更新一個合法世代 | 真實測試 DB 的並行紀錄；瀏覽器／logs／export 無 secret、refresh token |
| A04 IG 正確性 | 支援組合與同時間原始 API 結果相符；期間及 lifetime 分清，null 不補 0；缺 media URL 可繼續 | 兩類專業帳號、至少一個有值 metric 及缺值案例；逐媒體矩陣 |
| A05 Drive | 只讀選定檔；5 檔／5 MiB／8,000 字元限制可見；選錯帳號、改版、撤權不使用舊內容 | 真 Picker + Docs/text/PDF 成功，負面 fixtures 與去識別原始回應 |
| A06 隔離 | 同 W 不同 creator、同 Google 不同 W、跨角色／匿名均不能讀寫私人資料；service-only RPC 不可直呼 | 真 JWT/PostgREST/RLS 正反例，含直接 API／SQL 權限；非僅 PGlite |
| A07 同意 | 讀取、AI、私人保存、任務轉存用途獨立；未知權利不可靠勾選變合法 | server 拒絕證據 + 手機／桌面逐項預覽；scope 與 consent version |
| A08 撤銷競態 | callback／sync／refresh／模型／save／share 途中的舊結果不回寫；403 後錯誤不復活 cache | 兩程序真 DB 競態 + 可控 provider 延遲；舊對話遮蔽修正回歸 |
| A09 遠端撤銷 | local 立即阻止新使用；provider 成功、延遲、失敗分開；同 Google project grant 的相關連接失效，重連不繼承同意 | 平台手動及 app 撤銷實測、pending/24h/manual_action；不洩漏其他 W |
| A10 故障與重試 | timeout/429/5xx 有界重試；未知結果不重複執行；來源保留失效提示及草稿 | 注入故障明確標識；實際成功同步時間，無偽造空值或成功 toast |
| A11 來源與報告 | 問題、平台、版本、時間、期間與引用可追溯；HK／繁中不足標未驗證；不把 provider 來源當任務核實 | 一份可逐段查回來源的私人 Brief 和測試任務副本 |
| A12 原任務與獎賞 | 原狀態機／角色／凍結合約不變；同一合法完成只得一次測試獎勵，無真實兌換出口 | 原任務回歸 + 測試 ledger 前後差異 + 重試／拒絕／退回路徑 |
| A13 私隱營運 | 超過一頁匯出無漏資料／秘密；刪除、排程、失敗重試可證明；備份還原後撤銷／刪除不復活 | 真測試排程、指定資料清理與隔離還原演練；長期限用受控時鐘另標 |
| A14 裝置與可及性 | 六個寬度無橫向溢位；真 iOS/Android/desktop OAuth 返回及 Picker 可完成；鍵盤、focus、讀屏與減少動畫可用 | 實際 OS／browser 版本、截圖及旅程記錄；缺設備列 BLOCKED |
| A15 既有旅程 | 訪客、創作者、品牌、營運、財務各指定關鍵讀寫路徑不退步；連接關閉仍能完成任務 | Stage 3 對照 + 4A–4C 修正回歸；read-only 與 mutation 分列 |
| A16 到期與維運 | 至少跨第 7 日連續 8 日觀察；Google 到期正確提示，草稿／歷史不丟；關閉開關保留管理／手動任務 | 真實時間軸、再授權結果、排程健康、關閉演練；IG 長期到期未到者另列 |
| A17 可選真 AI | 僅核准來源到指定模型；有引用，不能從其他 actor、舊 revoked 歷史或提示注入擴權 | 只有 D3 批准才執行；去識別 payload 清單、處理者／區域／保留設定及錯誤路徑 |

**退出規則：** 開啟真實讀取前 A01/A02/A03/A06 的安全預驗及其他離線阻擋案例必須通過。`4D-read-pilot PASS` 要求 A01–A16 全數通過且沒有未解決的重大／高風險或關鍵旅程問題；任一必測 skip／缺設備／未驗證版本均保持未完成。A17 未批准時寫 NOT RUN，不能稱完整 AI 整合通過。`4D-AI-pilot PASS` 另需 A17；兩者都不是 production release 批准。

## 9. 執行順序、時間與檢查命令

| 步驟 | 內容與停止點 | 初步工時估算 |
| --- | --- | --- |
| D0 | W1–W8 的本機部分、離線契約與失敗案例；交付差異及實際版本／scope 矩陣 | 約 5–8 工程工作日 |
| D1 | 批准指定 target 後才配置 HTTPS、獨立 DB/OAuth、秘密、測試者、排程及可回退部署 | 約 1–2 日，平台審查等待另計 |
| D2 | 兩位內部參與者跑成功／例外／角色／裝置／撤銷路徑及觀察 | 約 2–3 日集中測試，加至少 8 日自然時間觀察，可部分重疊 |
| D3 | 可選 AI 合約／用途批准後測 A17；不批准則只交只讀試點結果 | 約 1–2 日，實際按處理者要求調整 |
| 結案 | 獨立審查、證據核對、清理與 rollback 演練，提出後續建議 | 約 1 日 |

以上為規劃估算，未承諾外部 App Review 或帳號限制的處理時間。先內部測試，不以擴張 scope／發布 OAuth app／改用 scraping 來解除阻礙。

本機實作後的既有檢查命令（本次未執行）：

```powershell
npm exec vitest -- run server/lib/integrations src/lib/integrations src/components/integrations server/test/integrations-schema.test.ts server/test/integrations-sql.test.ts server/test/integrations-routes.test.ts server/test/integrations-privacy.test.ts server/test/studio-integrations.test.ts server/test/studio-integration-race.test.ts
npm run test:active-missions
npm test
npm run build
npm run lint
npm run release:manifest:check
git diff --check
```

補上的離線測試納入對應目錄。遠端 live runner 另加明確 opt-in 及指定 target 驗證後才可執行；不直接啟動既有 release executor／pilot-enable／audit runner。回歸報告列出實際執行、略過、失敗及修正後重跑範圍，不推算不存在的「全部通過」。

## 10. 證據、停止開關與交付

- 每個案例記錄 actor 代號、workspace 代號、環境、SHA／schema digest、provider/API 版本、實際問題、檔案版本/hash、時間與時區、scope／用途同意、操作、預期／實際、結果與證據路徑。
- 原始 token、code、真 email、私人檔名／正文、完整 provider 回應及瀏覽器儲存狀態不入 Git 或普通 trace。必要的原始對照資料留在批准的限制存取位置；repo 只留去識別 receipt／hash。截圖也先檢查私人內容。
- 開關分全域／provider／actor：關閉即禁止新授權、同步與 provider 來源進入模型，取消 jobs 並使在途世代失效；保留帳號列表、撤銷、purge、手動來源及原任務。
- 停止觸發：任何跨 owner 洩漏、秘密外洩、未同意 AI/分享、非測試 target 流量、重複獎勵或撤銷後新使用。立即停止受影響 provider，保存最少事件資訊，通知指定試點負責人；不自動發外部通知。
- 讀取開關關閉後，撤銷／清理 worker 仍可在已批准 target 與 lifecycle endpoint 白名單內工作；不得以停用為由放棄遠端撤銷，亦不得藉撤銷重開資料讀取。
- 回退採關閉能力與回退應用版本，保留 additive schema 與刪除 tombstone；不 drop tables、不重置帳本、不把舊 mock 憑證轉真實、不用 legacy scraper 接手。
- 交付可審閱 diff、功能保留矩陣、實測 provider 矩陣、A01–A17 結果、手機／桌面證據、私隱／金鑰／撤銷／刪除 runbook、問題與未測範圍，以及明確的 GO／NO-GO。GO 只限本試點已批准的範圍。

## 11. 真實試點開始前的批准單

本表是後續要補齊的具體資料，不是要求現在連接帳號。應先完成 D0 的可審閱成果，再帶同這張表作一次明確批准。

| 項目 | 建議值／待確認內容 |
| --- | --- |
| 執行範圍 | 選 D0；或明確列 D1/D2；D3 預設不包含 |
| 環境 | 指定非 production hosting/project ID、HTTPS origin、DB project、部署 SHA、允許的 callback；不得沿用 production secrets |
| Provider apps | 獨立 Meta app ID／IG API 版本；Google project/client ID、Testing 狀態；秘密只入指定秘密儲存 |
| 測試者與角色 | A/B 的本人同意、IG 帳號類型／app 角色、Google A/B 名單；C1/C2/C3、W1/W2 與 staff fixtures |
| 權限取捨 | IG basic + insights；Google `drive.file` 的修改能力告知 + `openid` 身份用途；只讀方法與 Picker token 例外 |
| 測試資料 | 指定自有媒體與無客戶資料文件清單、處理／分享權、可交付的測試任務段落；無發文／訊息／Drive 寫入 |
| AI（可選） | 模型／供應商／專案、資料目的地與地區、保留／訓練條款、來源清單與每次用途同意；未填則不傳送 |
| 營運 | 試點負責人與事件聯絡人、可用裝置、成本上限、8 日觀察窗口、清理日期及備份保留／還原方法 |

## 12. 計畫自查

- 尚待決定／證實：實際 pilot target、測試者、Meta API 版本與 app 權限、key store、可用裝置、真實 quota、跨 provider 撤銷時序、模型處理條款。均保留為入場條件，沒有宣稱已完成。
- 保留的近期修正：read permit SQL 合約、sync-run 匯出排序、過期帳號撤銷／purge、重連穩定 file identity、舊 assistant 內容遮蔽與 `clock_timestamp()` 競態修正，以及 permission epoch 的 cache 隔離。
- 風險重點：跨 workspace 的 provider grant 撤銷影響、Google Picker token 的能力與期限、外部 ACL 的時間差、多程序 refresh、備份還原後資料復活。各自有對應工作包及 A03/A05/A08/A09/A13 門檻。
- 當前交付僅此 Markdown 計畫；沒有新增或修改應用程式、schema、套件、部署設定或任何真實連接。
