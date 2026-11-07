# KOCmax Stage 4：Instagram 與 Google Drive 連接規格

日期：2026-10-31 HKT。狀態：**4A–4C 已獲批准，以本機 mock providers 實作；真實連接與部署未批准**。原完整設計與實作範圍的差異見 [執行計畫](../plans/2026-10-31-kocmax-stage-4-integrations.md) 及 [驗證報告](../../review/kocmax-stage-4/verification.md)。

以分支 `codex/kocmax-studio-stages-1-2`、Stage 3 提交 `27353a3` 為基準。本文件根據本機原始碼及本日查閱的官方文件；沒有檢查任何真實 OAuth 應用程式的設定、審查狀態或帳號資料。

## 1. 目標與範圍

創作者在對話中選擇自己的 Instagram 成效及指定 Drive 文件，形成有來源的私人 Brief，再逐項確認轉存到原任務。積分、徽章仍由原核實及結算事件發出。

第一版只提供兩個可選技能：Instagram「成效雷達」、Google Drive「靈感背包」。未連接、個人 Instagram 帳號不支援、拒絕授權或平台暫停時，手動來源、對話與基本任務仍可用。不為連接、同步、聊天或重複匯入發積分或 XP。

不包含發文、私訊、留言管理、廣告、Drive 編輯／上載／更改分享、Gmail、Calendar、其他社交平台或自動提交。日後新增外部寫入功能，必須另做權限增量授權、內容預覽及明確確認。

## 2. 與現有功能接合

| 現有邊界 | Stage 4 做法 |
| --- | --- |
| `src/routes/_app.connections.tsx` 八張技能卡 | 只啟用 Instagram、Drive 的受控連接流程；其餘維持稍後推出 |
| `server/lib/social/service.ts` RapidAPI 掃描、冷卻時間、擁有權挑戰 | 原功能及 provider 標記保留；新官方 OAuth 獨立建模，不靜默替換，也不在失敗時轉用抓取服務 |
| `server/lib/social/passportSocial.ts` 社交信任與公開投影 | 私人 OAuth 數據不自動填入護照、評分、排行榜、品牌或營運可見摘要 |
| `studio_sources`、`studio_briefs`、`studio_shares` | 加來源版本與權限關聯；保留私人範圍、不可變 Brief、逐段分享、原任務草稿版本控制 |
| 原 `sourceInput`／SQL 固定 HK、繁中、未驗證 | 舊手動來源維持原行為；新 provider 來源用獨立、由伺服器產生的匯入路徑，真實涵蓋地區／語言可為未知，不假填 HK |
| assistant request reservation、context version、unknown outcome | 保留去重、上下文變更檢查及不自動重生；撤銷連接會使舊上下文失效 |
| 審稿、發佈證明、完成核實、獎勵交接、帳本 | 沿用原工作流；OAuth 成功及 API 數據都不能直接批准任務、發積分或修改凍結 reward contract |
| 匯出／匿名化、角色權限、品牌隔離 | 擴充同一條資料管理流程；不新增營運人員代開私人 Drive 的權限 |
| Stage 3 手機／桌面、CMS 衝突與表單保護修正 | 全部保留；新連接狀態不覆蓋未儲存輸入，403 後的私人快取不可因後續 503 再出現 |

## 3. 平台權限與已確認限制

### Instagram

採 **Instagram API with Instagram Login**，服務創作者自行授權的 Business／Creator 專業帳號。

| 權限 | 用途 | 邊界 |
| --- | --- | --- |
| `instagram_business_basic` | 辨識授權帳號、讀取所需個人檔案與自有媒體資料 | 不據此宣稱作品真實性或身分已核實 |
| `instagram_business_manage_insights` | 讀取帳號／媒體成效 | 只允許實作白名單內的讀取端點 |

不要求 publish、messages、comments、Pages 或 Ads 權限。個人帳號不能透過此 API 取得同等 Insights；顯示原因及手動輸入選項，不強迫轉換帳號。服務非開發者自行擁有／管理的帳號，需要 Meta Advanced Access；測試帳號成功不等於公開開放許可。[Meta Insights 文件，頁面更新 2026-10-20](https://developers.facebook.com/documentation/instagram-platform/insights)

Meta 文件指出部分少於 100 followers 的帳號指標不可用；缺資料可能回傳空資料集。正規化為 `null + missing/unsupported`，不可補零。真實回傳零值仍是零。這個登入路徑的媒體數據不能包裝成包含所有廣告／加強推廣互動的總數。每項報告顯示實際查詢範圍、時間與限制。[Meta Insights 限制](https://developers.facebook.com/documentation/instagram-platform/insights)

首版建議：由創作者按「更新成效」啟動，只讀最近 30 日、最多 50 則自有媒體，分頁上限可見；新連接同步冷卻 60 分鐘。首次不啟用排程或故事即時訂閱。指標清單、API version、帳號／媒體類型和期間組合需在實作前形成經官方參考文件核對的 capability manifest；不直接抄用文件中的舊示例指標。超過上限的分析標示「部分資料」，不宣稱完整帳號表現。

### Google Drive：必須說清楚的權限取捨

建議 **Google Picker + `https://www.googleapis.com/auth/drive.file`**，由創作者選擇檔案。此 scope 屬 non-sensitive，但包含所選檔案的建立／修改能力，**不是 OAuth 層的只讀**。KOCmax 另以程式白名單限制內容讀取，不提供寫入工具。這項 scope 取捨須在真實連接前獲產品負責人明確接受，並在用戶授權前解釋。[Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

若堅持 OAuth 本身只讀，`drive.readonly` 會擴大為整個 Drive 的讀取／下載範圍，並屬 restricted scope；涉及伺服器存取、傳送或保存資料時有額外審查／安全評估要求。因此不作預設或偷偷升級的備案；未接受任何方案時保留手動加入來源。`drive.metadata.readonly` 不能解決讀取文件內容需求。[Google Drive scopes 與審查分類](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

首版選檔白名單：Google Docs、UTF-8 純文字、含文字的 PDF；每次最多 5 份，每份匯出／下載後最多 5 MiB，每份送入工作室的摘錄仍不得超過原有 8,000 字元限制。掃描 PDF、加密檔、試算表、簡報、資料夾、捷徑、壓縮檔先顯示不支援；不遞迴讀整個資料夾。禁用 Picker 上載入口。

只有選中的 file ID 可進入後端 allowlist，之後仍要重新檢查該帳號的實際讀取／下載能力。不能信任瀏覽器回傳的檔名、MIME 或「有權分享」旗標。Google Docs 用 export，其他支援檔案用 download，檢查 `capabilities.canDownload`。[Drive 下載規則](https://developers.google.com/workspace/drive/api/guides/manage-downloads)

Picker 的網頁版需要 access token。refresh token 永遠留在伺服器；只有 Picker 所需、未過期的 Drive access token 短暫存在瀏覽器記憶體，不放 URL、localStorage、分析事件或模型。這個 token 仍具有 Google 授予的 scope，不能宣稱已被 KOCmax 降權；以 CSP、來源限制及最短必要頁面生命週期降低暴露。若不接受此殘餘風險，暫不開啟此方案。[Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview)

## 4. 手機與桌面完整流程

| 畫面／狀態 | 手機 | 桌面 | 主要驗收 |
| --- | --- | --- | --- |
| 已連接帳號 | 兩張技能卡及可展開權限 | 技能卡與帳號詳情並排 | 未連接、部分授權、同步中、已更新、過期、受限、撤銷均有文字 |
| 授權前說明 | 全頁短說明，「連接」及「稍後」 | 對話框，列清用途與範圍 | 不預勾公開或 AI 使用，不把 Drive 稱為平台只讀 |
| 平台登入及返回 | 平台允許的瀏覽器登入；返回原討論 | 安全重新導向／彈窗返回 | 取消、不支援的內嵌瀏覽器、彈窗受阻、切換帳號不遺失草稿 |
| 成效雷達 | 指標卡及展開來源 | 指標卡加來源側欄 | 分開連接成功、最近同步時間、指標期間、缺資料、未驗證結論 |
| Drive 選檔 | Picker 後顯示勾選清單及摘錄預覽 | 檔案清單與內容預覽並排 | 選檔不等於送給 AI，更不等於分享給品牌 |
| 對話與證據 | 對話／證據分頁，保留提問框 | 對話及證據面板 | 只有本 thread 選取來源進入上下文；來源權限失效時即停止再使用 |
| Brief 與分享 | 逐段預覽、接收者及引用確認 | 段落、引用、接收者同時可見 | 取消不轉存；改段落／任務／版本後重新確認 |
| 撤銷及資料管理 | 一鍵停止連接；清楚列出資料處理結果 | 同一組操作與狀態 | 顯示停止、平台撤權結果及清除進度；可另刪除匯入內容 |

視覺沿用 Stage 3：奶油底、紫色主操作、圓角卡片及小芽角色；「技能已準備好」僅是狀態動畫，不給可兌換獎勵。尊重減少動態、44px 操作區、可見焦點及鍵盤返回。

在內建瀏覽器完成畫面與 mock 流程核對；真實 OAuth 如遇平台不支援內嵌登入，導向平台允許的系統瀏覽器，不偽裝 user agent 或要求用戶繞過警告。

## 5. 安全與權限模型

### 身分、憑證及工具

- 所有操作綁定既有 `workspace_id + creator_id`。從有效伺服器 session 取得身分，不接受模型／前端傳入別人的 creator。共享同一工作區不代表可讀另一人的連接。
- 一位創作者於一個工作區首版各連一個 Instagram、Drive 帳號；更換帳號需撤銷舊 generation，不能把舊文件及分享許可移到新帳號。相同 provider subject 不跨創作者共用 token。
- 後端 authorization-code flow；單次、10 分鐘期限的 state 綁 provider、session、creator、workspace、return path 與連接 generation。使用平台支援的 PKCE；由固定 redirect allowlist 防止 open redirect。callback 不建立 KOCmax 登入身分。
- 使用官方 SDK／已核對的協定；檢查實際授予 scopes，不把「使用者按了同意」視為全部權限成功。Instagram scope 未齊時僅顯示實際可用功能。
- 長效憑證加密、金鑰與資料分開；包含 workspace／creator／provider 的加密關聯資料，輪替與並行刷新有鎖。瀏覽器、模型、一般客服、匯出、日誌不取得 refresh token 或 Instagram token。
- 第一版採內部 provider adapters 及窄工具介面；不需要公開 MCP server 或第三方聚合器。工具只可列出本人的連接摘要、讀取已授權 IG 指標、讀取已選取 Drive 摘錄。禁止任意 URL fetch、任意 provider method 或 token 傳遞。
- OAuth token exchange／refresh／revoke 是連接管理操作，不向模型開放；與「禁止內容寫入」分別測試。遠端輸入與文件中的指令一律當內容，不得擴權、改 recipient、引導額外工具或外洩其他來源。
- 新開關 `INTEGRATIONS_ENABLED`、`INSTAGRAM_CONNECTIONS_ENABLED`、`DRIVE_CONNECTIONS_ENABLED` 預設 false，伺服器為權威。關閉內容讀取不關閉撤銷／刪除通道。

### 來源權限與分享

連接授權、選檔、允許 AI 處理、允許任務接收者看見，是四個不同決定。

1. 來源與由來源產生的摘要／Brief 預設只有創作者可看。
2. 選定來源送模型前，以短說明披露處理服務、目的、可能儲存地區及保留政策；必須有匹配的同意版本，並確認來源允許此處理用途。只取得閱讀權但不能確認可交給處理商的文件，不送外部模型，僅保留允許顯示的 metadata 及權限提示。不因使用者已同意登入就自動送出文件。
3. 在讀取、送模型、保存 Brief、分享前檢查來源仍可用；若外部服務不能確認權限，保留使用者輸入，但停止新的引用保存／分享。舊來源不得因快取而重新取得授權。
4. Google 的「可讀／可下載」不代表「有權轉交品牌」。首版對第三方擁有或轉分享權不明的私人文件只作私人分析；對外分享要有文件擁有者／授權證據及創作者逐項確認，否則排除相關段落。不要求修改 Drive 原檔分享設定。
5. 分享回執綁定 Brief version、section IDs、來源 snapshot IDs、內容 hash、任務／work item、接收者、來源權限 generation 及同意版本。後端重算，不信任前端勾選後自行拼出的文字。
6. 首版接收者沿用 `task_review`，介面清楚列出原流程實際可閱角色。品牌、公開護照、排行榜等屬其他目的地，不會因提交而自動取得私人原檔；將來新增目的地需另批與另行確認。
7. 分享只包含確認過的文字及允許露出的引用，不帶 token、私有下載網址、未選檔名、完整原檔或其他討論資料。已交付的獨立副本不能假稱可以從對方手中收回；系統須列明已有分享回執。

AI 使用只限創作者要求的功能；不出售、投放個人化廣告、訓練通用模型，亦不供員工隨意閱讀。第三方處理商、保留期間、跨境處理位置及 Google／Meta 當時政策需在真實試用前核實，不宣稱目前已具備零保留或香港儲存。[Google 使用者資料政策](https://developers.google.com/terms/api-services-user-data-policy)

## 6. 資料模型與撤銷生命週期

全部以新 migration 追加，不重寫已套用 migration、不更動現有帳本或凍結 reward contract。

| 資料單位 | 主要欄位／用途 | 可見性 |
| --- | --- | --- |
| `integration_connections` | owner、provider、subject、實際 scopes、status、generation、last_success_at、expires_at、revoked_at、consent version | 本人可讀安全 DTO；無 token |
| `integration_credentials` | 加密 token、key ID、expiry、refresh version | private schema，僅指定伺服器服務可用 |
| `integration_resources` | 選定 resource ID、MIME、來源權利聲明、版本、permission status | 本人，檔名亦屬私人 |
| `integration_snapshots` | 正規化 metrics／有限摘錄、source version/hash、fetched_at、period、實際 coverage、missing reason | 本人；不可混進全站知識庫 |
| `integration_sync_runs` | 冪等 request ID、generation、狀態、分頁／部分資料、backoff、最小錯誤碼 | 本人看簡短狀態，營運只看去識別健康資訊 |
| `integration_events` | 授權版本、撤銷／清除、處理結果、可核對 receipt | 最小事件資料，不存原文或 token |
| 既有 `studio_sources`／`studio_shares` 擴充 | snapshot reference、provenance、coverage、source generation／分享 receipt | 保留既有 creator／workspace 邊界 |

數值、資料可用性與結論可信度分開：`value: number | null`；`availability: available | missing | unsupported | stale | revoked | rate_limited`；`provenance: manual | instagram_api | google_drive`；`claim_verification: unverified`。`HK/zh-Hant` 是創作者的目標語境，不能自動充當 API 的實際受眾地區或文件語言。

每份成效報告／Brief 列出實際問題、平台、觀察與擷取時間、期間、媒體／文件版本、引用及樣本範圍；自算比率列公式與分母。缺少香港／繁中證據時顯示「未驗證」，不替換成其他地區基準。API 出處可核對，不等於內容或任務已驗證。

**撤銷順序：**立即禁用本地 connection 並增加 generation → 取消排隊工作與回應落地 → 使相關來源、模型上下文及未提交分享許可失效 → 嘗試平台撤權 → 清除憑證／快取，記錄最小回執。重新連接不能自動恢復舊分享同意。平台外部撤權於通知或下次權限檢查偵測；不可承諾未收到訊號前已即時得知。

Google 撤權影響範圍需在指定測試應用程式確認；優先將 Drive 授權與 KOCmax 登入分開，避免意外撤掉登入或其他服務。這是架構要求，現在不建立任何 Cloud project、OAuth client 或金鑰。

建議保留目標（須在試用前驗證儲存與處理商實際能力）：

- 原始 API response 不長期保存；下載檔／解析暫存最長 24 小時，完成解析即提早清除。
- 未引用的同步 snapshot 保留 30 日；已選入私人工作室的摘錄按工作室保留政策處理，維持來源版本及權限標記。
- 本地撤銷後立即停止使用 token；若平台撤權需重試，僅隔離的撤權工作可使用加密 token，最長 24 小時後清除並顯示未完成的平台撤權及手動入口。不能把本地停止稱作平台已撤權。
- 撤銷後 24 小時內清除未保存暫存；保存的來源及衍生內容立即隔離、禁止再送模型／分享，提供「刪除匯入內容與衍生草稿」。清除涵蓋來源摘錄、對話衍生內容、快取及任何索引；使用者自己另寫的無來源內容不需連帶移除。
- 匿名化流程先封鎖連接與背景工作，再沿用原可重試刪除流程。必要帳本及既有核實回執保留最小去識別資料；不保留可再使用的私人原文以充當一般 audit log。
- 安全事件 metadata 目標 90 日；備份中的刪除以既有、已披露的備份保留期限為準，真實試用前需證明期限及還原後重新套用刪除清單。不能承諾本次尚未驗證的備份即時清除。

## 7. 測試與驗收矩陣

| 層級 | 必測情況 | 通過條件 |
| --- | --- | --- |
| OAuth | state 過期／重放、callback 換帳號或 workspace、拒絕／部分 scopes、open redirect、過期 token、刷新競態 | 不錯綁帳號、不擴權、不把失敗顯示成成功 |
| 隔離 | A/B 創作者、兩工作區、品牌、reviewer、finance、未登入直接呼叫 API／DB | 猜 ID、跨 owner FK、服務端查詢均不能讀取他人連接／內容；RLS 與服務端授權分開驗證 |
| IG | 專業／個人帳號、少於 100 followers、空集／真實零、過時指標、刪除媒體、429／timeout／部分分頁 | 狀態、期間與來源正確，無假零、廣告總數或 HK 受眾推斷 |
| Drive | 未選 file ID、相同 ID 換帳號、取消 Picker、403／404、選後撤權、文件改版、禁止下載、超限及惡意 PDF | 後端重查、超限停止、來源版本不混淆、不跟隨檔案中的 URL 或指令 |
| AI／分享 | 未同意模型處理、文件 prompt injection、假 source ID、去掉 lineage、換 recipient／段落／版本、無轉分享權 | 未授權資料不送模型；分享 hash／receipt 不匹配即拒絕；保留使用者輸入 |
| 撤銷 | 同步中撤銷、晚到 OAuth callback、LLM 晚到結果、分享重試、重連／換帳號、部分刪除失敗 | 舊 generation 不落地、不重新開啟權限、不重放私人結果；可重試清除 |
| 原流程 | 草稿／更正／審批／proof／completion／reward handoff、重複提交及結算 | 無繞過角色；既有 points／XP／徽章結果不變且不重複發放 |
| 體驗 | 320、390、430、768、1024、1440px；鍵盤、讀屏、減少動畫、弱網、彈窗受阻 | 無橫向溢出、焦點正確、取消返回原草稿、錯誤不掩蓋權限拒絕 |
| 資料管理 | 全量分頁匯出、token／日誌掃描、刪除重試、備份還原 | 不輸出憑證、匯出不漏頁、刪除不因重試重建連接 |

先跑本地 fake providers／本地資料庫與既有 regression；正式 suite 的 skipped tests 單列，不算 passed。真實 Auth/RLS、平台 token、App Review 與 Safari／Android OAuth 驗收是獨立層級，mock 或內建瀏覽器寬度測試不能代替。

**第一條完整驗收旅程：**一位創作者 → 一張內容 Brief 任務卡 → 選本人 Instagram 的一則成效及一份合成 Drive 文件 → 同意這兩項用於 AI → 取得帶引用的私人 Brief → 預覽並確認可分享的段落與 `task_review` 接收者 → 原任務草稿／提交／核實／結算 → 帳本唯一入帳及原徽章。測試中途撤銷 Drive，應阻止相關段落分享但允許改用手動來源繼續。真實測試只使用批准的測試環境與帳號，不產生正式積分或付款。

## 8. 分期與批准邊界

| 階段 | 交付／完成條件 | 授權需求 |
| --- | --- | --- |
| 4A 連接基礎 | scope manifest、安全模型、本地 OAuth／撤銷模擬、獨立開關與 RLS 測試 | 先批准本計畫的本地實作 |
| 4B 兩個 provider | IG 指標 adapter、Drive 選檔／解析、手機及桌面完整狀態 | 同一分支、fake provider；不需要真實 token |
| 4C 證據與任務 | 私人來源、同意、Brief／分享、匯出／刪除、完整示例旅程及回歸報告 | 同一本地實作範圍；本地 green 不宣稱 provider 驗收 |
| 4D 受控真實試用 | 指定非正式環境、指定測試帳號與文件、實際 scopes／撤銷、真實 Auth/RLS、行動瀏覽器證據 | **另行明確批准真實連接、測試資料與處理目的地；現在未批准** |
| 後續正式啟用 | 平台審查、私隱披露、刪除／監控演練、所有必要驗收通過 | **另行批准部署與啟用；現在未批准** |

工程順序：4A → 4B（兩個 adapter 可獨立開發）→ 4C → 4D。以一位工程師作粗估，本地部分約 15–20 個工作日；外部審查、指定環境建立與真實驗收另計，這不是平台核准日期承諾。

試用前提出具體審批包：環境／帳號清單、所選 Drive scope、provider API version、實際 OAuth 畫面、讀取資料範圍、AI 處理商與保留政策、撤銷／刪除操作及測試 script。沒有批准便停在可互動 mock，手動基本任務維持可用。

回退採關閉新連接／讀取開關、停止排程及新落地，保留撤銷／刪除入口和舊任務流程；不以 drop table 或復原整個資料庫處理。外部平台異常只降級相關技能，不自動換 provider，也不取消既有任務。

## 9. 文件與證據

- [Stage 3 驗證基準](../../review/kocmax-stage-3/verification.md)
- [既有功能保留表](2026-10-31-kocmax-function-audit.md)
- [可執行實作計畫](../plans/2026-10-31-kocmax-stage-4-integrations.md)
- [Meta Insights](https://developers.facebook.com/documentation/instagram-platform/insights)：本日以內建瀏覽器閱讀英文原文；scope／帳號限制已查證，實際應用程式審查狀態未查證。
- [Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Picker](https://developers.google.com/workspace/drive/picker/guides/overview)、[下載](https://developers.google.com/workspace/drive/api/guides/manage-downloads)：本日查閱；真實選檔與權限未測試。
- [Google Web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[使用者資料政策](https://developers.google.com/terms/api-services-user-data-policy)：協定與披露依據；不是本產品已通過平台審查的證據。
